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
| r5-multi-word-phrase | 2026-10-11 | Multi-word vocabulary (P4 / toeic-079): a vocabulary `word` / `forms` entry with a space is a phrase, yellow only as a whole run of tokens inside one reading line (new `reference/Phrase.js`; `PostTemplate.js` annotates after ReadingCue, single words keep the old path, no phrase = no-op). `post.css`: joined phrase band, `.meaning` keep-all wrapping. `Components.js` + `outro.css`: phrase rows in the outro are English above / Chinese below. `episode-refs.mjs`: matcher twin, no-silent-failure and phrase-in-one-line checks, open.word inside the phrase (warning for a repeated open.word). `verify-episode.mjs`: two highlight checks, handoff cue checked while the open word is spoken. **ReadingCue.js unchanged.** | Baselines recorded before the change (`scripts/video/regression.mjs`, `docs/regression/`): P2 DOM snapshot + all 912 frames identical, P3 DOM snapshot + all 1358 frames identical. verify-episode on the existing P2 / P3 mp4: 9/9 and 10/10. Two deliberate matcher bugs are caught by the new checks. 74 offline tests pass (57 + 17). Nothing re-rendered, no API call. Reference groups unchanged. |
| r6-handoff-boundary | 2026-10-12 | Handoff boundary: narration `parts` may use `after: "<vocabulary's last word>"`; the sentence is interrupted at the nearest punctuation boundary (, . ; : ! ?) at or after it (the word itself counts), error if that is the sentence end (then a plain segment). `through` unchanged. `episode-refs.mjs`: open.word is inside the phrase or the last word of the line. `verify-episode.mjs`: shared token normalization ("update:"), audio-range window stops before the next line. **ReadingCue.js unchanged.** | P2 / P3 `assemble --out` byte-identical; DOM snapshots + all 912 / 1358 frames identical; verify-episode on the P2 / P3 mp4: 9/9, 10/10; 83 offline tests pass (74 + 9); P2 / P3 narrations still produce their manifests' parts and hashes. Nothing re-rendered, no API call. Reference groups unchanged. |
| r7-camera-settle-quiz-wrap | 2026-10-12 | (1) Camera bounce when a vocabulary note closes while the camera moves to the section below it: the live target moved with the collapsing note (588 px in 0.32 s), so the camera overshot and came back. `PostTemplate.js`: a camera move that overlaps a note open / close animation (`cam.settle` = end of those animations) runs between two constants (layout at its start, layout once the animations are over); a move that overlaps none keeps the live formula. (2) `post.css`: `.question` `word-break: keep-all; overflow-wrap: anywhere` – a long phrase in a Quiz question no longer splits "是什 / 麼意思？". **ReadingCue.js unchanged.** | P2: DOM snapshot + all 912 frames identical, 0 of 10 camera entries take the new path. P3: DOM snapshot + all 1358 frames identical, 0 of 12. toeic-079 old vs new template: 1322 of 1473 frames identical, only 27.10–27.57 s and 42.37–46.87 s differ; camera reversals 1 → 0. 83 offline tests pass. P2 / P3 not re-rendered, no API call. Reference groups unchanged. |
| r8-series-header-content-emoji | 2026-10-12 | Series identity: structured metadata `series` / `seriesEpisode` / `level: { min, max }` / `contentId` (explicit, never derived from the content id). New header path (`reference/Header.js` + `PostTemplate.js`): top right `series · #NN · level` (`TOEIC · #01 · L2`, `TOEFL · #02 · L1–L2`), the account row's level badge is not drawn on that path. Legacy episodes (no `series`: P2, P3) keep `episodeLabel` + level badge exactly. Content emoji default off for episodes on the new path (`episode-refs.mjs` error, `allowContentEmoji: true` as the explicit exception; `Components.js`: a scene_contrast hook needs no `emoji`). `verify-episode.mjs`: header and content-emoji checks. **ReadingCue.js unchanged.** | P2: DOM snapshot + all 912 frames identical; P3: DOM snapshot + all 1358 frames identical; P2 / P3 episode files untouched, header reported as legacy. 92 offline tests pass (83 + 9). P4 third render: audit 0, verify 11/11, mix 6/6. Nothing of P2 / P3 re-rendered, no API call. Reference groups unchanged. |

`FROZEN.json` keeps the original hashes under `hashes`; `revisions[]` holds the accepted hashes of the shared code (`check-freeze.mjs` compares against the latest).
