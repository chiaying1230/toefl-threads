# P6 exact-envelope zero-paid preflight

2026-10-13 — PASS; stop at awaiting_confirmation. No receipt or synthesis.

## Minimal policy fix

Only production behavior change: Studio `production.mjs` removes the obsolete
`HOOK_ZH_UNSUPPORTED` condition requiring nonempty Chinese before payment. Hook rules
remain the current compiler/shared validator contract, bound by workflow artifact hashes.
Explicit null is valid; missing/invalid input still fails validation and never reaches preview.
Existing Chinese Hook, decision prerequisites, stale/hash checks, collisions, geometry gate,
cache validation, request budget, retry policy, challenge/receipt boundary unchanged.
No CTA wiring/shared renderer/ReadingCue change.

## Real decisions (not the earlier TEMP probe)

The owner explicitly authorized saving the already confirmed source CTA
`週末你們都去哪了 😭` as display-only in the existing live draft. Normal dry-run validation →
coordinator mutation → store update/commit was used; raw source untouched. Only the
confirmed CTA translation entry story005 is removed from spoken per-sentence decisions.
Series, episode, level, selected vocabulary, Hook, Quiz snapshot, meaning speech,
Outro, audio and policy confirmations preserved. Old workflow/receipts/approvals invalidated.

- draft: `20ee16ed-e72f-4b06-9b4c-0387fc82b0f8`; content: elem-02; revision: 4
- source hash: `0c8a6815c13e201d0707363c4b76cd436a919ae055b3f86dc194758e5673c8b9`
- workflow: voice_planned; compile succeeded / validation PASS / free plan succeeded
- production run: `730e9d62-df9c-41f5-916c-072ee976799f`, state awaiting_confirmation
- candidate: `233aaea7-7537-4d3f-be6b-8137a2aba3dd` (isolated Studio workspace)
- machine evidence: `state/qa/p6-exact-envelope-preflight.json`

The exact production preview performs real renderer card geometry measurement with a
synthetic non-production plan; parity PASS and card bounds/overflow PASS. No MP4 render.
Current production adapter buildRequest reconstructs each URL/body without credentials;
method POST, allowlisted ElevenLabs with-timestamps endpoint, voices/model/settings,
body serialization hash and UTF-16 request-text accounting all checked, never sent.

## Envelope and paid boundary

11 spoken / 2 silent Quiz. Cache hit=0, miss=11, duplicate=0. 202 request characters;
budget maxRequests=11 / maxSubmittedChars=202, automaticNetworkRetries=0,
additionalPaidAttemptsPerHash=0. This is UTF-16 request-text accounting, not an authoritative
provider-billing/currency guarantee. All eleven requests match the free plan's exact text,
ids, hash, roles, voice IDs, model, character count and part IDs; exact serialized request
body hashes are checked with the production adapter. No CTA request. No interrupted
sentence in this P6; parts arrays are empty, so there is no split synthesis.

Arthur: hookLine, story001, v1Example, story002, v2Example, story003, v3Example, story004.
Ling: v1Meaning 家庭作業, v2Meaning 想睡的, v3Meaning 週末.
Full exact request text/bodies/settings/voice IDs are in the local machine evidence.

Receipt=0 / execution=0 / attempt=0 / consumed challenge=0 / provider request=0 /
key reads=0. The free challenge is not a receipt; token is deliberately absent from this
report and machine evidence. Parent preflight blocks .env reads, key acquisition and provider
calls; only pure request reconstruction occurs. Promotion OFF; productionReady false.

## Validation

- New targeted Hook preflight tests: 7/7, including real null/Chinese geometry/envelope
  previews, restart recovery, missing/invalid Hook FAIL, other required decisions,
  canonical/series collision and artifact tamper guards. No receipt or synthesis.
- Existing targeted paid tests: 2/2 — stale receipts and too-tall card gate stop before
  provider dispatch. Not the full long regression suite.
- Real P6 exact-envelope CLI: PASS; normal production preview, not a mock bypass.
- GET-only live browser smoke: PASS after server restart; mobile/desktop; saved range,
  null Hook, workflow PASS and 11 requests/202 characters displayed. All non-GET/external
  traffic blocked. GET does not restore a paid token/button. DB counters remain zero.
- Shared r9 files and frozen P2–P5 hashes checked read-only; no shared/frozen writes.
  Prior offline 93/93 evidence remains applicable (no shared changes).

## Handoff

Studio restarted on http://127.0.0.1:8140 with the new guard. Owner must refresh the page,
load revision4 and click 「免費：重新做付費前預覽」 to obtain a current one-time challenge,
then personally inspect 11 requests / 202 characters / voices/settings/cache / no retry,
check the two acknowledgements and click 「確認產生語音」. That final paid action was
not performed by the agent. Any dependency/cache change is revalidated/fail-closed.
Machine gate does not promise real-provider output quality or later geometry solvability;
the existing later audit/verify/human review gates still apply. No promotion/freeze/git actions.

Changed: production.mjs, CURRENT_STATE.md, SOURCE-DISPLAY-ONLY.md.
Added: hook-paid-preflight.test.mjs, p6-exact-envelope-preflight.mjs,
p6-preflight-browser-smoke.mjs, this report. QA evidence/server logs are ignored local state.
