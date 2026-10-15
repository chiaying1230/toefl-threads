// Per-sentence Chinese prefilled from the source post's own `zh` (one whole-post string, parallel to `text`). Nothing is translated
// or rewritten: each story sentence gets an exact substring of `zh` (decorative emoji removed, as translations may not carry emoji).
//
// The source has no per-sentence ids, so the two texts are aligned only by structure they both carry, and only when it agrees:
//   - the same paragraphs (line breaks), and inside each paragraph the same number of sentence units;
//   - every unit pair ends the same way (. ↔ 。, ? ↔ ？, ! ↔ ！, no punctuation ↔ none);
//   - an English unit that is already all Chinese must equal its counterpart;
//   - every Studio sentence (storyNNN) consists of whole units of one paragraph.
// Anything else is BLOCKED for the whole post (no prefill, reason reported) — never a positional guess.
import { expandSource, sourceSentences } from './compiler.mjs';
import { splitSourceSentences } from './sentences.mjs';
import { textHash } from './production-decisions.mjs';

const ZH_EMOJI = /\s*[\p{Extended_Pictographic}️‍]+/gu;
const EN_END = /(?:[。！？]+["'”’）」』\]]*|[.!?…]+["'”’）」』\]]*(?=\s|$))/g;
const ZH_END = /(?:[。！？!?…]+|\.(?=\s|$))[」』”’）)\]"']*/g;
const CJK = /[㐀-鿿]/u, LATIN = /[A-Za-z]/;
const ending = run => (run ? (/[?？]/.test(run) ? '?' : /[!！]/.test(run) ? '!' : '.') : 'none');

/** Units of one text: { paragraph, from, to, ending }. `skip(match)` drops a terminal match (protected abbreviation periods). */
function units(text, endRe, skip = () => false) {
  const out = [];
  let paragraph = -1;
  for (const p of text.matchAll(/[^\n]+/g)) {
    if (!p[0].trim()) continue;
    paragraph++;
    let start = p.index;
    const close = (to, run) => {
      const from = start + (text.slice(start, to).length - text.slice(start, to).trimStart().length);
      if (text.slice(from, to).trim()) out.push({ paragraph, from, to: from + text.slice(from, to).trim().length, ending: ending(run) });
      start = to;
    };
    for (const m of p[0].matchAll(endRe)) if (!skip(p.index + m.index, m[0])) close(p.index + m.index + m[0].length, m[0]);
    close(p.index + p[0].length, null);
  }
  return out;
}

/**
 * @returns {{ status: 'mapped' | 'blocked' | 'unavailable', source: 'post.zh', reason?: string, items: Record<string, string> }}
 * `items` is keyed by the Studio sentence id (same order and ids as sourceSentences()).
 */
export function sourceTranslations(record, { subtitle = false } = {}) {
  const result = (status, reason, items = {}) => ({ status, source: 'post.zh', ...(reason ? { reason } : {}), items });
  const zhRaw = record?.post?.zh;
  if (typeof zhRaw !== 'string' || !zhRaw.trim()) return result('unavailable', '來源沒有中文（post.zh）。');
  const { text } = expandSource(record);
  const { sentences, protectedPeriods, blocked } = splitSourceSentences(text);
  if (blocked.length) return result('blocked', '英文分句邊界尚未確定（含需人工確認的縮寫）；不自動對應中文。');
  const zh = zhRaw.replace(ZH_EMOJI, '');
  const en = units(text, EN_END, (at, run) => [...run].some((c, i) => c === '.' && protectedPeriods.has(at + i)));
  const cn = units(zh, ZH_END);
  const paragraphs = list => list.reduce((n, u) => Math.max(n, u.paragraph + 1), 0);
  if (paragraphs(en) !== paragraphs(cn)) return result('blocked', `段落數不同（英文 ${paragraphs(en)} 段、中文 ${paragraphs(cn)} 段）。`);
  if (en.length !== cn.length) return result('blocked', `句子數不同（英文 ${en.length} 句、中文 ${cn.length} 句）；中文可能合併或拆開了句子。`);
  for (let i = 0; i < en.length; i++) {
    const e = en[i], c = cn[i], enText = text.slice(e.from, e.to), zhText = zh.slice(c.from, c.to);
    if (e.paragraph !== c.paragraph) return result('blocked', `第 ${e.paragraph + 1} 段的句子數與中文不同。`);
    if (e.ending !== c.ending) return result('blocked', `「${enText}」與「${zhText}」的句尾標點類型不同。`);
    if (!subtitle && CJK.test(enText) && !LATIN.test(enText) && enText.replace(/\s/g, '') !== zhText.replace(/\s/g, '')) return result('blocked', `原文中文句「${enText}」與中文翻譯「${zhText}」不同。`);
  }
  const items = {};
  for (const [i, s] of sentences.entries()) {
    const id = `story${String(i + 1).padStart(3, '0')}`, from = s.index, to = s.index + s.segment.length;
    if (en.some(u => u.from < to && u.to > from && (u.from < from || u.to > to))) return result('blocked', `${id} 的分句邊界落在一句中文對應單位中間。`);
    const inside = en.map((u, k) => [u, k]).filter(([u]) => u.from >= from && u.to <= to);
    if (!inside.length) return result('blocked', `${id} 找不到對應的句子單位。`);
    if (new Set(inside.map(([u]) => u.paragraph)).size > 1) return result('blocked', `${id} 跨越段落。`);
    items[id] = zh.slice(cn[inside[0][1]].from, cn[inside.at(-1)[1]].to).trim();
  }
  if (!subtitle) return result('mapped', null, items);
  const target = sourceSentences(record, [], { mode: 'subtitle', seconds: 2 }), parents = sourceSentences(record), mapped = {};
  const compact = text => text.replace(/\s/gu, '');
  const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const parent of parents) {
    const children = target.filter(s => s.id === parent.id || s.id.startsWith(`${parent.id}En`));
    if (!children.length) continue; // Chinese-only source has its own display pause, not another translation.
    if (children[0].id === parent.id) { mapped[parent.id] = items[parent.id]; continue; }
    // Use unchanged Chinese around English spans as exact anchors in the parallel source translation.
    let cursor = 0, pattern = '^';
    for (const child of children) {
      const at = parent.text.indexOf(child.text, cursor);
      if (at < 0) return result('blocked', '混合句的英文位置已改變。');
      pattern += escape(compact(parent.text.slice(cursor, at))) + '(.+?)'; cursor = at + child.text.length;
    }
    pattern += escape(compact(parent.text.slice(cursor))) + '$';
    const captures = compact(items[parent.id]).match(new RegExp(pattern, 'u'));
    if (captures) children.forEach((child, i) => { mapped[child.id] = captures[i + 1]; });
    else if (children.length === 1) mapped[children[0].id] = items[parent.id]; // Chinese word order may differ; show the source's complete sentence once.
    else return result('blocked', '同一句有多個英文片段，來源中文無法分別對應。');
  }
  return result('mapped', null, mapped);
}

// Recover an already-open editor with an older proposal: complete blanks from trusted source text before validation.
// Nonempty human edits, metadata, choices and timings are preserved exactly; normal store validation still applies.
export function fillMissingSourceTranslations(record, decisions) {
  if (decisions?.production?.translations?.mode !== 'per-sentence') return decisions;
  const prefill = sourceTranslations(record, { subtitle: decisions.storyChinese?.mode === 'subtitle' });
  if (prefill.status !== 'mapped') return decisions;
  const items = { ...decisions.production.translations.items };
  for (const sentence of sourceSentences(record, decisions.sourceDisplayOnly || [], decisions.storyChinese)) {
    if (!items[sentence.id]?.text?.trim() && prefill.items[sentence.id]) items[sentence.id] = { text: prefill.items[sentence.id], sourceTextHash: textHash(sentence.text) };
  }
  return { ...decisions, production: { ...decisions.production, translations: { ...decisions.production.translations, items } } };
}
