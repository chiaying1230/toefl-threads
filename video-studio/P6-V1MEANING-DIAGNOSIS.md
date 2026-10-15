# P6 v1Meaning pronunciation diagnosis (no synthesis)

2026-10-13. Human review reports 家庭作業 sounding foreign; P6 NOT accepted/frozen.
Latest actual draft is revision5, run a3a48e7d-8cb4-4671-bdc2-b6f121ae585a / candidate
11b5b79e-d7ff-4b17-895b-06acbc1c7abb, awaiting_review. Diagnosis does not mutate it.
All three meanings are cached copies of the original successful revision4 paid execution.

## Exact request comparison

| Field | v1Meaning | v2Meaning | v3Meaning |
|---|---|---|---|
| exact request text | 家庭作業 | 想睡的 | 週末 |
| UTF-16 characters | 4 | 3 | 2 |
| speaker/kind | ling / meaning | same | same |
| voice ID | Z8Aisvg1z70p27kGvkZZ | same | same |
| model | eleven_v4 | same | same |
| Studio language | zh | same | same |
| HTTP language_code | **ABSENT** | same | same |
| voice_settings | stability:0, similarity_boost:0 | same | same |
| previous_text / next_text | ABSENT (envelope null/null) | same | same |
| output format | mp3_44100_128 | same | same |
| HTTP endpoint / method | POST /v1/text-to-speech/Z8Aisvg1z70p27kGvkZZ/with-timestamps | same | same |
| response status | 200 | 200 | 200 |
| quality_check | null | null | null |
| response character-cost header | 2 | 1 | 1 |

No unique voice/model/language/settings error differentiates the rejected take. Text and
length differ; request/segment/response hashes, audio content, durations and alignment
are consequently different. A provider-cost header is not a pronunciation diagnosis.
Internal lang:zh controls Studio handling/alignment; it does not enforce provider language.
No additional language/seed/normalization/style parameter occurs in these request bodies.

v1 exact body reconstructed with production buildRequest:

```json
{"text":"家庭作業","model_id":"eleven_v4","voice_settings":{"stability":0,"similarity_boost":0}}
```

v2/v3 bodies differ ONLY in text. Reconstructed serialized body hashes match BOTH
the immutable envelope and paid ledger body_hash. No key was read or included here.

Original shared paid envelope hash:
`sha256:842e9e78507be25a05eb5427a5c6dfe0e81e755034d770b9163dc54edee370b5`.

| Segment | Audio-input hash | Request-body SHA-256 |
|---|---|---|
| v1 | f96386fe685f4785c1495c12009577d1 | 20f3548a88f89c8fd3f1babb207c9264ae845d02c6eea949f7d158f349862ab0 |
| v2 | 5978bf2c65b83fdd8f0a287642106f0d | 38993680a997fb3a5d9397a4683a8c9f5398e7be2ee2c82417712ce0aa91e202 |
| v3 | a651fed9b75661c3ef4667845828158f | 2b6389f03a716ee5551b95890b6bbf8956c56b97fb7080693b7253c0f0a243b8 |

## Original response, audio and alignment

For all3: response_ref verified against ledger, base64 audio bytes exactly equal sealed
MP3 and audio_hash, sealed alignment exactly equals returned alignment and matches
ledger alignment_hash. Current candidate's cached MP3/alignment match the originals.
Voice/text/settings/context/format, actual decoding and alignment timestamp checks PASS.

v1 MP3 hash `sha256:19b5321b8f2921bf13d8c4c81f0e88e5349d2ad0b97c06f231691f5ec405f5c8`;
alignment hash `sha256:54166728fcbe2da5830c45df4c9da02f30c00fd567b7f4b03d64b997acfa0605`.
Original MP3 (read-only):
`state/drafts/production/candidates/59d03732-83b3-4812-ab5e-e2cafff31d22/voice/sealed/f96386fe685f4785c1495c12009577d1.mp3`.

| Segment | returned characters | start times (s) | end times (s) | decoded MP3 duration |
|---|---|---|---|---:|
| v1 | 家 庭 作 業 | 0, .42, .56, .80 | .42, .56, .80, 1.36 | 1.28s |
| v2 | 想 睡 的 | 0, .40, .72 | .40, .72, 1.12 | 1.12s |
| v3 | 週 末 | 0, .32 | .32, .96 | .88s |

Normalized alignment is identical to raw alignment in all3. v1/v3 final timestamp extends
80ms past decoded length, within the existing250ms character-alignment validation limit;
not a v1-only difference. Alignment text proves text correspondence, NOT correct accent.

Direct audio provenance checks on latest revision5:

- All3 assembled PCM segments exactly equal original MP3 decode with documented
  trim/fade/PCM16 conversion (max sample error0). No substituted take/voice, phoneme
  rewriting, time stretching or sample-rate error.
- Whole plan and WAV reconstructed byte-identically from current sealed voice evidence.
- v1 occupies4.210–5.350s; MP4 narration-only vs WAV correlation0.999980175,
  SNR43.940dB (AAC encoding difference). Existing mix verification6/6, narration preserved.

The environment has no available audio-listening/ASR tool; the foreign-accent judgment
is the owner's human review, not a claimed independent listen. Direct MP3 decoding and
sample/byte checks locate ANY observed pronunciation in the original provider take,
rather than assembly/render/mix. No provider internal detected-language/phoneme/quality
evidence exists to explain why it chose that pronunciation. All omit language_code;
automatic language interpretation or model variation is plausible, NOT established.
No unique misassigned request setting was found. A same-settings reroll is not guaranteed
to correct pronunciation.

## Single-segment regeneration boundary

Technically only v1 can be re-recorded: same text/voice,1 request,4 submitted UTF-16
characters, other10 takes reused. Provider billing is not guaranteed to equal UTF-16
length or the old reported character-cost2. There is no authorization for that request yet.

CURRENT Studio does NOT expose a safe forced regeneration for an already-succeeded
human-rejected take. Successful same-hash pairs remain cache hits; VoiceStore rejects
different bytes under the same hash. recoveryPreview handles failed/unknown/expired
executions, not completed takes. Deleting cache, overwriting MP3, changing text/voice
or rerendering alone would not be a valid solution.

Required minimum contract before paying again (proposal, NOT implemented): explicit
target v1Meaning + old evidence + immutable new take/variant ID; preserve originals;
receipt binds exact body/settings and budget maxRequests1/maxSubmittedChars4; other10
selected refs remain pinned; zero automatic retry. The selected take decision must go
through normal coordinator mutation/revision, revoke old run/approval/review evidence,
and bind a NEW voice bundle. Rebuild assemble → camera/visibility → audit → render →
mix → verify → human review under the new bundle hashes. Current generic freshness
gates can invalidate such a new bundle, but the take-selection/regeneration entry and
cache-variant semantics are not implemented/tested, so correctness is not claimed today.

This diagnosis added0 requests/characters/receipts. Ledger remains11 attempted/succeeded
requests,202 reserved request-text characters. No secret, decision mutation, automatic
approval, promotion, freeze or git action. Production code unchanged; only this report,
diagnose-p6-meaning.mjs and local QA evidence were added (CURRENT_STATE annotated).
