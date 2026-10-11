from pathlib import Path
import json, subprocess, math, wave
from PIL import Image, ImageDraw
ROOT=Path(r'C:\Users\123\toefl-threads\docs\p2-v4.2')
FF=r'C:\Users\123\OneDrive\桌面\Arc\tools\x64\ffmpeg-win64.exe'
FP=r'C:\Users\123\OneDrive\桌面\Arc\tools\x64\ffprobe-win64.exe'
plan=json.loads((ROOT/'p2-v4.2.plan.json').read_text(encoding='utf-8'));video=ROOT/'p2-v4.2.mp4'
probe=json.loads(subprocess.check_output([FP,'-v','error','-show_streams','-of','json',str(video)]))
v=next(s for s in probe['streams'] if s['codec_type']=='video');a=next(s for s in probe['streams'] if s['codec_type']=='audio')
assert (v['width'],v['height'],v['r_frame_rate'],v['pix_fmt'])==(1080,1920,'30/1','yuv420p')
assert int(v['nb_frames'])==plan['frames'];assert abs(float(v['duration'])-plan['duration'])<.04
result=subprocess.run([FF,'-v','error','-i',str(video),'-f','null','-'],capture_output=True);assert result.returncode==0 and not result.stderr
for l in plan['lines']:
 assert 0<=l['start']<l['end']<=plan['duration']
 for w in l['words']:assert 0<=w['at']<=w['until']<=l['duration']+.001
 assert all(x['at']<=y['at'] for x,y in zip(l['words'],l['words'][1:]))
assert all(x['end']<=y['start'] for x,y in zip(plan['lines'],plan['lines'][1:]))
q=next(l for l in plan['lines'] if l['id']=='question');ans=next(l for l in plan['lines'] if l['id']=='answer')
assert abs(ans['start']-q['end']-2)<.001
samples=ROOT/'mp4-stills';samples.mkdir(exist_ok=True)
times=[i*.5 for i in range(math.ceil(plan['duration']*2))]
subprocess.run([FF,'-y','-v','error','-i',str(video),'-vf','fps=2,scale=216:384',str(samples/'frame-%03d.png')],check=True)
sheet=Image.new('RGB',(8*226,math.ceil(len(times)/8)*412),'#e9e3d8');d=ImageDraw.Draw(sheet)
for i,t in enumerate(times):
 im=Image.open(samples/f'frame-{i+1:03d}.png');x=i%8*226+5;y=i//8*412+23;sheet.paste(im,(x,y));d.text((x,y-18),f'{t:.1f}s',fill='black')
sheet.save(ROOT/'sheet-timeline.png')
representative=[0,1.5,4,5.5,7,9,12.5,14.5,18.5,20.5,22.5,24,25.5,27.8]
sheet=Image.new('RGB',(7*260,2*490),'#e9e3d8');d=ImageDraw.Draw(sheet)
for i,t in enumerate(representative):
 path=ROOT/f'review-{t:g}.png';subprocess.run([FF,'-y','-v','error','-ss',str(t),'-i',str(video),'-frames:v','1',str(path)],check=True)
 im=Image.open(path);im.thumbnail((250,445));x=i%7*260+5;y=i//7*490+23;sheet.paste(im,(x,y));d.text((x,y-18),f'{t:g}s',fill='black')
sheet.save(ROOT/'sheet-review.png')
qa={'duration':float(v['duration']),'frames':int(v['nb_frames']),'resolution':[1080,1920],'fps':'30/1','full_decode':'pass','audio_duration':float(a['duration']),'word_events':sum(len(l['words']) for l in plan['lines']),'thinking_seconds':2,'all_frame_layout':json.loads((ROOT/'layout-audit.json').read_text())['issues'],'source_audio_duration':plan['audioEnd'],'samples':times,'listening_review':'not yet verified; tools do not expose audio perception','alignment_limit':plan['alignmentCaveat']}
(ROOT/'verification.json').write_text(json.dumps(qa,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(qa,ensure_ascii=True))
