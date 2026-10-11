"""LEGACY (pre-ElevenLabs pipeline; kept until the ElevenLabs pipeline passes P2 + one new episode). Do not build new episodes on this. (p2-only: hard-coded cut points + Whisper observations)

p2 only: map existing audio word observations through the verified edit list.
No synthesis, installations, network, or estimated speaking speed.
"""
from pathlib import Path
import array, hashlib, json, math, re, subprocess, wave
import numpy as np

ROOT=Path(__file__).resolve().parents[2] if 'scripts' in str(Path(__file__).resolve()) else Path(r'C:\Users\123\toefl-threads')
OLD=Path(r'C:\Users\123\Documents\Codex\2026-10-11\referenced-chatgpt-conversation-this-is-an-2')
OUT=ROOT/'docs/p2-v4.2'; OUT.mkdir(exist_ok=True)
FF=r'C:\Users\123\OneDrive\桌面\Arc\tools\x64\ffmpeg-win64.exe'
SR=44100
def decode(p):
 return np.frombuffer(subprocess.check_output([FF,'-v','error','-i',str(p),'-f','f32le','-ac','1','-ar',str(SR),'-']),dtype='<f4').copy()
a,l,e=[decode(OLD/'work'/f'{n}.mp3') for n in ('arthur','ling','examples')]
def quiet(x,lo,hi):
 win=int(.008*SR)
 return min(range(int(lo*SR),int(hi*SR),int(.002*SR)),key=lambda p:np.mean(x[max(0,p-win//2):p+win//2]**2))/SR
cut=quiet(a,4.48,4.52);lc=quiet(l,1.30,1.60)
spec=[('arthur',a,0,cut),('ling',l,0,lc),('examples',e,0,2.3),('arthur',a,cut,15.50),('ling',l,lc,len(l)/SR),('examples',e,2.4,len(e)/SR),('arthur',a,15.65,len(a)/SR)]
pieces=[];edits=[];cursor=0
for i,(name,x,s,t) in enumerate(spec):
 y=x[int(s*SR):int(t*SR)].copy()
 blocks=np.array([np.sqrt(np.mean(y[j:j+441]**2)) for j in range(0,len(y),441)])
 active=np.where(blocks>.004)[0];first=max(0,int(active[0]*441-.035*SR));last=min(len(y),int((active[-1]+1)*441+.05*SR))
 y=y[first:last];n=min(220,len(y)//2);y[:n]*=np.linspace(0,1,n);y[-n:]*=np.linspace(1,0,n)
 if i:
  gap=int(SR*(.20 if i in (3,6) else .16));pieces.append(np.zeros(gap,dtype=np.float32));cursor+=gap
 edits.append({'source':name,'sourceStart':(int(s*SR)+first)/SR,'sourceEnd':(int(s*SR)+last)/SR,'start':cursor/SR,'end':(cursor+len(y))/SR})
 pieces.append(y);cursor+=len(y)
rebuilt=np.concatenate(pieces)
if np.max(abs(rebuilt))>.97:rebuilt*=.97/np.max(abs(rebuilt))
with wave.open(str(OLD/'work/merged.wav')) as w:original=np.frombuffer(w.readframes(w.getnframes()),dtype='<i2')
assert np.array_equal((rebuilt*32767).astype('<i2'),original),'Edit reconstruction differs from approved merged PCM'
approved=OLD/'outputs/arthur-ling-examples-test.mp3';actual=decode(approved)
assert len(actual)==len(rebuilt),(len(actual),len(rebuilt))
correlation=float(np.corrcoef(actual,rebuilt)[0,1]);assert correlation>.99,correlation
observed={n:json.loads((OLD/'work'/f'{n}.json').read_text(encoding='utf-8')) for n in ('arthur','ling','examples')}
copy=json.loads((ROOT/'scripts/video/p2-v4-copy.json').read_text(encoding='utf-8'))
# (edit piece, observed segment, word range). Chinese remains phrase-level because
# the existing recognizer misspells the Chinese; the approved copy is authoritative.
mapping={'hook':(0,0,0,5),'lead':(0,1,0,4),'allocateMeaning':(1,0,0,4),'allocateExample':(2,0,0,5),'budget':(3,1,4,13),'cfo':(3,2,0,4),'pen':(3,3,0,7),'decision':(3,4,0,7),'arbitraryMeaning':(4,0,4,10),'arbitraryExample':(5,1,0,4),'bye':(6,5,0,2)}
lines=[]
for line in copy['lines']:
 if line['id'] not in mapping:continue
 pi,si,lo,hi=mapping[line['id']];edit=edits[pi];words=observed[edit['source']][si]['words'][lo:hi]
 def mapped(t):return edit['start']+max(0,min(edit['sourceEnd'],t)-edit['sourceStart'])
 start=mapped(words[0]['start']);end=mapped(words[-1]['end'])
 # Whisper reported the budget's 90 before the cut: the clip edge is the
 # independently known boundary; never let its cue appear during the example.
 start=max(edit['start'],start);end=min(edit['end'],end)
 tokens=list(re.finditer(r'\S+',line['text'])) if line['lang']=='en' else []
 assert not tokens or len(tokens)==len(words),(line['id'],len(tokens),len(words))
 events=[]
 for token,word in zip(tokens,words):
  clean=lambda s:re.sub(r'[^a-z0-9]','',s.lower())
  assert clean(token.group())==clean(word['word']) or (clean(token.group()),clean(word['word'])) in [('ninety','90'),('percent','')],(token.group(),word)
  at=max(start,mapped(word['start']))-start;until=min(end,mapped(word['end']))-start
  events.append({'at':at,'until':max(at,until),'pos':token.start(),'count':len(token.group()),'text':token.group().strip('.,'),'observedSourceStart':word['start'],'observedSourceEnd':word['end']})
 lines.append({**line,'start':start,'end':end,'duration':end-start,'words':events,'alignment':'existing Whisper word observations + sample-exact edit mapping' if tokens else 'approved phrase + sample-exact clip boundaries','editPiece':pi})
audioEnd=len(actual)/SR
questionStart=audioEnd+.15;answerStart=questionStart+2.8
for id,s,t in [('question',questionStart,questionStart+.8),('answer',answerStart,answerStart+1.25)]:
 line=next(l for l in copy['lines'] if l['id']==id);lines.append({**line,'start':s,'end':t,'duration':t-s,'words':[],'alignment':'silent visual Quiz; no recorded narration','silent':True})
duration=math.ceil((answerStart+1.25)*30)/30
plan={'id':'p2-v4.2','duration':duration,'frames':round(duration*30),'fps':30,'voices':{'en':'ElevenLabs Arthur (approved recording)','zh':'ElevenLabs Ling (approved recording)'},'audioEnd':audioEnd,'sourceSHA256':hashlib.sha256(approved.read_bytes()).hexdigest(),'alignmentCaveat':'ASR observations are not forced alignment; source-boundary clamp for budget ninety, Chinese uses clip/phrase timing. No uniform word interpolation.','lines':lines}
(OUT/'p2-v4.2.plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'alignment-provenance.json').write_text(json.dumps({'edits':edits,'reconstruction':'sample-exact match to prior merged.wav','approvedMP3Correlation':correlation,'sourceSHA256':plan['sourceSHA256'],'sourceDuration':audioEnd},indent=2),encoding='utf-8')
subprocess.run([FF,'-y','-v','error','-i',str(approved),'-af',f'apad=whole_dur={duration}','-ac','1','-ar',str(SR),str(OUT/'narration.wav')],check=True)
print(json.dumps({'duration':duration,'audioEnd':audioEnd,'correlation':correlation,'lines':[(x['id'],round(x['start'],3),round(x['end'],3)) for x in lines]},indent=2))
