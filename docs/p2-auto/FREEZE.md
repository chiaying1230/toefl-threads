# P2 — FROZEN reference (2026-10-11)

**Reference video:** `outputs/p2-auto-pipeline-music.mp4` (30.400 s, 1080×1920, 30 fps, narration + 94 BPM music + answer cue)
**Narration-only companion:** `outputs/p2-auto-pipeline.mp4`
**Earlier hand-made reference (also never overwritten):** `outputs/p2-v4.2-outro-music.mp4`
**Machine-readable record:** `FROZEN.json` (SHA-256 of every file below). Check with `node scripts/video/check-freeze.mjs`.

## What P2 has verified end to end

```
episode / narration data
  → ElevenLabs TTS (Arthur = story + example, Ling = meaning)
  → content-addressed cache
  → character alignment
  → words[]
  → interrupted-sentence assembly (one take, cut after "allocate")
  → renderer
  → navy reading cue
  → yellow vocabulary handoff
  → Quiz
  → Outro
  → reusable music / SFX mix
  → final MP4
```

Checks that passed (`verification.json`, `mix-verification.json`, `mix-regression/`): every aligned word is the active navy cue at its own time;
both handoffs (open → meaning → example → back to story → close); hook reveal on "for"; quiz → think → answer; line spans enclose the audible speech;
912-frame layout audit; video stream copied untouched by the mix; duration unchanged; peak −4.02 dBFS; narration SNR 39.3 dB inside the mix;
music ≥ 17.4 dB under every spoken line; answer cue at 26.750 s; and the new mix layer reproduces the approved P2 V4.2 music mix sample for sample.

## What is frozen (do not change)

| Group in FROZEN.json | Files |
|---|---|
| referenceVideos | the two p2-auto videos |
| narrationPlanManifestAndConfig | `scripts/video/narration/p2.json`, `p2.manifest.json`, `docs/p2-auto/narration.wav`, `p2-auto.plan.json`, `scripts/video/episodes/p2-auto.json`, `scripts/video/voices.json` |
| audioAssets | `social-soft-groove.wav`, `answer-correct.wav` |
| alignment | the 12 files in `scripts/video/narration/alignment/` |
| templateAndPipeline | renderer / template / pipeline code that produced it (22 files, see FROZEN.json) |

P2's visuals, voice, timing, audio mix and renderer behaviour are not to be edited.

## Changing shared code (templateAndPipeline) later

New episodes will legitimately change the template. When a file in `templateAndPipeline` changes, `check-freeze.mjs` exits 1 and names it.
That is the signal to re-run the P2 regression before accepting the change: assemble + render p2 again and compare with the reference
(pixels, plus the audio checks in `audio-mix.mjs --reference`). The reference files themselves (any other group) must never change (exit 2).

## Known, not blocking the freeze

1. The integrated render (render-episode with music) differs in encoded bits from the first render: PSNR ≈ 41 dB average (min 39.8 dB),
   visually identical; the audio is sample-identical. Cause not investigated (probably encoder variation).
2. The legacy `lead` / `budget` generations (made before the whole-sentence rule) are still in `voice-cache/` and
   `scripts/video/narration/alignment/` (2 audio + 2 alignment files). Not cleaned up.
3. The old SAPI / edge-tts / `plan.mjs` pipeline is kept (marked LEGACY). Do not delete it before a new episode has been verified
   through the ElevenLabs pipeline.

Also true, worth knowing: none of this is committed to git yet (`scripts/video/`, `docs/`, `outputs/` are untracked). `voice-cache/` is git-ignored by design,
so the audio behind the reference lives only on this machine; `FROZEN.json` hashes detect change but cannot restore a lost file.

## Revisions of shared code

| id | date | change | P2 regression |
|---|---|---|---|
| r1-generic-validation | 2026-10-11 | `verify-episode.mjs` no longer assumes a second vocabulary or a pen reaction; new `voice/episode-refs.mjs` cross-validates narration ↔ episode (run by `voice.mjs`, `assemble.mjs`, `render-episode.mjs` before any TTS / assembly / render) | `assemble` output byte-identical to the frozen narration.wav / plan; 912-frame layout audit clean; episode ↔ narration and ↔ plan: 0 problems; verify-episode 7/7 on the existing mp4; 54 offline tests pass. Nothing re-rendered, no API call. Reference groups unchanged. |
| r2-hook-system-v0 | 2026-10-11 | Hook System v0 (for the p348 cross-episode stress test): hook is a content variant by `hook.type` – `number_contrast` (P2; the default when `type` is absent, unchanged) and `scene_contrast` (setup + payoff, no number / ratio). `Components.createHook` dispatches by type, each hook returns its own `update()`; `PostTemplate.js` calls `hook.update()`; `post.css` +`.hooksetup` / `.hookbox.scene`; `episode-refs.mjs` requires number / caption / ratio only for number_contrast, `setup` for scene_contrast, and rejects unknown types. Changed: `PostTemplate.js`, `Components.js`, `post.css`, `voice/episode-refs.mjs`. | All 912 frames of p2-auto rendered before and after and compared: 0 differences. 56 offline tests pass (54 + 2 new). Episode ↔ narration: 0 problems. Nothing re-rendered, no API call. Reference groups unchanged. |
| r3-part-cut-late | 2026-10-11 | Optional per-part `cut: "late"` (p348 "accused of": the default quietest-point cut sat in the /d/ closure and left its release burst at the start of the second part). `late` cuts after the burst, before the next word's vowel. No `cut` = unchanged. Changed: `voice/segments.mjs`, `voice/split.mjs`. | `assemble.mjs p2 --out <scratch>` byte-identical to the frozen narration.wav and plan (cmp). 57 offline tests pass (56 + 1 new). Nothing re-rendered, no API call. Reference groups unchanged. |
| r4-verify-open-word | 2026-10-11 | `verify-episode.mjs` checked the highlighted cue at a handoff against `vocabulary.word` (base form); a vocabulary read in another form (accuse → accused) failed although the right word was lit. It now checks `open.word`. P2: unchanged (`open.word` = `word`). | `verify-episode.mjs` on the existing p2 reference mp4 (output to a scratch dir): 7/7 pass. Nothing re-rendered, no API call. Reference groups unchanged. |

`FROZEN.json` keeps the original hashes under `hashes`; `revisions[]` holds the accepted hashes of the shared code (`check-freeze.mjs` compares against the latest).
