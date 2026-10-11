# P3 (p348) — first cross-episode validation (accepted 2026-10-11)

**Accepted reference:** `outputs/p348-first-render.mp4` (45.267 s, 1080×1920, 30 fps, 1358 frames; narration 42.867 s + 2.4 s outro; narration + 94 BPM music + answer cue)
**Machine-readable record:** `FROZEN.json` (SHA-256 of the reference and everything it was built from). Check with `node scripts/video/check-freeze.mjs docs/p348-auto/FROZEN.json`.
**Shared code** is not listed there: it is governed by `docs/p2-auto/FROZEN.json` (revisions r2, r3, r4 were made for this episode). Run both checks.
The video was watched and accepted as is; no further Hook / length / example / visual polish was asked for.

Source: post `p348` (`js/data/batch-10.js`, author `agatha`). Teach words: *accused* (base `accuse`), *witness*, *guilty*. *suspect* and *indicted* are plain reading.
Meanings and examples are the real entries of `batch-10.js`; levels from `levels.js`.

## What this validation proves

Everything below passed on a real run: ElevenLabs (Arthur + Ling) → cache → character alignment → words[] → assembly → render → audio mix.

| Capability | Evidence |
|---|---|
| **scene_contrast Hook** (Hook System v0, second variant) | setup + payoff, no number / ratio; payoff lights on the aligned word "now" (2.80 s); verify-episode "hook reveal happens on now" |
| **3 vocabulary** in one episode | three yellow handoffs, each open → meaning → example → back to story (verify-episode 3/3) |
| **handoff in the middle of a sentence – accused** | one TTS take cut after "accused"; story resumes 0.08 s after the example |
| **handoff in the middle of a sentence – witness** | one TTS take cut after "witness,"; story resumes 0.08 s after the example |
| **handoff at the end of a sentence – guilty** | plain sentence, note opens on its last word, story resumes at the next sentence |
| **forms / inflected word** | base `accuse`, story form `accused` (`forms`, `open.word`); the cue lit at the handoff is "accused" |
| **longer episode** | 45.3 s (P2: 30.4 s), 14 spoken segments, 18 plan lines, no problem in 1358 frames |
| **3-word Outro** | 3 rows, layout audit clean |
| **no reaction / no illustration** | `reaction` omitted; nothing in template or verification assumes a pen |
| **full automatic flow** | voice.mjs → assemble.mjs → render-episode.mjs → verify-episode.mjs → audio-mix.mjs, no hand-made file |
| **audio mix on a second episode** | video stream identical, duration unchanged, peak −4.39 dBFS, narration preserved, music ≥ 10 dB under speech, SFX at its trigger |

Checks that passed: layout audit 1358 frames / 0 issues; verify-episode 8/8; audio-mix 6/6; narration ↔ episode cross-validation 0 problems; every character alignment valid; every displayed word maps to its aligned word (apostrophes included); 57 offline tests; P2 reference intact.

### What this episode changed in shared code (all P2-regressed, recorded in `docs/p2-auto/FROZEN.json` / `FREEZE.md`)

| Rev | Change | P2 proof |
|---|---|---|
| r2 | Hook System v0: `hook.type` = `number_contrast` (default) / `scene_contrast` | 912 frames before / after: 0 differences |
| r3 | per-part `cut: "late"` (stop consonant released into the next word: "accused of" → burst was left at the start of part two, heard as "the returning") | P2 assemble byte-identical to the frozen wav / plan |
| r4 | verify-episode compares the lit cue with `open.word`, not the base form | P2 verify 7/7 |

## Not validated yet (not implemented on purpose)

- **multi-word phrase** as a teach word (highlight, handoff, outro row, quiz)
- **mixed-language narration** (a line that mixes Chinese and English in one TTS take)
- **other Hook variants** (question, quote, curiosity, reveal, pattern interrupt are text forms / devices, not variants)
- **other Quiz variants** (only the `meaning` quiz has run)
- **display-only punctuation mapping** (em dashes etc.; p348 uses the comma version)
- **a reaction other than the pen**, other illustrations
- other edge cases: a teach word that is the first or last word of the whole episode, three or more interruptions in one sentence, `speak` (spoken ≠ displayed) on real content, a vocabulary entry without an example, header fields that must come from series data (see below)

## Known limitations carried by this episode

1. **Dash sentence.** Source: "But a witness — me — saw everything." Narration / display: "But a witness, me, saw everything." Word-less display tokens (dashes) would be shown by the frozen ReadingCue as active for the whole line. Not handled, not worked around in code.
2. **Header fields without source data.** The template requires `episodeLabel`, `social`, `outside` and a few status strings. Only these are source-backed: author / handle / avatar (`characters.js`), topic `Literature`, level `L1 → L2` (min → max of the taught words in `levels.js`; inferred from P2, where it gives `L2 → L3`), series name and tagline (`series.json`). The rest are neutral values (`episodeLabel: "p348"`, `outside: "toEfu 單字情境"`, `status.reading: "用生活日常背單字"`). A real episode numbering / series rule does not exist in the data yet.
3. **Camera / visibility** are P2's values, unchanged: with real timings the audit and the review sheet showed no clipping, so no tuning was needed. They are still per-episode settings.
4. **"guilty"** — the quiz asks the 有罪 sense, the vocabulary example (from the source data) uses the 內疚 sense.
5. **suspect** (noun) pronunciation was listened to and accepted; the tool cannot verify stress.
6. The Hook label `LIBRARY COURT` is taken from the first source sentence; the Hook narration, setup and payoff are new text written for this episode (candidate A).

## Rebuildable, not part of the reference

`voice-cache/` (mp3, git-ignored), `outputs/p348-first-render.narration-only.mp4`, `docs/p348-auto/mix-work/`, `stills/`, `review-sheet.png`, the two `preview-accused-sentence-*.wav` files.
