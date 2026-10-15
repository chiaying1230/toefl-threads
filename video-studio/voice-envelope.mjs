// Free confirmation envelope: what a paid voice run WOULD send, built only from the current planner / client code.
//
// prepareNarration (segment hashes, roles, speak text) → pinned cache (validated copies, never the mutable shared cache)
// → planNarration (hit / miss / duplicate / silent, characters) → buildRequest dry run (exact URL + serialized body hash).
// Nothing here sends a request or reads credentials. A cache entry that cannot be decoded / validated is quarantined and
// counted as a miss, so the displayed cost is never smaller than what would really be sent.
import fs from 'node:fs';
import path from 'node:path';
import { prepareNarration, segmentHash } from '../scripts/video/voice/segments.mjs';
import { planNarration } from '../scripts/video/voice/generate.mjs';
import { buildRequest } from '../scripts/video/voice/elevenlabs.mjs';
import { alignmentToWords } from '../scripts/video/voice/align.mjs';
import { decodeAudio, SAMPLE_RATE } from '../scripts/video/voice/audio.mjs';
import { bufferHash, fileEvidence, jsonHash, writeExclusive } from './hashing.mjs';
import { StudioError } from './state-contract.mjs';

export const ALLOWED_API_BASE = 'https://api.elevenlabs.io';
export const RETRY_POLICY = Object.freeze({ version: 1, additionalPaidAttemptsPerHash: 0, unknownOutcome: 'stop_and_reconfirm', alignmentFailure: 'reuse_response_or_stop', automaticNetworkRetries: 0 });
export const BUDGET_UNIT = 'utf16_request_text';
export const BILLING_DISCLAIMER = '估算單位是送出的 request 文字 UTF-16 長度，不是 ElevenLabs 實際扣額或金額保證；provider 是否對正規化文字、失敗請求計費，本系統沒有權威紀錄。';
export const CHALLENGE_TTL_MS = 15 * 60 * 1000;

/** Validate one MP3 + alignment pair against the exact prepared segment. Returns evidence or throws with a reason. */
export function validatePair(segment, outputFormat, audioFile, alignmentText) {
  let alignment;
  try { alignment = JSON.parse(alignmentText); } catch { throw Error('alignment JSON 無法解析'); }
  if (alignment.hash !== segment.hash) throw Error('alignment.hash 與 segment hash 不同');
  if (alignment.text !== segment.speak) throw Error('alignment 的文字與這次要唸的文字不同');
  if (alignment.voiceId !== segment.voice.voiceId || alignment.model !== segment.voice.model || jsonHash(alignment.settings || {}) !== jsonHash(segment.voice.settings || {})) throw Error('alignment 的 voice / model / settings 與目前設定不同');
  if (alignment.outputFormat !== outputFormat) throw Error('alignment 的 outputFormat 不同');
  if ((alignment.languageCode ?? null) !== (segment.voice.languageCode ?? null) || (alignment.takeId ?? null) !== (segment.voice.takeId ?? null)) throw Error('alignment language / immutable take identity 不同');
  if ((alignment.previousText ?? null) !== (segment.previousText ?? null) || (alignment.nextText ?? null) !== (segment.nextText ?? null)) throw Error('alignment 的 prosody context 不同');
  if (segmentHash({ voice: segment.voice, speak: alignment.text, previousText: alignment.previousText, nextText: alignment.nextText, outputFormat }) !== segment.hash) throw Error('依 alignment 內容重算的 hash 不符');
  let samples;
  try { samples = decodeAudio(audioFile); } catch (e) { throw Error(`MP3 無法解碼：${e.message}`); }
  const duration = samples.length / SAMPLE_RATE;
  if (!(duration > 0.05)) throw Error('MP3 沒有音訊內容');
  alignmentToWords(segment.speak, alignment.alignment, { audioDuration: duration, tolerance: 0.25, tokens: segment.lang === 'zh' ? 'none' : 'whitespace' });
  return { decodedSeconds: +duration.toFixed(3) };
}

/** Look for a validated pair in the sources (Studio voice store first, then the repo cache) and pin a copy into the candidate. */
function pin(candidate, segment, outputFormat, sources, pinDir) {
  const tried = [];
  for (const source of sources) {
    const audio = source.audio(segment.hash), alignmentFile = source.alignment(segment.hash);
    if (!fs.existsSync(audio) || !fs.existsSync(alignmentFile)) continue;
    const audioBytes = fs.readFileSync(audio), alignmentBytes = fs.readFileSync(alignmentFile);
    try {
      const evidence = validatePair(segment, outputFormat, audio, alignmentBytes.toString('utf8'));
      const dir = path.join(candidate.dir, ...pinDir.split('/'));
      const a = writeExclusive(candidate.dir, path.join(dir, `${segment.hash}.mp3`), audioBytes), j = writeExclusive(candidate.dir, path.join(dir, `${segment.hash}.json`), alignmentBytes);
      // the pinned copy must be exactly what was validated
      if (a.bytesHash !== bufferHash(audioBytes) || j.bytesHash !== bufferHash(alignmentBytes)) throw Error('pinned copy differs');
      return { hit: { hash: segment.hash, origin: source.name, audio: { path: candidate.rel(path.join(dir, `${segment.hash}.mp3`)), ...a }, alignment: { path: candidate.rel(path.join(dir, `${segment.hash}.json`)), ...j }, ...evidence }, tried };
    } catch (e) { tried.push({ origin: source.name, reason: e.message }); }
  }
  return { hit: null, tried };
}

