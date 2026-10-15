// Human-confirmed source paragraphs only. Raw UTF-16 ranges never refer to expanded vocabulary text.
import { createHash } from 'node:crypto';
import { StudioError } from './state-contract.mjs';
const hash = text => createHash('sha256').update(text).digest('hex');
export function sourceDisplayCandidates(record) {
  const raw = record.post.text, ranges = [];
  // A complete nonempty paragraph is the smallest range this Studio adapter can safely offer.
  for (const m of raw.matchAll(/[^\r\n]+(?:\r?\n(?!\s*\r?\n)[^\r\n]+)*/g)) {
    const text = m[0].trim(); if (!text) continue;
    const from = m.index + m[0].indexOf(text), to = from + text.length;
    ranges.push({ version: 1, contentId: record.post.id, sourceHash: record.sourceHash, from, to, text, textHash: hash(text) });
  }
  return ranges;
}
const same = (a, b) => ['version', 'contentId', 'sourceHash', 'from', 'to', 'text', 'textHash'].every(k => a?.[k] === b[k]);
export function validateSourceDisplayOnly(record, value = []) {
  const bad = message => { throw Object.assign(new StudioError(`Display-only 來源決策已失效：${message}`, 409), { problems: [{ code: 'DISPLAY_ONLY_SOURCE_STALE', path: 'decisions.sourceDisplayOnly', message }] }); };
  if (!Array.isArray(value)) bad('range 必須是陣列');
  const available = record ? sourceDisplayCandidates(record) : [];
  const result = [], seen = new Set();
  for (const item of value) {
    const candidate = available.find(c => same(item, c));
    if (!candidate) bad('source hash、完整段落 range 或原文字串不再匹配；請重新確認，不會猜測新位置。');
    if (seen.has(candidate.from)) bad('重複 range');
    if (/\[\[|\]\]/.test(candidate.text)) bad('含 marked vocabulary 的段落不可排除朗讀；請保留詞彙教學來源。');
    seen.add(candidate.from); result.push({ ...candidate });
  }
  return result.sort((a, b) => a.from - b.from);
}
export function sourceDisplayReview(draft, record) {
  try { validateSourceDisplayOnly(record, draft.decisions?.sourceDisplayOnly); return { status: 'confirmed', errors: [], productionReady: false }; }
  catch (e) { return { status: 'needs_confirmation', errors: [{ code: 'DISPLAY_ONLY_SOURCE_STALE', path: 'decisions.sourceDisplayOnly', message: e.message }], productionReady: false }; }
}
