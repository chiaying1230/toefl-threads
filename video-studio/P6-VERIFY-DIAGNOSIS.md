# P6 verify failure diagnosis — shared trim/fade ordering

2026-10-13. Diagnosis only; shared fix required, so no production behavior or evidence changed.

## Evidence and reproduction

Draft elem-02 revision4, paid run `be8e6a15-8d6b-48bb-b0d9-6bb1bd575182`,
candidate `59d03732-83b3-4812-ab5e-e2cafff31d22`, execution
`87b1e0fd-ba9a-4641-979e-049cf5a17f94` completed. Run state failed at verify;
milestone mixed. Ledger has 11 attempts, each network_attempted=1, HTTP200, succeeded.
No failed/unknown attempt or synthesis retry. Additional requests during diagnosis=0.

Read-only checks against the trusted coordinator binding:

- Exact candidate engine closure PASS.
- All sealed input refs/envelopes and transitive voice-bundle evidence PASS.
- All 11 MP3/alignment pairs match BOTH sealed refs and successful-attempt ledger hashes.
- Real decode/alignment validation PASS (text, voice/model/settings, format, context,
  hash and character/timestamp consistency).
- All successful voice/assemble/camera/audit/render/mix output hashes PASS.
- The 10 existing failed verify reports reproduce the same single line failure;
  no other verify check fails in those reports.
- Unmodified shared assembleNarration on the same paid evidence reproduces exactly
  the sealed plan and WAV bytes. Only a disposable TEMP WAV was written and removed;
  original audio, alignment, sealed outputs and coordinator state remain untouched.

Machine evidence: `state/qa/p6-verify-diagnosis.json`.
Reproducer: `diagnose-p6-verify.mjs` (read-only SQLite; network/.env forbidden).

## Failing line and timing

Only `story002` — `I am sleepy.` fails. Seconds refer to the assembled narration timeline.

| Measurement | Seconds |
|---|---:|
| Plan start | 7.635011 |
| Plan end | 9.180022 |
| Actual voiced start (unchanged verifier RMS criterion) | 7.675011338 |
| Actual voiced end | 8.865011338 |

Onset is 40.000 ms after start (PASS). End is 315.011 ms after voiced end (FAIL):
255.011 ms over the existing 60 ms maximum slack. No speech overruns plan start/end;
the failure is excessive trailing slack. Existing ±10 ms measuring tolerance unchanged.
The other ten spoken lines pass (onset slack 20–40 ms; end slack 45–55 ms).

## Root cause

`scripts/video/voice/assemble.mjs` trimClip() calls voicedBounds() **before** fade():

1. story002 MP3 duration 1.600 s; main tail decays below RMS0.004 at ~1.28 s.
2. Final source 10 ms block 1.590–1.600 s has a short transient, RMS0.006195, so
   raw voicedBounds.last=1.600 s. Head onset=0.090 s; 35 ms head pad makes
   trim.from=0.054988662 s; trim.to stays1.600 s. Clip duration1.545011338 s.
3. The existing 6 ms end fade suppresses that final transient. Faded clip's voiced
   bounds become 0.040–1.230 s, while stored duration remains1.545011338 s.
4. Assembly uses that old duration for line.end and shifts every later line accordingly.
   Verify independently measures the final WAV, correctly finds 315 ms end slack.

This is a shared **assembly/silence-trimming/fade ordering** defect. Alignment is complete
and structurally valid: final punctuation extends to1.600 s; it is not the input used by
trimClip to find voiced bounds. Merely changing provider punctuation timestamps would
not fix this trim-duration defect. No parts/splits are present in this P6. The confirmed
CTA is a translation display part with no narration unit, so it is not involved.
Mix verification6/6 passes; the failing measurement reads narration.wav, not mixed MP4.
Verify itself is enforcing the existing acoustic contract correctly.

## Reuse and minimum fix proposal

Paid source MP3/alignment, their successful ledger evidence, voice bundle, input narration,
compiled human decisions and CTA/Hook data can be reused without any new synthesis.
All successful current artifacts are intact, but the old plan/WAV retain the timing bug;
camera/visibility/audit/narration-only MP4/final mix depend on that timeline and must be
rebuilt after timing is corrected. Existing rendered files are unapproved diagnostic artifacts,
not an acceptable verified final candidate.

Minimum general fix: measure voiced bounds on the final processed waveform after fade,
then reconcile trim extent/duration using existing35/50 ms pads. Rebase/clamp ORIGINAL
alignment by the exact sample offset as today; do not rewrite the sealed alignment,
hardcode sleepy/315 ms, alter RMS threshold/tolerance, or disable verification. Final
waveform bounds should be checked after any subsequent processing/PCM conversion.
Add a regression for a main voiced span followed by low-energy decay and a terminal
transient removed by fade; keep phrase/parts and all frozen behavior covered.

This changes shared voice/assemble code: owner authorization, shared revision and
P2–P5 regressions are needed. No fix was applied. Do not edit the old candidate engine,
sealed plan or receipt to accept the new code; create a new immutable candidate with
trusted current closure and import/verify the existing successful voice evidence/cache.
If voice settings/text/context remain unchanged, all11 paid pairs can be cache hits;
no new receipt or provider request is needed. Then run assemble → camera/visibility →
audit → render → mix → verify → human review. Promotion remains OFF.

Repeating the current unchanged free steps cannot repair this (byte-identical reproduction).
Repair is feasible with **0 additional ElevenLabs requests**, but blocked on shared fix
authorization. No frozen assets, tolerance, approval, promotion, freeze or git actions changed.