/**
 * @returns the envelope (written to candidate inputs by the caller) – counts / chars come from planNarration, request bodies from buildRequest.
 */
export function buildEnvelope({ candidate, narration, voiceConfig, sources, bindings, pinDir = 'voice/pinned' }) {
  if (voiceConfig.apiBase !== ALLOWED_API_BASE) throw new StudioError(`Voice config apiBase 不在 allowlist（${ALLOWED_API_BASE}）`, 409);
  const prepared = prepareNarration(narration, voiceConfig, { requireApiKey: false, env: {} });
  const pinned = new Map(), quarantined = [];
  for (const s of prepared.segments) {
    if (s.silent || pinned.has(s.hash)) continue;
    const { hit, tried } = pin(candidate, s, prepared.outputFormat, sources, pinDir);
    if (hit) pinned.set(s.hash, hit);
    if (narration.segments.find(x => x.id === s.id)?.ttsTake?.kind === 'sealed-reuse' && !hit) throw new StudioError(`固定重用的 take ${s.id} 缺失或不符；不可轉成 paid miss`, 409);
    quarantined.push(...tried.map(t => ({ hash: s.hash, segment: s.id, ...t })));
  }
  const plan = planNarration(prepared, { has: h => pinned.has(h) });
  const requests = [];
  for (const s of plan.segments.filter(x => x.status === 'miss')) {
    const { url, body } = buildRequest({ voice: s.voice, text: s.speak, previousText: s.previousText ?? undefined, nextText: s.nextText ?? undefined, outputFormat: prepared.outputFormat, apiBase: prepared.apiBase });
    if (!url.startsWith(`${ALLOWED_API_BASE}/v1/text-to-speech/`)) throw new StudioError('Request URL outside allowlist', 409);
    if (narration.requestContract === 'explicit-language-v1' && !body.language_code) throw new StudioError('Spoken request 沒有 explicit language_code', 409);
    requests.push({ segmentHash: s.hash, segmentIds: plan.segments.filter(x => x.hash === s.hash).map(x => x.id), partIds: s.parts?.map(p => p.id) || [], kind: s.kind, speaker: s.voiceName, voiceId: s.voice.voiceId, model: s.voice.model, settings: s.voice.settings || {}, language: s.lang, languageCode: body.language_code ?? null, takeId: s.voice.takeId ?? null, requestBody: body, outputFormat: prepared.outputFormat, previousText: s.previousText ?? null, nextText: s.nextText ?? null, text: s.speak, chars: s.chars, url, requestBodyHash: bufferHash(Buffer.from(JSON.stringify(body))) });
  }
  const chars = requests.reduce((n, r) => n + r.chars, 0);
  const segments = plan.segments.map(s => ({ id: s.id, kind: s.kind, status: s.status, silent: Boolean(s.silent), hash: s.hash || null, speaker: s.voiceName || null, model: s.voice?.model || null, chars: s.chars || 0, text: s.speak || '', partIds: s.parts?.map(p => p.id) || [], origin: pinned.get(s.hash)?.origin || null }));
  const envelope = {
    version: 1, kind: 'free-confirmation-envelope', ...bindings,
    narrationId: prepared.id, outputFormat: prepared.outputFormat, apiBase: prepared.apiBase, playbackOrder: prepared.order,
    voiceConfigHash: jsonHash(voiceConfig), counts: plan.counts, charsFromPlanner: plan.charsToGenerate, segments,
    pinned: [...pinned.values()], pinnedCacheManifestHash: jsonHash([...pinned.values()].map(h => ({ hash: h.hash, audio: h.audio.bytesHash, alignment: h.alignment.bytesHash }))),
    quarantined, requests, confirmedMissHashes: requests.map(r => r.segmentHash),
    estimatedUniqueTextChars: chars, maxRequestChars: Math.max(0, ...requests.map(r => r.chars)),
    budget: { unit: BUDGET_UNIT, maxSubmittedChars: chars, maxRequests: requests.length, maxCharsPerRequest: Math.max(0, ...requests.map(r => r.chars)) },
    retryPolicy: RETRY_POLICY, billingDisclaimer: BILLING_DISCLAIMER, networkRequests: 0, generatedThisStep: 0,
  };
  if (chars !== plan.charsToGenerate) throw new StudioError('Envelope characters differ from the planner; refusing to show a different cost', 409);
  return envelope;
}
