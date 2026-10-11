"""A small original instrumental bed; preserve approved narration and copied video."""
from pathlib import Path
import array, hashlib, json, math, random, subprocess, wave

root = Path(__file__).resolve().parents[2]
ff = r'C:\Users\123\OneDrive\桌面\Arc\tools\x64\ffmpeg-win64.exe'
data = json.loads((root / 'scripts/video/episodes/p2-v42-outro.json').read_text(encoding='utf-8'))
plan = json.loads((root / data['plan'].lstrip('/')).read_text(encoding='utf-8'))
spec = json.loads((root / 'docs/p2-v4.2-outro/render.json').read_text())
music, cue = data['music'], data['soundEffects'][0]
duration, rate = spec['duration'], 44100
beat = 60 / music['bpm']
buffer = array.array('f', [0]) * round(duration * rate)

def note(at, midi, length, gain, bass=False):
    freq = 440 * 2 ** ((midi - 69) / 12)
    first = round(at * rate)
    for j in range(min(round(length * rate), len(buffer) - first)):
        t = j / rate
        env = min(1, t / .018) * math.exp(-t * (3.8 if bass else 4.8)) * min(1, (length - t) / .09)
        tone = math.sin(2 * math.pi * freq * t) + (0.10 if bass else .22) * math.sin(4 * math.pi * freq * t)
        buffer[first + j] += gain * env * tone

# Cmaj7, Am7, Fmaj7, G6: warm keys, round bass, sparse offbeat melody.
chords = [(48, [60, 64, 67, 71]), (45, [60, 64, 67, 69]), (41, [60, 64, 65, 69]), (43, [59, 62, 67, 69])]
melody = [[76, 74, 71], [72, 71, 69], [69, 72, 76], [74, 71, 67]]
bars = math.ceil(duration / (4 * beat))
rng = random.Random(42)
for bar in range(bars):
    at = bar * 4 * beat
    if at > duration - 1.2:
        break
    bass, keys = chords[bar % 4]
    note(at, bass, 1.0, .14, True)
    note(at + 2 * beat, bass + 12, .65, .07, True)
    for offset, strength in [(0, .043), (1.5, .029), (3, .035)]:
        for i, pitch in enumerate(keys):
            note(at + offset * beat + i * .014, pitch, .9, strength)
    for offset, pitch in zip([.75, 2.25, 3.5], melody[bar % 4]):
        if bar % 3 != 1:
            note(at + offset * beat, pitch, .55, .035)
    # Very soft brushed ticks, without a prominent drum beat.
    for offset in [1, 3]:
        first = round((at + offset * beat) * rate)
        for j in range(min(round(.055 * rate), len(buffer) - first)):
            buffer[first + j] += .012 * rng.uniform(-1, 1) * math.exp(-j / rate * 90)

asset = root / music['asset'].lstrip('/')
samples = array.array('h', (round(max(-1, min(1, x)) * 32767) for x in buffer))
with wave.open(str(asset), 'wb') as out:
    out.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
    out.writeframes(samples.tobytes())
start = next(l['start'] for l in plan['lines'] if l['id'] == cue['at']['line'])
voice_end = plan['audioEnd']
gain = f'{music["narrationGain"]}+({music["endingGain"]}-{music["narrationGain"]})*min(1,max(0,(t-{voice_end})/{music["riseDuration"]}))'
mix = f'[1:a]apad=whole_dur={duration}[voice];[2:a]volume={cue["gain"]},adelay={round(start*1000)}:all=1[cue];[3:a]volume=\'{gain}\':eval=frame,afade=t=in:d={music["fadeIn"]},afade=t=out:st={duration-music["fadeOut"]}:d={music["fadeOut"]}[music];[voice][cue][music]amix=inputs=3:duration=first:normalize=0[a]'
source = root / 'outputs/p2-v4.2-outro.mp4'
target = root / 'outputs/p2-v4.2-outro-music.mp4'
voice = root / data['audio'].lstrip('/')
voice_hash = hashlib.sha256(voice.read_bytes()).hexdigest()
subprocess.run([ff, '-y', '-v', 'error', '-i', str(source), '-i', str(voice), '-i', str(root / cue['asset'].lstrip('/')), '-i', str(asset), '-filter_complex', mix, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', str(duration), '-movflags', '+faststart', str(target)], check=True)
subprocess.run([ff, '-v', 'error', '-i', str(target), '-f', 'null', '-'], check=True)
def video_packets(path):
    return subprocess.check_output([ff, '-v', 'error', '-i', str(path), '-map', '0:v', '-c:v', 'copy', '-f', 'h264', '-'])
assert video_packets(source) == video_packets(target)
assert hashlib.sha256(voice.read_bytes()).hexdigest() == voice_hash
pcm = array.array('h', subprocess.check_output([ff, '-v', 'error', '-i', str(target), '-map', '0:a', '-f', 's16le', '-ac', '1', '-ar', str(rate), '-']))
peak = max(abs(x) for x in pcm)
assert peak < 32760, 'Clipping detected'
assert abs(len(pcm) / rate - duration) < .05
result = {'output': str(target.relative_to(root)), 'duration': duration, 'music': 'original instrumental: warm plucked keys, soft bass, brushed ticks; no vocals', 'bpm': music['bpm'], 'gain': music, 'answer_cue_seconds': start, 'video_packets_identical': True, 'narration_source_sha256_unchanged': voice_hash, 'narration_mix_gain': 1, 'full_decode': 'pass', 'peak_dbfs': round(20 * math.log10(peak / 32768), 2)}
(root / 'docs/p2-v4.2-outro/music-verification.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result))
