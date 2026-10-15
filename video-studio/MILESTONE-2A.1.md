# Milestone 2A.1 — review safety fixes

Scope: the five findings in REVIEW-M1-2A.md. No Milestone 2B operations.

## Changes

- Workflow reconciliation verifies producer artifacts, dependency hashes, step evidence and source/decision/compiler fingerprints on public reads, restore and mutations. Invalidations are persisted with structured reasons and archive previous evidence; affected producers and downstream results are removed from active state.
- Quiz confirmation stores the exact displayed question, target, options, answer, candidate version/hash and source/dependency evidence. Candidate drift preserves the original snapshot but requires explicit reconfirmation. Legacy snapshots without evidence cannot compile. UI submits full candidates and restores the confirmed snapshot rather than regenerating options.
- Mutations parse the request body before loading a fresh request-local catalog. Source revisions and Quiz candidate hashes are then checked synchronously before applying decisions or production steps. Stale requests fail closed.
- The Studio sentence adapter protects categorized abbreviations before segmentation, preserves original offsets/text, and blocks ambiguous boundaries. Interrupted sentences remain one TTS unit with parts. This does not change shared production schemas or validators.
- Server/store/workflow normalization explicitly sets productionReady:false for draft, workflow, step results, restored state and archived evidence. No 2A milestone can authorize production.

## Changed files

New: quiz.mjs, state-contract.mjs, sentences.mjs, sentences.test.mjs,
freshness.test.mjs, MILESTONE-2A.1.md.

Updated: catalog.mjs, store.mjs, compiler.mjs, workflow.mjs, server.mjs,
public/app.js, fixtures.mjs, studio.test.mjs, production.test.mjs,
review-safety.test.mjs, browser-smoke.mjs.

The review assertions remain intact; expected-failure annotations were removed.
Fixture/API payloads now carry full confirmation evidence. The source-race test
waits for request headers rather than expecting an early catalog load.

## Verification

- Studio suite: 39/39 PASS, including original 14, all five review safety assertions, and 20 additional abbreviation/freshness/readiness tests. No TODO or skipped tests.
- Existing offline video suite: 92/92 PASS.
- Browser smoke: mobile/desktop, persisted decisions and free plan, no-Chinese Hook failure, no overflow/browser errors/external requests. In-memory distractor drift preserves the saved snapshot, clears the plan, blocks execution and requires explicit new confirmation before replanning.
- P2/P3/P4/P5 FROZEN.json integrity checks: all PASS.
- css/style.css and js/app.js SHA256 match the start-of-task hashes.

Shared template, ReadingCue, js/data and frozen references were untouched. No
paid voice, render, freeze, P6 or git publishing operation was performed.

The five review blockers are resolved. Future 2B still requires its separately
scoped paid confirmation boundary, camera/visibility strategy, verification and
human seam review, plus safe candidate promotion. These are not implemented here.
