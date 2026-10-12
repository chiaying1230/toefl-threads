# P5 (ielts-068) — first IELTS video validation (accepted 2026-10-12)

**Accepted reference:** `outputs/ielts-068-first-render.mp4` (45.033 s, 1080×1920, 30 fps, 1351 frames; narration 42.633 s + 2.4 s outro; narration + 94 BPM music + answer cue)
**Machine-readable record:** `FROZEN.json` (SHA-256 of the reference and everything it was built from). Check with `node scripts/video/check-freeze.mjs docs/ielts-068-auto/FROZEN.json`.
**Shared code:** P5 made **no** shared template / pipeline change; it is governed by `docs/p2-auto/FROZEN.json` (latest revision r8). Run all four checks (P2, P3, P4, P5).
The file name says "first-render" but it was re-rendered several times during review (Hook, Quiz option, visibility, Outro mascot changes, all episode data); only the accepted final render is the reference. Everything else is rebuildable.

Source: post `ielts-068` (`js/data/packs/ielts.js`, author `socrates`, topic Health, pack `ielts`). Teach: *in deadly earnest* (phrase), *debatable*, *frivolous*; meanings, examples and Chinese from the real pack entries.

## Series identity

| Field | P5 | Note |
|---|---|---|
| `series` | IELTS | explicit |
| `seriesEpisode` | 1 | explicit (chosen by the user) |
| `level` | `{ min: 2, max: 3 }` | shown `L2–L3` |
| `contentId` | `ielts-068` | informational |
| header (top right) | `IELTS · #01 · L2–L3` | |

## What this validation proves

| Capability | Evidence |
|---|---|
| three vocabulary items in one episode (1 phrase + 2 single words) | verify-episode: yellow handoff → meaning → example → back to story ×3 |
| handoff after a whole sentence | `earnestSent`, `debatableSent`: no boundary before the sentence end, so plain segments, note after the sentence |
| handoff at a colon | `after: "frivolous"` → cut in the silence after "frivolous:" (ratio 0.001, no warning); seam listened to and accepted by the user |
| single-line `scene_contrast` Hook | text in `setup` above the rule, empty `payoff` (rule lights on "It's"), no Chinese shown; reveal check passes |
| mixed phrase + single-word Outro | 3 rows |
| reading visibility keeps a streaming feel | next block shown while the previous sentence is read (episode `visibility`) |
| Quiz display copy shortened | option C shortened for layout; source zh unchanged |
| Outro mascot to the end | `outro.mascot.cueDuration = 1.5`: mascot visible through the whole Outro (checked at 7 points) |
| `2 a.m.` alignment | `2` and `a.m.,` are separate real tokens with real times, no warning |

Checks that passed on the accepted render: layout audit 1351 frames / 0 issues; verify-episode 12/12; audio-mix 6/6 and the re-mix reproduces the reference byte for byte; narration ↔ episode 0 problems; 92 offline tests; P2 / P3 / P4 `check-freeze` intact; ReadingCue.js sha256 unchanged (`9af099bb…`). No shared code changed, so no regression run was needed.

## Automated review warnings — human reviewed — accepted for P5 freeze

`review-visual.mjs` reported two warnings. The user watched the final video and **accepted both for the P5 freeze**. They are not open blockers.

1. **'in deadly earnest' note card height.** About 970 px in a 1024 px window; the whole card is in view about 4 % of the 6.15–13.56 s it is open.
2. **'frivolous' story phrase out of view.** While the note is open (28.17–34.81 s) the whole yellow story phrase is in view 0 % of the time; the note is fully in view.

(The 'debatable' note is fully in view and its phrase 100 %. Camera direction reversals: 0.)

## Production rules confirmed by P5 (written into `CURRENT_STATE.md` and `docs/video-design-system.md`)

- Hook keeps suspense and reveals only enough to stop the viewer; the rest goes to the story.
- Hook visuals stay minimal; no forced Chinese translation or second layer.
- Reading keeps a streaming feel: the next block appears below while the previous sentence is read.
- Quiz display copy may be shortened without changing the meaning; `js/data` is never changed for layout.
- The Outro mascot stays until close to the end of the Outro.

## Technical debt / workarounds (not rules)

- **`hook.zh = " "`** (a single space) only bypasses the non-empty check in `episode-refs.mjs`. Do not copy it. Proper support: schema / validator change + shared-template regression + a new revision.
- **`outro.mascot.cueDuration = 1.5`** is an episode-level workaround (the template hides the mascot at `start + scrollDuration + cueDuration + 0.45`). Making "mascot until the end" the default needs a shared-template revision and P2 / P3 / P4 regression.

## Not validated yet

- other Hook variants besides `number_contrast` / `scene_contrast`; other Quiz variants (only `meaning` has run)
- mixed-language narration (one take mixing Chinese and English)
- display-only punctuation mapping, a phrase interrupted inside itself, three or more interruptions in one sentence, `speak` on real content
- a Hook without a Chinese line as a supported schema (currently a workaround)

## Rebuildable, not part of the reference

`voice-cache/` (git-ignored), `outputs/ielts-068-first-render.narration-only.mp4`, `docs/ielts-068-auto/mix-work/`, `stills/`, `review-sheet.png`.
