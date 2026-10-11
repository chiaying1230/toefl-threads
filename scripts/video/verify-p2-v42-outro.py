from pathlib import Path
import hashlib, json, subprocess
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[2]
folder = root / 'docs/p2-v4.2-outro'
video = root / 'outputs/p2-v4.2-outro.mp4'
ff = r'C:\Users\123\OneDrive\桌面\Arc\tools\x64\ffmpeg-win64.exe'
fp = str(Path(ff).with_name('ffprobe-win64.exe'))
spec = json.loads((folder / 'render.json').read_text())
probe = json.loads(subprocess.check_output([fp, '-v', 'error', '-show_streams', '-of', 'json', str(video)]))
v = next(s for s in probe['streams'] if s['codec_type'] == 'video')
a = next(s for s in probe['streams'] if s['codec_type'] == 'audio')
assert (v['width'], v['height'], v['r_frame_rate']) == (1080, 1920, '30/1')
assert int(v['nb_frames']) == spec['frames']
assert abs(float(v['duration']) - spec['duration']) < .04
assert abs(float(a['duration']) - spec['duration']) < .04
decode = subprocess.run([ff, '-v', 'error', '-i', str(video), '-f', 'null', '-'], capture_output=True)
assert decode.returncode == 0 and not decode.stderr

# Compare the audible prefix of both AAC exports, including both voices and examples.
def pcm(path):
    return subprocess.check_output([ff, '-v', 'error', '-i', str(path), '-t', '24.7', '-ac', '1', '-ar', '44100', '-f', 's16le', '-'])
before, after = pcm(root / 'docs/p2-v4.2/p2-v4.2.mp4'), pcm(video)
assert before == after, 'Audible AAC prefix differs from the approved export'
hashes = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in [root / 'docs/p2-v4.2/narration.wav', root / 'docs/p2-v4.2/p2-v4.2.plan.json']}
times = [3.95, 6.7, 18.9, 26.5, 27.8, 28.9, 29.15, 29.45, 29.9, 30.5, 31.25]
sheet = Image.new('RGB', (4 * 280, 3 * 520), '#e9e3d8')
draw = ImageDraw.Draw(sheet)
for i, t in enumerate(times):
    target = folder / f'mp4-{t:g}.png'
    subprocess.run([ff, '-y', '-v', 'error', '-ss', str(t), '-i', str(video), '-frames:v', '1', '-vf', 'scale=270:480', str(target)], check=True)
    x, y = i % 4 * 280 + 5, i // 4 * 520 + 28
    sheet.paste(Image.open(target), (x, y))
    draw.text((x, y - 20), f'{t:g}s', fill='#183D69')
sheet.save(folder / 'review-sheet.png')
subprocess.run([ff, '-y', '-v', 'error', '-ss', '29.9', '-i', str(video), '-frames:v', '1', '-vf', 'scale=360:640', str(folder / 'phone-outro.png')], check=True)
result = {'resolution': [1080, 1920], 'fps': 30, 'frames': int(v['nb_frames']), 'duration': float(v['duration']), 'audio_duration': float(a['duration']), 'full_decode': 'pass', 'audible_prefix_pcm_equality': True, 'compared_seconds': 24.7, 'source_hashes': hashes, 'alignment': 'original V4.2 plan, unchanged; original observation caveats still apply', 'layout': json.loads((folder / 'layout-audit.json').read_text()), 'regression': json.loads((folder / 'regression.json').read_text())}
(folder / 'verification.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps({k: result[k] for k in ['duration', 'frames', 'full_decode', 'audible_prefix_pcm_equality']}))
