"""Reject visual changes; allow one-level raster rounding in at most 100 pixels."""
from pathlib import Path
from PIL import Image, ImageChops
import json,sys
root=Path(sys.argv[1]);report=json.loads((root/'regression.json').read_text())
observations=[]
for t in report['differences']:
 a=Image.open(root/f'regression-old-{t}.png').convert('RGB');b=Image.open(root/f'regression-new-{t}.png').convert('RGB')
 d=ImageChops.difference(a,b);peak=max(hi for lo,hi in d.getextrema());pixels=sum(any(pixel) for pixel in d.getdata())
 assert peak<=1 and pixels<=100,(t,peak,pixels)
 observations.append({'time':t,'maximum_channel_delta':peak,'changed_pixels':pixels})
report['rounding_only']=observations;report['result']='pass';report['comparison']='PNG pixels; <=1/255 channel difference in <=100 pixels permitted for raster rounding; all other frames byte-identical'
(root/'regression.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print('visual regression pass')
