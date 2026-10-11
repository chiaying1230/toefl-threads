#!/usr/bin/env python3
"""LEGACY (pre-ElevenLabs pipeline; kept until the ElevenLabs pipeline passes P2 + one new episode). Do not build new episodes on this.

Turn a plan.json from make-video.mjs into narration audio, one mp3 per line.

    pip install edge-tts
    python3 scripts/make-voice.py videos/p1.plan.json videos/p1-voice
    node scripts/make-video.mjs p1 --voice videos/p1-voice

Uses Microsoft's free Edge text-to-speech voices (needs internet). Voices, speed and pitch
per line are set in make-video.mjs (VOICES) and stored in the plan, so edit them there.
Re-run make-video.mjs with --voice afterwards: caption timing and the mouth follow the
real audio length of each line.
"""
import asyncio
import json
import sys
from pathlib import Path

import edge_tts


async def main(plan_path: str, out_dir: str) -> None:
    plan = json.loads(Path(plan_path).read_text(encoding="utf-8"))
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for line in plan["lines"]:
        if line.get("silent"):          # shown on screen only, never spoken
            continue
        v = line["voice"]
        target = out / f"line-{line['id']}.mp3"
        comm = edge_tts.Communicate(line["text"], v["voice"], rate=v["rate"], pitch=v["pitch"])
        await comm.save(str(target))
        print(f"{target.name}  [{v['voice']}]  {line['text'][:50]}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    asyncio.run(main(sys.argv[1], sys.argv[2]))
