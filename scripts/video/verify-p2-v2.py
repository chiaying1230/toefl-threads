from pathlib import Path
import json,subprocess
from PIL import Image,ImageDraw
root=Path('docs/p2-v2');video=root/'p2-v2.mp4';out=root/'mp4-stills';out.mkdir(exist_ok=True)
ffmpeg='C:/Users/123/OneDrive/桌面/Arc/tools/x64/ffmpeg-win64.exe'
ffprobe='C:/Users/123/OneDrive/桌面/Arc/tools/x64/ffprobe-win64.exe'
probe=json.loads(subprocess.check_output([ffprobe,'-v','error','-show_streams','-show_format','-of','json',str(video)]))
v=next(s for s in probe['streams'] if s['codec_type']=='video')
assert (v['width'],v['height'],v['r_frame_rate'],v['pix_fmt'])==(1080,1920,'30/1','yuv420p'),v
assert abs(float(v['duration'])-35.97)<.05
result=subprocess.run([ffmpeg,'-v','error','-i',str(video),'-f','null','-'],capture_output=True)
assert result.returncode==0 and not result.stderr,result.stderr.decode(errors='replace')
times=[0,.8,2.4,8.7,9.25,13.5,15.55,16.5,20.5,24.5,27,30,32.8,35]
files=[]
for t in times:
 p=out/f'p2-v2-{t:g}s.png';subprocess.run([ffmpeg,'-v','error','-y','-ss',str(t),'-i',str(video),'-frames:v','1',str(p)],check=True);files.append(p)
sheet=Image.new('RGB',(5*240,3*452),'#e9e9e9');d=ImageDraw.Draw(sheet)
for i,p in enumerate(files):
 im=Image.open(p).convert('RGB');assert im.size==(1080,1920);im.thumbnail((230,410));x=(i%5)*240+5;y=(i//5)*452+24;sheet.paste(im,(x,y));d.text((x,y-19),f'{times[i]:g}s',fill='black')
sheet.save(root/'sheet-review.png')
qa={'baseline_commit':'d30b706','width':v['width'],'height':v['height'],'fps':v['r_frame_rate'],'codec':v['codec_name'],'pixel_format':v['pix_fmt'],'duration_seconds':float(v['duration']),'frames':int(v['nb_frames']),'audio_tracks':sum(s['codec_type']=='audio' for s in probe['streams']),'full_decode':'pass','mp4_sample_times':times,'mp4_stills_dimensions':'all 1080x1920','scope':'scripts/ and docs/ only; p2 V2 only','notes':'Silent like the supplied baseline; no narration added.'}
(root/'verification.json').write_text(json.dumps(qa,indent=2)+'\n',encoding='utf8');print(json.dumps(qa,indent=2))

