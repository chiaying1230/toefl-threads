# ElevenLabs voice pipeline

```
narration/<id>.json ──voice.mjs──▶ voice-cache/<hash>.mp3 + narration/alignment/<hash>.json + narration/<id>.manifest.json
                    ──assemble.mjs──▶ docs/<id>-auto/{narration.wav, <id>-auto.plan.json}     (local, free)
episodes/<id>-auto.json + plan + wav ──render-episode.mjs──▶ outputs/<id>.mp4
                                     ──verify-episode.mjs──▶ verification.json, review-sheet.png
episode `music` / `soundEffects` ──audio-mix.mjs──▶ <video>-music.mp4   (video stream-copied; also run by render-episode.mjs)
```

* `voice.mjs <id>` plans (nothing sent); `--yes` generates only cache misses (bills credits); `--frozen` fails if anything is missing.
* A segment's hash covers voice, model, settings, spoken text and prosody context – never gaps, cut words, display text or visuals.
* Voices and settings live in `../voices.json`; the API key only in the repo-root `.env` (`ELEVENLABS_API_KEY`, git-ignored).
* No fallback voice or TTS engine anywhere. Alignment comes from ElevenLabs only; nothing is interpolated.
* Tests (offline): `node --test scripts/video/voice/*.test.mjs`.

## Narration rule: a vocabulary note that interrupts a sentence

When the vocabulary word is **in the middle of a sentence**:

1. The sentence is **one** narration segment (one TTS call), with `parts`:
   ```json
   { "id": "first", "kind": "story", "text": "I decided to allocate ninety percent of the company budget to cardboard boxes.",
     "parts": [ { "id": "lead", "through": "allocate", "gap": 0.04 },
                { "id": "budget", "resumeAfter": "allocateExample", "gap": 0.08 } ] }
   ```
2. The part before the interruption keeps **continuation intonation** – it is cut out of the whole sentence, never
   synthesized on its own, so it is never read as a finished sentence.
3. The inserted `meaning` and `example` segments are listed right after it, as ordinary segments.
4. The rest of the sentence resumes after the last inserted segment (`resumeAfter`), still from the same take.
5. The cut is found automatically (quietest point between the two words); a `warnings` entry in `assembly.json`
   means the join is not clearly quiet and should be listened to.

Do **not** split such a sentence into two independent segments, and do not rely on `previous_text` / `next_text`
(`continuesFrom`) for this – it was tried and still sounded like two sentences.

When the vocabulary is explained **after a complete sentence**, none of this applies: use plain segments.

`speak` (when the spoken form differs from the shown text, e.g. "90%" / "ninety percent") works on segments without
`parts`; words are mapped back onto the displayed text without guessing (see `remapWordsToDisplay` in `align.mjs`).

## Audio mix (background music + sound effects)

Optional, per episode, in the episode JSON; an episode with neither renders as plain narration.

```json
"music": { "asset": "/scripts/video/assets/social-soft-groove.wav", "narrationGain": 0.16, "endingGain": 0.3,
           "riseDuration": 0.6, "fadeIn": 0.35, "fadeOut": 0.8 },
"soundEffects": [ { "asset": "/scripts/video/assets/answer-correct.wav", "at": { "line": "answer" }, "gain": 0.75 } ]
```

* `at` is a time ref: seconds, `"planEnd"`, or `{ line, word?, edge?, delay? }` resolved against the episode's plan.
* Music plays at `narrationGain` under the voice and rises to `endingGain` over `riseDuration` once the narration ends
  (`riseAt`, default the plan's `audioEnd`). It loops if shorter than the video and is cut if longer; the video length never changes.
* The narration is mixed at gain 1; the video is never re-encoded.
* `node scripts/video/audio-mix.mjs <episode.json> --video <rendered.mp4> --out <mixed.mp4>` mixes and then verifies: video stream
  untouched, same duration, no clipping, narration preserved inside the mix, music ≥ 10 dB under every spoken line, each effect
  audible at its trigger. `--reference <approved.mp4>` also compares against an approved mix sample by sample.
* Tests (offline, need ffmpeg): `node --test scripts/video/audio-mix.test.mjs scripts/video/voice/*.test.mjs`.

## Cut after a released stop consonant: `cut: "late"`

The cut between two parts is normally the quietest point between the two words. When the last word before the
interruption ends in a stop consonant that is **released into the next word** ("accused of"), the quietest point is the
stop's closure and the release burst ends up at the start of the next part (heard as "the returning"). Mark the
resuming part:

```json
{ "id": "accusedRest", "resumeAfter": "accuseExample", "cut": "late", "gap": 0.1 }
```

`late` cuts at the latest point before the next word whose 2 ms level is still under 25 % of the median speech level
(after the burst, before the vowel). It is only valid on a resuming part; without it nothing changes. Found on p348; a
sentence that breaks at a real pause (P2 "allocate") does not need it. Listen to a new interrupted sentence once.

## Known limitation: display-only punctuation

Displayed words are matched to aligned words one-to-one. A display token with no spoken word (an em dash between
spaces) has no aligned word, so the reading cue shows it as active for the whole line. Write such sentences with
commas for now (p348 does). No punctuation mapping exists yet.
