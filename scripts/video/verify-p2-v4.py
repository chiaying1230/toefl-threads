from pathlib import Path
import json, subprocess, wave, array, math
from PIL import Image, ImageDraw
root=Path('docs/p2-v4');video=root/'p2-v4.mp4'
ffmpeg='C:/Users/123/OneDrive/桌面/Arc/tools/x64/ffmpeg-win64.exe'
ffprobe='C:/Users/123/OneDrive/桌面/Arc/tools/x64/ffprobe-win64.exe'
plan=json.loads((root/'p2-v4.plan.json').read_text(encoding='utf-8'))
probe=json.loads(subprocess.check_output([ffprobe,'-v','error','-show_streams','-show_format','-of','json',str(video)]))
v=next(s for s in probe['streams'] if s['codec_type']=='video');a=next(s for s in probe['streams'] if s['codec_type']=='audio')
assert (v['width'],v['height'],v['r_frame_rate'],v['pix_fmt'])==(1080,1920,'30/1','yuv420p')
assert int(v['nb_frames'])==plan['frames'];assert abs(float(v['duration'])-plan['duration'])<.04
decoded=subprocess.run([ffmpeg,'-v','error','-i',str(video),'-f','null','-'],capture_output=True)
assert decoded.returncode==0 and not decoded.stderr,decoded.stderr
# Full chronological sequence at 0.5s, plus representative frames and transitions.
review=root/'mp4-stills';review.mkdir(exist_ok=True);phone=root/'phone';phone.mkdir(exist_ok=True)
times=[i*.5 for i in range(math.ceil(plan['duration']*2))]
sheet=Image.new('RGB',(8*220,math.ceil(len(times)/8)*416),'#e9e3d8');d=ImageDraw.Draw(sheet)
for i,t in enumerate(times):
 p=review/f'p2-v4-{t:g}s.png'
 subprocess.run([ffmpeg,'-v','error','-y','-ss',str(t),'-i',str(video),'-frames:v','1',str(p)],check=True)
 im=Image.open(p).convert('RGB');im.resize((360,640),Image.Resampling.LANCZOS).save(phone/p.name)
 im.thumbnail((210,374));x=i%8*220+5;y=i//8*416+24;sheet.paste(im,(x,y));d.text((x,y-20),f'{t:g}s',fill='black')
sheet.save(root/'sheet-timeline.png')
representative=[0,1.5,4,6.5,9,12,14,17.5,20,22.5,24,26]
sheet=Image.new('RGB',(6*260,2*487),'#e9e3d8');d=ImageDraw.Draw(sheet)
for i,t in enumerate(representative):
 im=Image.open(review/f'p2-v4-{t:g}s.png').convert('RGB');im.thumbnail((250,445));x=i%6*260+5;y=i//6*487+24;sheet.paste(im,(x,y));d.text((x,y-20),f'{t:g}s',fill='black')
sheet.save(root/'sheet-review.png')
# Check event positions against actual trimmed WAVs; no estimates from word counts.
events=0
for line in plan['lines']:
 with wave.open(str(root/'audio'/f"{line['id']}.wav")) as w:duration=w.getnframes()/w.getframerate()
 assert abs(duration-line['duration'])<1e-6
 assert all(0<=word['at']<=duration+.04 for word in line['words']),line['id']
 assert all(x['at']<=y['at'] for x,y in zip(line['words'],line['words'][1:])),line['id']
 events+=len(line['words'])
assert next(l for l in plan['lines'] if l['id']=='answer')['start']-next(l for l in plan['lines'] if l['id']=='question')['end']>=1.99
qa={'width':v['width'],'height':v['height'],'duration':float(v['duration']),'frames':int(v['nb_frames']),'fps':v['r_frame_rate'],'video_codec':v['codec_name'],'audio_codec':a['codec_name'],'audio_duration':float(a['duration']),'full_decode':'pass','word_timestamps_checked':events,'thinking_seconds':2.0,'samples':times,'phone_size':[360,640],'playback_review':'full timeline sampled every 0.5s; no connected UI playback surface; live listening not verified','audio':'local installed Windows TTS; boundary silence trimmed, no time-stretch'}
(root/'verification.json').write_text(json.dumps(qa,indent=2)+'\n',encoding='utf-8')
print(json.dumps(qa,indent=2))
