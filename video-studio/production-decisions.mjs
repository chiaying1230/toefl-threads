// 2B production decisions: everything a person must decide before money is spent, because a missing decision would
// otherwise stop the run after the paid voice step (Outro copy, music / answer cue, per-sentence translations, and the
// Studio visual / timing policy). Stored in draft.decisions.production (editing it is a new revision, like every decision).
//
// The values below are PROPOSALS shown in the form, never silently applied. They repeat what the frozen references P4 / P5
// used; the canonical rules (docs/video-design-system.md) say none of these numbers is a global rule, so each episode confirms them.
import { createHash } from 'node:crypto';
import { StudioError } from './state-contract.mjs';

export const PRODUCTION_DECISIONS_VERSION = 1;
// Studio visual policy v1 (status: proposed). Insets equal the shared layout audit's limits; the reading line target equals
// fit-camera's TOP. Lookahead / blank-area numbers are Studio proposals that still need dry-run + human calibration.
export const VISUAL_POLICY = Object.freeze({
  version: 1, status: 'proposed', viewHeight: 1024, insetTop: 8, insetBottom: 10, readingTop: 110, quizTop: 35,
  firstBlockPreviewOpacity: 0.2, lookahead: 'next block appears when the previous block’s last reading line starts (minus scrollDuration)',
  maxReversalPx: 3, maxSpeedPxPerFrame: 140, blankFraction: 0.45, maxBlankDwellSeconds: 2.5, maxIterations: 6,
  anchorDelays: ['-scroll', '-half-scroll', 0],
});
export const AUDIO_PRESETS = Object.freeze({
  'reference-music-v1': {
    label: '沿用 P2–P5 的配樂與答對音效（social-soft-groove 94 BPM、answer-correct gain 0.75）',
    music: { asset: '/scripts/video/assets/social-soft-groove.wav', bpm: 94, narrationGain: 0.16, endingGain: 0.3, riseDuration: 0.6, fadeIn: 0.35, fadeOut: 0.8 },
    soundEffects: [{ asset: '/scripts/video/assets/answer-correct.wav', at: { line: 'answer' }, gain: 0.75 }],
  },
  none: { label: '不混音（只有旁白）', music: null, soundEffects: [] },
});
const OUTRO_COPY = ['lead', 'cta', 'status', 'phase'];
const EMOJI = /\p{Extended_Pictographic}/u;
export const textHash = text => createHash('sha256').update(String(text)).digest('hex').slice(0, 16);

/** `prefill` (source-translation.mjs) only proposes the source's own Chinese per sentence; it becomes a decision only when saved. */
export function productionProposal(record, decisions, sentences, prefill = null) {
  const count = decisions?.vocabulary?.length || 0;
  return {
    version: PRODUCTION_DECISIONS_VERSION,
    basis: '提案沿用 P4 / P5 reference 的文案與數值；不是 canonical 全域規則，需逐項確認或修改。',
    outro: { lead: '剛剛那篇，你看懂了。', cta: count ? `收藏這篇，記住這${['', '一', '兩', '三', '四', '五'][count] || count}個詞。` : '收藏這篇。', status: '↳ 收藏這篇', phase: '● 下次遇到就認得', duration: 2.4, scrollDuration: 0.45, offset: 35 },
    audio: { preset: 'reference-music-v1' },
    translations: { mode: 'per-sentence', items: Object.fromEntries(sentences.map(s => [s.id, { text: prefill?.status === 'mapped' ? prefill.items[s.id] ?? '' : '', sourceTextHash: textHash(s.text) }])), reference: record?.post?.zh || '', prefill: prefill && { status: prefill.status, source: prefill.source, reason: prefill.reason ?? null } },
    policy: VISUAL_POLICY,
  };
}

/** Validate what the form submitted. Returns the normalized decision or throws a 400. */
export function validateProductionDecisions(p, sentences, timingsId) {
  if (p === null || p === undefined) return null;
  const bad = message => { throw new StudioError(`Production 決策無效：${message}`); };
  if (typeof p !== 'object' || Array.isArray(p) || p.version !== PRODUCTION_DECISIONS_VERSION) bad('version');
  const o = p.outro || {};
  for (const k of OUTRO_COPY) if (typeof o[k] !== 'string' || !o[k].trim() || o[k].length > 200 || EMOJI.test(o[k])) bad(`Outro ${k} 必須是非空、無 emoji 的文字`);
  const num = (v, name, min, max) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) bad(`${name} 必須介於 ${min}–${max}`); return v; };
  const outro = { lead: o.lead.trim(), cta: o.cta.trim(), status: o.status.trim(), phase: o.phase.trim(), duration: num(o.duration, 'Outro duration', 1, 8), scrollDuration: num(o.scrollDuration, 'Outro scrollDuration', 0.1, 2), offset: num(o.offset, 'Outro offset', -400, 400) };
  if (outro.duration - outro.scrollDuration - 0.45 <= 0.2) bad('Outro duration 太短，吉祥物無法停留到結尾（duration − scrollDuration − 0.45 必須 > 0.2）');
  if (!AUDIO_PRESETS[p.audio?.preset]) bad('配樂設定');
  const t = p.translations || {};
  if (!['per-sentence', 'none'].includes(t.mode)) bad('翻譯模式');
  const items = {};
  if (t.mode === 'per-sentence') {
    for (const s of sentences) {
      const item = t.items?.[s.id];
      if (!item || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 500 || EMOJI.test(item.text)) bad(`句子 ${s.id} 的中文翻譯需要填寫（不想逐句翻譯請選「不顯示逐句翻譯」）`);
      if (item.sourceTextHash !== textHash(s.text)) bad(`句子 ${s.id} 的原文已變更，請重新確認翻譯`);
      items[s.id] = { text: item.text.trim(), sourceTextHash: item.sourceTextHash };
    }
    if (Object.keys(t.items || {}).some(id => !sentences.some(s => s.id === id))) bad('翻譯包含不存在的句子');
  }
  const c = p.confirmations || {};
  if (c.visualPolicyVersion !== VISUAL_POLICY.version) bad('請確認 Studio visual policy');
  if (c.timingsVersion !== timingsId) bad('請確認 draft timings');
  return { version: PRODUCTION_DECISIONS_VERSION, outro, audio: { preset: p.audio.preset }, translations: { mode: t.mode, items }, confirmations: { visualPolicyVersion: VISUAL_POLICY.version, timingsVersion: timingsId } };
}
