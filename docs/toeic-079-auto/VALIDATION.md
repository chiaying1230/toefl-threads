# P4 (toeic-079) — multi-word vocabulary validation (accepted 2026-10-12)

**Accepted reference:** `outputs/toeic-079-third-render.mp4` (49.100 s, 1080×1920, 30 fps, 1473 frames; narration 46.700 s + 2.4 s outro; narration + 94 BPM music + answer cue)
**Machine-readable record:** `FROZEN.json` (SHA-256 of the reference and everything it was built from). Check with `node scripts/video/check-freeze.mjs docs/toeic-079-auto/FROZEN.json`.
**Shared code** is not listed there: it is governed by `docs/p2-auto/FROZEN.json` (revisions r5–r8 were made for this episode). Run all three checks (P2, P3, P4).
The third render was watched and accepted as is. The first and second renders are superseded; the narration-only render and every intermediate file are rebuildable.

Source: post `toeic-079` (`js/data/packs/toeic.js`, author `beatrice`, pack `toeic`). Teach phrases: *a game of cat and mouse* and *be consumed with* (story form *was consumed with*); meanings, examples and Chinese from the real pack entries.

## Series identity

| Field | P4 | Note |
|---|---|---|
| `series` | TOEIC | the vocabulary library, explicit |
| `seriesEpisode` | 1 | explicit (chosen by the user); not derived from the content id |
| `level` | `{ min: 2, max: 2 }` | shown `L2` |
| `contentId` | `toeic-079` | informational; does not decide series or episode number |
| header (top right) | `TOEIC · #01 · L2` | the account row shows no level badge on this path |

P2 = TOEFL #01 and P3 = TOEFL #02 are recorded in `docs/video-design-system.md`; their frozen episodes keep the legacy header (`TOEFL · EP.01`, `p348`). `p1` is only a TOEFL post and was never a video.

## What this validation proves

Everything below passed on a real run: ElevenLabs (Arthur + Ling) → cache → alignment → assembly → render → audio mix.

| Capability | Rev | Evidence |
|---|---|---|
| **multi-word phrase matching** | r5 | `reference/Phrase.js`: a vocabulary `word` / `forms` entry with a space is a phrase; matched as a whole run of tokens inside one line, longest first; parity-tested against the validator twin |
| **phrase forms** | r5 | `be consumed with` (lemma) + `was consumed with` (story form) are one vocabulary; both lit in story and example |
| **phrase highlighting** | r5 | one continuous yellow span: 6 tokens (a game of cat and mouse), 3 tokens (was consumed with); a / of / and / was / with elsewhere stay plain; verify-episode 2 checks |
| **punctuation-near handoff** | r6 | `after: "with"` → the note is inserted at the comma after "queen"; "mouse" has no boundary before the sentence end, so that sentence stays whole and the note follows it. Chosen by listening (cutting right after "with" sounded like a finished sentence) |
| **structured series metadata, seriesEpisode, level range** | r8 | `series`, `seriesEpisode`, `level { min, max }`, `contentId`; validated (positive integer, 1–3, min ≤ max) |
| **new header rendering** | r8 | `TOEIC · #01 · L2`; L2 / L1–L2 and #01 / #100 forms; fits (≈ 198 px of 864 px) |
| **legacy header compatibility** | r8 | P2 / P3 have no `series`: header, level badge and all frames unchanged (912 / 1358 frames identical) |
| **content emoji default off** | r8 | none in hook, story, vocabulary, quiz, outro (validator error + rendered-text check); `allowContentEmoji` is the explicit exception; avatar and mascot are identity |
| **camera overlap fix** | r7 | a move that overlaps a note closing runs between two constants: direction reversals 1 → 0, max move 133 → 113 px/frame |
| **Quiz Chinese keep-all** | r7 | a long phrase in the question moves "是什麼意思？" to the next line whole instead of splitting 什 / 麼 |
| **phrase Outro / long titles** | r5 | English above, Chinese below, underline follows the English text; meaning title never breaks inside a Chinese word |
| **Hook without emoji** | r8 | scene_contrast with no `emoji`; payoff lit on "forgot" (2.77 s) |
| **audio mix** | — | video stream identical, duration unchanged, peak −4.44 dBFS, narration preserved, music ≥ 10 dB under speech, SFX at its trigger; re-mixing reproduces the accepted MP4 byte for byte |

Checks that passed on the accepted render: layout audit 1473 frames / 0 issues; verify-episode 11/11; audio-mix 6/6; narration ↔ episode 0 problems; 92 offline tests; P2 / P3 regression (DOM snapshot + all frames); ReadingCue.js sha256 unchanged (`9af099bb…`).

## Shared-code revisions made for this episode (details in `docs/p2-auto/FREEZE.md`)

| Rev | Change |
|---|---|
| r5 | multi-word phrase matching, phrase Outro rows, keep-all card titles, validator no-silent-failure, phrase verify checks |
| r6 | handoff boundary (`after`), shared token normalization in verify, audio-range window stops before the next line |
| r7 | camera moves that overlap a note animation, Quiz question keep-all |
| r8 | structured series metadata, new header, level badge hidden on that path, content-emoji default off |

## Not validated yet

- mixed-language narration (a line mixing Chinese and English in one take)
- other Hook variants; other Quiz variants (only `meaning` has run)
- display-only punctuation mapping (em dashes)
- a phrase interrupted inside itself, three or more interruptions in one sentence, `speak` on real content
- a phrase that appears twice in a line with a different meaning (the validator only warns about a repeated `open.word`)

## Known, not blocking (deferred by the user)

1. Hook zh states the payoff before the English reveal.
2. The answer explanation ends on a line with one character (查。) near the bottom of the window.
3. The first example sentence is long.
4. The card title breaks after "被…" (no Chinese word is split).
5. Removing the hook emoji shortened the hook by 91.8 px (it sat on its own third line). The first 4.7 s show the next paragraph higher, and text rounding differs by 1 px in places compared with the second render (verified as pure 1 px vertical shifts).
6. The P2 / P3 frozen videos still show their legacy headers (`TOEFL · EP.01`, `p348`).

## Rebuildable, not part of the reference

`voice-cache/` (git-ignored), the narration-only render, the first and second renders, `docs/toeic-079-auto/mix-work/`, `stills/`, review sheets, `seam-experiments/`, `v1-first-render/`, the preview wavs, `docs/p4-layout-test/`.
