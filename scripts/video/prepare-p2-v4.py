"""LEGACY (pre-ElevenLabs pipeline; kept until the ElevenLabs pipeline passes P2 + one new episode). Do not build new episodes on this.

One p2 prototype: trim only boundary silence, preserve SAPI word positions."""
from pathlib import Path
import array, json, math, wave
root=Path('docs/p2-v4'); audio=root/'audio';audio.mkdir(exist_ok=True)
copy=json.loads(Path('scripts/video/p2-v4-copy.json').read_text(encoding='utf-8'))
lines=[];master=bytearray();cursor=0;format_spec=None
for line in copy['lines']:
 raw=root/'voice'/f"{line['id']}.wav"
 with wave.open(str(raw)) as w:
  spec=(w.getnchannels(),w.getsampwidth(),w.getframerate());pcm=w.readframes(w.getnframes())
 assert spec[:2]==(1,2),spec
 if format_spec is None:format_spec=spec
 assert spec==format_spec
 rate=spec[2];samples=array.array('h',pcm);win=round(rate*.01)
 voiced=[i for i in range(0,len(samples),win) if max(map(abs,samples[i:i+win]),default=0)>120]
 first=max(0,voiced[0]-round(rate*.04));last=min(len(samples),voiced[-1]+win+round(rate*.1))
 trimmed=pcm[first*2:last*2];duration=(last-first)/rate
 with wave.open(str(audio/f"{line['id']}.wav"),'wb') as w:
  w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate);w.writeframes(trimmed)
 words=[]
 for event in Path(str(raw)+'.words.tsv').read_text(encoding='utf-8-sig').splitlines():
  at,pos,count,text=event.split('\t',3)
  words.append({'at':max(0,float(at)-first/rate),'pos':int(pos),'count':int(count),'text':text})
 for i,word in enumerate(words):word['until']=words[i+1]['at'] if i+1<len(words) else duration
 entry={**line,'start':cursor,'end':cursor+duration,'duration':duration,'words':words}
 lines.append(entry);master.extend(trimmed)
 silence=round(line['gap']*rate);master.extend(b'\0\0'*silence);cursor+=duration+silence/rate
frames=math.ceil(cursor*30);duration=frames/30
master.extend(b'\0\0'*max(0,round(duration*rate)-len(master)//2))
with wave.open(str(root/'narration.wav'),'wb') as w:
 w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate);w.writeframes(master)
plan={'id':'p2-v4','duration':duration,'frames':frames,'fps':30,'voices':{'en':'Microsoft Zira Desktop (rate 0)','zh':'Microsoft Hanhan Desktop (rate 0)'},'lines':lines}
(root/'p2-v4.plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'{duration:.3f}s / {frames} frames')
for line in lines:print(f"{line['start']:.2f}–{line['end']:.2f} {line['id']}")
