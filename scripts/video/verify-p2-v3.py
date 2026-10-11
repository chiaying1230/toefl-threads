from pathlib import Path
import json, subprocess
from PIL import Image, ImageDraw
root=Path('docs/p2-v3')
ffmpeg='C:/Users/123/OneDrive/桌面/Arc/tools/x64/ffmpeg-win64.exe'
ffprobe='C:/Users/123/OneDrive/桌面/Arc/tools/x64/ffprobe-win64.exe'
video=root/'p2-v3.mp4'
probe=json.loads(subprocess.check_output([ffprobe,'-v','error','-show_streams','-show_format','-of','json',str(video)]))
v=next(s for s in probe['streams'] if s['codec_type']=='video')
assert (v['width'],v['height'],v['r_frame_rate'],v['pix_fmt'])==(1080,1920,'30/1','yuv420p')
assert int(v['nb_frames'])==945
decoded=subprocess.run([ffmpeg,'-v','error','-i',str(video),'-f','null','-'],capture_output=True)
assert decoded.returncode==0 and not decoded.stderr,decoded.stderr
times=[0,.8,2.9,5.9,9,12.1,12.5,12.8,15,17.5,19.6,23,24.7,25,25.6,27.5,29.5,31]
stills=root/'mp4-stills';stills.mkdir(exist_ok=True)
phone=root/'phone';phone.mkdir(exist_ok=True)
sheet=Image.new('RGB',(6*240,3*452),'#e9e3d8');draw=ImageDraw.Draw(sheet)
for i,t in enumerate(times):
 p=stills/f'p2-v3-{t:g}s.png'
 subprocess.run([ffmpeg,'-v','error','-y','-ss',str(t),'-i',str(video),'-frames:v','1',str(p)],check=True)
 im=Image.open(p).convert('RGB');im.resize((360,640),Image.Resampling.LANCZOS).save(phone/p.name)
 im.thumbnail((230,410));x=i%6*240+5;y=i//6*452+25;sheet.paste(im,(x,y));draw.text((x,y-20),f'{t:g}s',fill='black')
sheet.save(root/'sheet-review.png')
qa={'width':v['width'],'height':v['height'],'fps':v['r_frame_rate'],'duration':float(v['duration']),'frames':int(v['nb_frames']),'codec':v['codec_name'],'pixel_format':v['pix_fmt'],'full_decode':'pass','audio_tracks':sum(s['codec_type']=='audio' for s in probe['streams']),'mp4_sample_times':times,'phone_size':[360,640],'layout_audit':'158 samples; horizontal overflow only; not a comprehensive overlap/safe-area test'}
(root/'verification.json').write_text(json.dumps(qa,indent=2)+'\n',encoding='utf-8')
print(json.dumps(qa,indent=2))
