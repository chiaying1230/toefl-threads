# Explicit language + immutable single-segment retake

2026-10-13. Zero-paid implementation; Promotion OFF. Shared revision: `r11-explicit-language-retake`, parent r10. Renderer / ReadingCue / voices.json unchanged.

## Request contract

Compiler emits `requestContract: "explicit-language-v1"` and explicit `language` per spoken segment: Chinese meaning → zh / Ling; English Hook, story and example → en / Arthur. This follows the compiler's validated kind/language contract; request text is never used to guess language. Missing, unsupported or speaker-inconsistent language blocks preparation. Silent Quiz and source display-only translation produce no request.

`prepareNarration` forwards segment language as `voice.languageCode` into the EXISTING ElevenLabs adapter. The adapter's `buildRequest` already serializes `language_code`. No second ElevenLabs client was introduced. Official API documents language_code as enforcing model/normalization language; it does not guarantee pronunciation quality: [API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps/), [short/ambiguous prompts](https://help.elevenlabs.io/hc/en-us/articles/19581255545873-How-do-I-select-the-language-and-accent).

Language is present in exact envelope/body/body hash, immutable narration, existing audio-input hash, paid preview, receipt requests, ledger body hash, sealed alignment metadata and content-addressed store identity. Language/take metadata is checked on cache validation. Legacy narration without the opt-in contract retains its original request/hash/metadata behavior for frozen references.

## Retake decision / trust root

`POST /production/retake` requires current revision, base run, full spoken TTS-unit ID, explicit rejection and reason. It verifies current source/decision identity, trusted OLD engine closure and the entire verified OLD artifact graph. Historical evidence can be inspected after a code update; old executable code is never used for production. Missing/tampered audio/alignment blocks rather than being rehashed or becoming another paid miss.

The coordinator's append-only retake snapshot records immutable take UUID, rejected old hash/evidence/reason, source/decision/revision binding, and all fixed reused take refs. Its checksum and new-run binding live outside the candidate. This is the authority for take decisions; candidate inputs are derived snapshots. Studio draft remains the authority for article/copy decisions; no article data changes.

A new candidate is compiled/validated under the explicit-language contract. Target `ttsTake.kind=retake` includes a fresh UUID in its audio identity, so even another identical-body retake cannot reuse rejected audio. Other segments have explicit `sealed-reuse` selections retaining ORIGINAL contract/hash/evidence; they are NOT claimed as cache hits for new language_code requests. They are copied to immutable pinned refs. Missing selected reuse blocks. One target → exactly one authorized request; existing receipt/ledger/zero-retry guard dispatches it only after another explicit owner confirmation.

Rejecting the old take revokes old approval/current downstream immediately. Old files, takes, sealed results and successful paid rows remain unchanged. Retake generation stops at `awaiting_take_selection`. No voice bundle, render, verify or approval is available until `POST /production/select-take` explicitly chooses the succeeded sealed take. Selection writes an immutable active-take ref/checksum. It binds the new voice step; the complete new bundle then drives fresh assemble → camera/visibility → audit → render → mix → verify → open human review. Nothing is auto-accepted/frozen/promoted.

Double clicks/retries reuse the pending take/run and existing confirmation semantics. Restart GET does not send, rebuild or choose a take. A crash after selection commits but before the FREE voice-bundle step preserves the decision and requires explicit selection-resume; no additional provider request. Failed/unknown requests retain the existing zero automatic paid retry policy; new authorization is necessary to retry.

## P6 zero-paid gate

Draft elem-02 revision5 decisions retained. Candidate `5a65b6e4-4b86-4b89-bfaa-f4880c57ecda`; run `f9daa230-7123-42c4-b068-ed3ef299b9a8`; take `0bcdf49f-7137-4623-bfb4-5ca4d7bd3725`.

Validation / retake free plan / real-geometry paid preflight PASS. 10 fixed reuse, 1 miss, 2 silent Quiz. Budget: 1 request / 4 UTF-16 submitted characters. New hash differs from rejected take. Exact body:

```json
{"text":"家庭作業","model_id":"eleven_v4","voice_settings":{"stability":0,"similarity_boost":0},"language_code":"zh"}
```

Body SHA-256: `1fb0942c102188c25f13b81477d021d8a96f9fcbe55a5b8b142530b1c3682412`. Ling voice `Z8Aisvg1z70p27kGvkZZ`; mp3_44100_128. Characters are request-length budget, not a guarantee of provider billing.

Original 1 receipt / 1 execution / 11 succeeded attempts, responses, MP3 and alignment all unchanged. New receipt/consumption/requests/paid characters/key reads: 0. Old 家庭作業 take preserved and marked human_rejected. Active take unset; productionReady false; old downstream no longer current. Null Hook and confirmed display-only CTA remain.

## UI

Open http://127.0.0.1:8140, select saved elem-02 draft and reopen it. The production envelope shows old take human rejected, target exact text/voice/model/language_code/settings, 1 request/4 chars and 10 fixed reused segments. GET/restart does not restore a paid confirmation token. Use the FREE preview button to reissue the same pending retake challenge; read the envelope and explicitly acknowledge budget/retry/billing before the paid button becomes enabled. This implementation turn never clicks it.

Future human review offers a spoken-unit selector and mandatory reason to reject a single take and create a free preview. After a paid retake succeeds, use the separate explicit active-take selection button; only then can free downstream production begin.

## Regression / limitations

- New retake tests cover language/body/cache separation, parts, immutable old evidence, one request, receipt binding, target generation without selection, duplicate confirmation, restart pending preview, crash after selection, idempotent selection, stale source/decision/metadata/audio/alignment and no automatic retry.
- Offline suite: 101 PASS (96 existing + 5 language/take tests).
- Studio final serial full suite: **192 PASS / 0 FAIL / 2 existing TODO**, 194 total, recorded in `state/qa/r11-studio-full-tests.log`. New retake suite: **10/10 PASS**. Initial parallel run had old synthetic cache metadata (11 N2 fixture failures), fixed by adding language/take metadata ONLY; assertions unchanged, targeted N2 11/11 PASS. Concurrent shared verify port caused one E2E failure; isolated and final serial reruns PASS. Existing TODOs remain R2B-07 publication marker coverage (Promotion OFF), R2B-08 no-reversal coverage (human visual review required); no scope expansion.
- GET-only live browser smoke PASS at mobile and desktop; no mutations/external requests, no confirmation token restored. Actual P6 preparation proof in `state/qa/p6-retake-preflight.json`.
- P2–P5 legacy prepared segments/hash parity, plan/WAV parity and existing surviving MP4 verify PASS. Renderer unchanged; prior r10 frame regression retained rather than rerendering frozen references.
- P3/P4/P5 stock frozen integrity PASS. P2 stock integrity currently FAIL because two pre-existing files are missing: `outputs/p2-auto-pipeline.mp4`, `outputs/p2-v4.2-outro-music.mp4`. Available frozen asset hashes all match, including the approved music MP4. No frozen files were restored/deleted/rewritten. r11 revision records this limitation explicitly rather than claiming complete frozen integrity.
- Owner subsequently confirmed both missing P2 references were intentionally cleaned up. The missing-file confirmation blocker is cleared; stock checker failure remains an acknowledged historical limitation, not a new r11 regression. No restoration or frozen metadata change. This acknowledgement does not authorize the pending paid retake.
- Non-round css/style.css / js/app.js hashes remain unchanged. No commit / push / tag.
