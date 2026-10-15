# r10 shared assembler / isolated P6 recovery

2026-10-13. Completed; MP4 available for HUMAN review. No new synthesis/payment/promotion/freeze/git action.

## Shared revision and implementation

New independent record `docs/video/revisions/r10-final-waveform-trim.json`, parent r9.
Original frozen revisions/manifests/assets untouched. Renderer, ReadingCue, alignment,
voices/settings, silence threshold0.004 and verify ±10ms / max60ms slack unchanged.

`voice/assemble.mjs` trimClip now measures the waveform AFTER the existing6ms fade,
using the same PCM16 quantization as writeWav/decode and the original decoded source's
10ms block origin. This retains exact frozen samples/timings for healthy clips instead
of shifting measurement blocks by half a block after a35ms trim. Existing35/50ms pads
are reapplied to the measured span, shrinking only; new exposed edges alone are faded,
and the final waveform is rechecked until stable (bounded8 iterations; silent/nonconverging
audio fails closed). No discarded source sample is reintroduced. Duration is audio.length/SR.
Existing rebase/clamp uses final integer sample offset/SR on original alignment; no guessed
timestamps, new alignment or episode-specific condition.

Tests cover terminal transient removed by fade, leading transient with exact offset rebase,
fully faded silence, repeat determinism and unchanged input waveform/alignment.

## Regression before P6 recovery

| Reference | Plan/timing + WAV | Full-frame/DOM compare | Existing MP4 verify |
|---|---|---|---|
| P2 | byte-identical | 912 frames, 0 difference | 10/10 |
| P3 | byte-identical | 1358 frames, 0 difference | 11/11 |
| P4 | byte-identical | 1473 frames, 0 difference | 11/11 |
| P5 | byte-identical | 1351 frames, 0 difference | 12/12 |

P2/P3 compare original golden. P4 uses the PREVIOUS r9 pre-change renderer control:
three known mascot bit-unstable frames1420/1428/1432 match existing alternates. The
original P4 golden's previously documented instability was not hidden/fixed/overwritten.
P5 uses the existing r9 pre-change temporary baseline. Renderer and all frame inputs
are unchanged. No reference MP4 or baseline rewritten. Verify output only in TEMP.
All frozen asset and manifest hashes rechecked intact; shared r10 record is external.

Complete offline tests96/96. Studio compiler/freshness/safety41/41; deterministic-retry
test1/1. The real-draft source-display test now explicitly constructs its unconfirmed
control because the owner has saved the real CTA choice; no production CTA code changed.
QA evidence: `state/qa/r10-frozen-audio.json`, `r10-frozen-checks.json`, associated logs.

## Deterministic retry gate

Studio derives `retryBlocker` when the SAME hash-verified predecessor inputs and engine
already failed with VERIFY_FAILED. UI shows DETERMINISTIC_VERIFY_BLOCKED and disables
resume; resume API409 and internal verify dispatcher refuse to create another identical
attempt. Gate survives restart. A genuinely different sealed input bundle can be verified
again; artifacts may not be overwritten or hashes rewritten. Transient/missing-report
errors keep their existing handling. Original failure evidence remains available.

## Free recovery / payment evidence

After regressions PASS, idle Studio restarted. Normal workflow recompiled the SAME
revision4 decisions (no decision mutation), invalidating old engine-bound runs.
New immutable candidate/run captures r10 closure; old paid candidate/receipt/execution/
MP3/alignment evidence preserved. Before execution, all11 new pinned cache pairs were
checked against original ledger bytes and decoded alignment/voice/text/context contracts.

New candidate: `576a0421-0114-491c-bc93-9cc3743beb73`.
New run: `51f38eec-9cdb-4e58-99e0-adfd3492245a`.
Envelope11 verified hits /0 misses /2 silent /0 requests /0 submitted characters;
no new paid challenge/receipt. Recovery explicitly disables provider/key access and
blocks .env reads. Original ledger totals before AND after:1 receipt,1 execution,
11 succeeded attempts/requests,202 request-text characters. Added all counters=0.

Assemble/camera/audit/render/mix/verify/review preparation succeeded. Final722 frames,
24.066667s. Verify12/12, all11 spoken lines' voiced-span check PASS; mix6/6.
CTA remains translation-only, no narration line; hook.zh remains null.

| story002 | Seconds / milliseconds |
|---|---:|
| Start | 7.635011s |
| End | 8.910022s |
| Voiced start | 7.675011338s |
| Voiced end | 8.865011338s |
| Onset slack | 40.000ms |
| End slack | **45.011ms** (was315.011ms) |

Audit sharedIssues=0 / extendedHard=0. One SOFT frame at7.633333s: homework's yellow
story word hidden during teaching; surfaced in camera/audit and human review warnings.
Review has6 warning acknowledgements (including existing copy/choreography warnings),
not automatically accepted. P6 has no interrupted sentence seams, but audio/visual
quality still requires the owner watching/listening.

Machine evidence: `state/qa/p6-r10-recovery.json` with artifact refs/hashes and ledger
before/after. `p6-r10-browser-smoke.mjs` passed: live MP4 playback, mobile/desktop,
GET-only/no external or mutation requests, human accept disabled until acknowledgements,
no new paid attempt or approval. Studio running at http://127.0.0.1:8140.

State awaiting_review; milestone awaiting_human_review; productionReady=false;
Promotion OFF. Owner may watch and choose Accept / Needs changes. No automatic freeze.

## Changed files

Shared: voice/assemble.mjs + assemble.test.mjs; external r10 revision record.
Studio: production.mjs + public/production.js (retry gate), source-display.test.mjs
(unconfirmed control fixture only); CURRENT_STATE.md; this report.
Added tests/helpers: verify-retry.test.mjs, r10-frozen-checks.mjs, recover-p6-r10.mjs,
p6-r10-browser-smoke.mjs. Actual production outputs only under isolated Studio state.
Unrelated css/style.css / js/app.js unchanged; no commit/push/tag.
