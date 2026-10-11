"""Create a quiet two-note confirmation and mux it against unchanged narration/video."""
from pathlib import Path
import array, hashlib, json, math, subprocess, wave

root = Path(__file__).resolve().parents[2]
ff = r'C:\Users\123\OneDrive\桌面\Arc\tools\x64\ffmpeg-win64.exe'
data = json.loads((root / 'scripts/video/episodes/p2-v42-outro.json').read_text(encoding='utf-8'))
plan = json.loads((root / data['plan'].lstrip('/')).read_text(encoding='utf-8'))
cue = data['soundEffects'][0]
start = next(l['start'] for l in plan['lines'] if l['id'] == cue['at']['line'])
asset = root / cue['asset'].lstrip('/')
asset.parent.mkdir(parents=True, exist_ok=True)
rate = 44100
samples = array.array('h')
for i in range(round(.48 * rate)):
    t = i / rate
    value = 0
    for onset, freq in [(0, 783.99), (.115, 1046.50)]:
        age = t - onset
        if 0 <= age < .34:
            envelope = min(1, age / .008) * math.exp(-age * 13) * min(1, (.34 - age) / .035)
            value += .105 * envelope * (math.sin(2 * math.pi * freq * age) + .16 * math.sin(4 * math.pi * freq * age))
    samples.append(round(value * 32767))
with wave.open(str(asset), 'wb') as out:
    out.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
    out.writeframes(samples.tobytes())
source = root / 'outputs/p2-v4.2-outro.mp4'
target = root / 'outputs/p2-v4.2-outro-sfx.mp4'
duration = json.loads((root / 'docs/p2-v4.2-outro/render.json').read_text())['duration']
mix = f'[1:a]apad=whole_dur={duration}[voice];[2:a]volume={cue["gain"]},adelay={round(start*1000)}:all=1[cue];[voice][cue]amix=inputs=2:duration=first:normalize=0[a]'
subprocess.run([ff, '-y', '-v', 'error', '-i', str(source), '-i', str(root / data['audio'].lstrip('/')), '-i', str(asset), '-filter_complex', mix, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-t', str(duration), '-movflags', '+faststart', str(target)], check=True)
subprocess.run([ff, '-v', 'error', '-i', str(target), '-f', 'null', '-'], check=True)
def extract(path, args):
    return subprocess.check_output([ff, '-v', 'error', '-i', str(path), *args, '-f', 's16le', '-ac', '1', '-ar', str(rate), '-'])
assert extract(source, ['-t', '24.7']) == extract(target, ['-t', '24.7']), 'Narration changed'
def video_packets(path):
    return subprocess.check_output([ff, '-v', 'error', '-i', str(path), '-map', '0:v', '-c:v', 'copy', '-f', 'h264', '-'])
assert video_packets(source) == video_packets(target), 'Video changed'
audio = array.array('h', extract(target, ['-ss', str(start), '-t', '0.48']))
assert max(abs(s) for s in audio) > 500
result = {'output': str(target.relative_to(root)), 'cue_start_seconds': start, 'cue_duration_seconds': .48, 'cue_gain': cue['gain'], 'video_packets_identical': True, 'narration_pcm_identical_seconds': 24.7, 'full_decode': 'pass', 'cue_peak_dbfs': round(20 * math.log10(max(abs(s) for s in audio) / 32768), 2), 'asset_sha256': hashlib.sha256(asset.read_bytes()).hexdigest()}
(root / 'docs/p2-v4.2-outro/sfx-verification.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result))
