import { layoutParts } from '../scripts/video/voice/segments.mjs';
import { normalizeToken, phraseTokens, findSpans } from '../scripts/video/voice/episode-refs.mjs';
import { splitSourceSentences } from './sentences.mjs';
import { AUDIO_PRESETS, textHash } from './production-decisions.mjs';
import { sourceDisplayCandidates, validateSourceDisplayOnly } from './source-display.mjs';
export const COMPILER_VERSION = '2B-1-display-only';
export const TIMINGS_ID = 'draft-timings-2A.1-v1';
export const issue = (code, path, message, extra = {}) => ({ code, path, message, ...extra });
// These are draft planning timings, not validated global production defaults.
export const DRAFT_TIMINGS = { gap: 0.08, openDuration: 0.28, closeDuration: 0.32, scrollDuration: 0.35, questionDuration: 0.8, thinkingGap: 2, answerDuration: 1.25, answerGap: 0.85 };
const cueKey = word => word.replace(/[.,]/g, '').toLowerCase();
const stripEdges = word => word.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
// The key PostTemplate.time() compares a time reference's word with: aligned token (edge punctuation stripped) without . and ,
export const rendererWord = token => stripEdges(token).replace(/[.,]/g, '').toLowerCase();
const EMOJI = /[\p{Extended_Pictographic}\uFE0F\u200D]/gu;

/** Source markers expanded to the displayed English text (emoji removed), with the exact shown forms and their ranges. */
export function expandSource(record) {
  const occurrences = [];
  let text = '', cursor = 0;
  for (const match of record.post.text.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)) {
    text += record.post.text.slice(cursor, match.index).replace(EMOJI, '');
    const shown = match[2] || record.vocabulary.find(v => v.key === match[1])?.word || match[1].replaceAll('_', ' ');
    occurrences.push({ key: match[1], shown, from: text.length, to: text.length + shown.length });
    text += shown;
    cursor = match.index + match[0].length;
  }
  text += record.post.text.slice(cursor).replace(EMOJI, '');
  return { text, occurrences };
}
/** The story sentences the compiler emits (ids story001…), for decisions that are made per sentence. */
export function normalizeStoryChinese(value) {
  if (value === undefined || value === null) return null;
  if (value.mode !== 'subtitle' || typeof value.seconds !== 'number' || !Number.isFinite(value.seconds) || value.seconds < 1 || value.seconds > 8) throw new Error('中文字幕停留時間請填 1 到 8 秒。');
  return { mode: 'subtitle', seconds: value.seconds };
}
function sourceLayout(record, chinese = null) {
  const expanded = expandSource(record), boundaries = splitSourceSentences(expanded.text);
  const prefixLength = end => expandSource({ ...record, post: { ...record.post, text: record.post.text.slice(0, end) } }).text.length;
  const candidates = sourceDisplayCandidates(record).map(c => ({ ...c, expandedFrom: prefixLength(c.from), expandedTo: prefixLength(c.to) }));
  let sentences = boundaries.sentences.map((s, i) => {
    const from = s.index + s.segment.length - s.segment.trimStart().length, to = s.index + s.segment.trimEnd().length;
    const range = candidates.find(c => from >= c.expandedFrom && to <= c.expandedTo);
    return { id: `story${String(i + 1).padStart(3, '0')}`, text: s.segment.trim(), from: s.index, to: s.index + s.segment.length, contentFrom: from, contentTo: to, displayOnlyRangeFrom: range?.from ?? null };
  });
  if (chinese) sentences = sentences.flatMap(s => {
    if (!/\p{Script=Han}/u.test(s.text)) return [s];
    // Split on script changes using exact expanded-source offsets; punctuation stays with its preceding text.
    const letters = [...s.text.matchAll(/[\p{Script=Han}A-Za-z]/gu)];
    const spans = []; let start = 0, language = /\p{Script=Han}/u.test(letters[0][0]) ? 'zh' : 'en';
    for (const m of letters) {
      const next = /\p{Script=Han}/u.test(m[0]) ? 'zh' : 'en';
      if (next !== language) { spans.push({ start, end: m.index, language }); start = m.index; language = next; }
    }
    spans.push({ start, end: s.text.length, language });
    let en = 0, zh = 0;
    return spans.map(p => {
      const raw = s.text.slice(p.start, p.end), from = s.contentFrom + p.start;
      const silentSubtitle = p.language === 'zh';
      return { ...s, id: spans.length === 1 ? s.id : `${s.id}${silentSubtitle ? `Subtitle${++zh}` : `En${++en}`}`, text: raw.trim(), from, to: s.contentFrom + p.end, contentFrom: from + raw.length - raw.trimStart().length, contentTo: s.contentFrom + p.end - (raw.length - raw.trimEnd().length), silentSubtitle };
    }).filter(p => p.text);
  });
  return { ...expanded, boundaries, candidates, sentences };
}
export function sourceSentences(record, displayOnly = [], chinese = null) {
  const confirmed = validateSourceDisplayOnly(record, displayOnly);
  return sourceLayout(record, normalizeStoryChinese(chinese)).sentences.filter(s => !s.silentSubtitle && !confirmed.some(r => r.from === s.displayOnlyRangeFrom)).map(s => ({ id: s.id, text: s.text, displayOnlyRangeFrom: s.displayOnlyRangeFrom }));
}
const boundary = /[,.;:!?]["'”’)\]]*$/;
const english = text => !/[\u3400-\u9fff]/u.test(text);
export function englishHookText(text) {
  return String(text || '').replace(/[\p{Script=Han}][\p{Script=Han}\s，。！？、；：「」『』（）]*/gu, ' ').replace(/\s+/gu, ' ').trim();
}

export function compileDraft(draft, record, { seriesConfig }) {
  const warnings = [], blocked = [], errors = [], unresolved = [];
  const block = (code, field, message) => blocked.push(issue(code, field, message));
  const pending = (code, field, message, resolvedBy) => unresolved.push(issue(code, field, message, { stage: '2B', blocks: 'production', blocksVoicePlan: false, resolvedBy }));
  const clean = (text, field) => {
    const normalized = String(text || '').replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').trim();
    if (normalized !== String(text || '').trim()) warnings.push(issue('DECORATIVE_EMOJI_REMOVED', field, '依現行內容規則移除裝飾 emoji；來源不變。'));
    return normalized;
  };
  const d = draft.decisions, production = d?.production || null;
  if (!record || record.sourceHash !== draft.sourceHash) return { status: 'failed', productionReady: false, errors: [issue('SOURCE_STALE', 'sourceHash', '來源 hash 已改變，不能編譯舊決策。')], warnings, blocked, unresolved, artifacts: null };
  if (!d?.series || !d.seriesEpisode || !d.level || !d.vocabulary?.length || !d.hook || !d.quiz) return { status: 'failed', productionReady: false, errors: [issue('DRAFT_INCOMPLETE', 'decisions', '請先保存所有明確的 metadata、詞彙、Hook 與 Quiz。')], warnings, blocked, unresolved, artifacts: null };
  if (d.hook.type !== 'scene_contrast') block('HOOK_TYPE_UNSUPPORTED', 'hook.type', 'Studio compiler 目前只編譯 scene_contrast；不更改使用者類型。');
  if (d.hook.zh !== null && typeof d.hook.zh !== 'string') block('HOOK_ZH_INVALID', 'hook.zh', 'Hook 中文必須是文字或明確的 null（無中文）。');
  const selected = d.vocabulary.map(key => record.vocabulary.find(v => v.key === key));
  if (selected.some(v => !v)) return { status: 'failed', productionReady: false, errors: [issue('VOCABULARY_MISSING', 'vocabulary', '所選詞彙不在來源。')], warnings, blocked, unresolved, artifacts: null };
  const forms = new Map(selected.map(v => [v.key, new Set()]));
  // Expand source markers first, recording exact shown forms and positions. No morphology guessing.
  let displayOnly;
  try { displayOnly = validateSourceDisplayOnly(record, d.sourceDisplayOnly); }
  catch (e) { return { status: 'failed', productionReady: false, errors: [issue('DISPLAY_ONLY_SOURCE_STALE', 'decisions.sourceDisplayOnly', e.message)], warnings, blocked, unresolved, artifacts: null }; }
  const chinese = normalizeStoryChinese(d.storyChinese);
  const { text, occurrences, boundaries, candidates, sentences: allSentences } = sourceLayout(record, chinese);
  const displayRanges = candidates.filter(c => displayOnly.some(r => r.from === c.from));
  for (const r of displayRanges) {
    if (allSentences.some(s => s.contentFrom < r.expandedTo && s.contentTo > r.expandedFrom && s.displayOnlyRangeFrom !== r.from)) block('DISPLAY_ONLY_SENTENCE_BOUNDARY', 'decisions.sourceDisplayOnly', '此段落切到未完成的句子；不能猜測 TTS boundary，請保留朗讀。');
  }
  const sentences = allSentences.filter(s => !displayRanges.some(r => r.from === s.displayOnlyRangeFrom)).map(s => ({ ...s, events: [] }));
  if (!sentences.some(s => !s.silentSubtitle)) block('DISPLAY_ONLY_NO_NARRATION', 'decisions.sourceDisplayOnly', '必須保留至少一句原文朗讀。');
  const spokenText = sentences.filter(s => !s.silentSubtitle).map(s => s.text).join('\n');
  for (const occ of occurrences) {
    const aliases=forms.get(occ.key);aliases?.add(occ.shown);
    // ReadingCue deliberately keeps punctuation other than periods/commas.
    // Carry the exact surrounding source token as a display alias (case:,
    // "case", case!) instead of changing protected cue rules or spoken text.
    if(aliases&&!/\s/u.test(occ.shown)){
      const token=[...text.matchAll(/\S+/g)].find(m=>m.index<=occ.from&&m.index+m[0].length>=occ.to);
      if(token&&normalizeToken(token[0])===normalizeToken(occ.shown))aliases.add(cueKey(token[0]));
    }
  }
  if (/\p{Extended_Pictographic}/u.test(record.post.text)) warnings.push(issue('DECORATIVE_EMOJI_REMOVED', 'story', '正文裝飾 emoji 不進旁白；js/data 保留原文。'));
  if (!english(spokenText)) block('MIXED_STORY_LANGUAGE', 'story', '原文含中文；中英混合 TTS 尚未驗證，需明確語言分段決策。');
  if (/(?:^|\s)[—–](?:\s|$)/u.test(spokenText)) block('DISPLAY_PUNCTUATION_UNSUPPORTED', 'story', '獨立破折號沒有字級 alignment；需明確顯示 / 旁白映射決策。');
  blocked.push(...boundaries.blocked.filter(b => !displayRanges.some(r => b.range && b.range.from >= r.expandedFrom && b.range.to <= r.expandedTo)));
  const first = new Map();
  for (const occ of occurrences) if (forms.has(occ.key) && !first.has(occ.key)) first.set(occ.key, occ);
  selected.forEach((v, i) => {
    const occ = first.get(v.key), sentence = occ && sentences.find(s => occ.from >= s.from && occ.to <= s.to);
    if (!sentence) { block('PHRASE_SENTENCE_BOUNDARY', `vocabulary.${v.key}`, '來源標記不在單一完整句中；不能切開詞組或猜測出現位置。'); return; }
    const toks = [...sentence.text.matchAll(/\S+/g)].map(m => ({ raw: m[0], from: m.index, to: m.index + m[0].length }));
    const leading = text.slice(sentence.from, sentence.to).length - text.slice(sentence.from, sentence.to).trimStart().length;
    const lastChar = occ.to - sentence.from - leading;
    const last = toks.findIndex(t => t.to >= lastChar);
    if (last < 0) { block('HANDOFF_TARGET_MISSING', v.key, '無法定位詞彙的最後一個 token。'); return; }
    const isBoundary = t => {
      const end = t.raw.match(/([,.;:!?])["'”’)\]]*$/);
      if (!end || !boundary.test(t.raw)) return false;
      return end[1] !== '.' || !boundaries.protectedPeriods.has(sentence.from + leading + t.from + end.index);
    };
    let cut = last; while (cut < toks.length - 1 && !isBoundary(toks[cut])) cut++;
    // open.word is a time reference: it must be the key PostTemplate.time() matches (not the ReadingCue highlight key)
    sentence.events.push({ v, index: i + 1, occ, tokens: toks, cut, after: normalizeToken(toks[last].raw), word: rendererWord(toks[cut].raw) });
  });
  const hookDisplay = clean(d.hook.text, 'hook.text');
  const hookChinese = chinese && !english(hookDisplay);
  const hookSpeech = hookChinese ? englishHookText(hookDisplay) : hookDisplay;
  const segments = [
    ...(hookChinese ? [{ id: 'hookReadingPause', kind: 'story', silent: true, text: hookDisplay, duration: chinese.seconds, gap: 0 }] : []),
    { id: 'hookLine', kind: 'story', text: hookSpeech, gap: DRAFT_TIMINGS.gap },
  ];
  const vocabulary = [], story = [], mapping = [];
  const hookText = hookSpeech;
  if (!english(hookText)) block('MIXED_HOOK_LANGUAGE', 'hook.text', '到「原文朗讀」勾選中文只顯示；開場中文留在畫面，英文才會朗讀。');
  if (!/[A-Za-z]/u.test(hookText)) block('HOOK_ENGLISH_REQUIRED', 'hook.text', '這個開場句沒有英文可朗讀。請到「開場句」補上英文，或選含英文的開場句。');
  for (const sentence of sentences) {
    if (sentence.silentSubtitle) {
      segments.push({ id: sentence.id, kind: 'story', silent: true, text: sentence.text, duration: chinese.seconds, gap: DRAFT_TIMINGS.gap });
      story.push({ id: `${sentence.id}Block`, subtitleLine: sentence.id, parts: [{ type: 'translation', text: sentence.text }] });
      continue;
    }
    sentence.events.sort((a, b) => a.cut - b.cut || a.occ.from - b.occ.from);
    const groups = [...new Set(sentence.events.map(e => e.cut))].map(cut => sentence.events.filter(e => e.cut === cut));
    const cutGroups = groups.filter(g => g[0].cut < g[0].tokens.length - 1);
    const cuts = cutGroups.map(g => g[0]);
    const parts = cuts.map((e, i) => ({ id: `${sentence.id}Part${i + 1}`, after: e.after, gap: DRAFT_TIMINGS.gap, ...(i ? { resumeAfter: `v${cutGroups[i - 1].at(-1).index}Example` } : {}) }));
    if (cuts.length) parts.push({ id: `${sentence.id}Part${cuts.length + 1}`, resumeAfter: `v${cutGroups.at(-1).at(-1).index}Example`, gap: DRAFT_TIMINGS.gap });
    const segment = { id: sentence.id, kind: 'story', text: sentence.text, gap: DRAFT_TIMINGS.gap, ...(cuts.length ? { parts } : {}) };
    const layout = cuts.length ? layoutParts(segment) : { parts: [{ id: sentence.id, text: sentence.text, charTo: sentence.text.length }], problems: [] };
    if (layout.problems.length) block('HANDOFF_LAYOUT_INVALID', sentence.id, layout.problems.join('\n'));
    cuts.forEach((e, i) => { if (layout.parts[i]?.charTo !== e.tokens[e.cut].to) block('HANDOFF_AMBIGUOUS_TARGET', sentence.id, 'after 指向重複字或與來源位置不符；不能猜切點。'); });
    segments.push(segment);
    const blockParts = [];
    layout.parts.forEach((p, i) => {
      blockParts.push({ type: 'reading', line: p.id });
      const events = i < cutGroups.length ? cutGroups[i] : groups.find(g => g[0].cut === g[0].tokens.length - 1) || [];
      for (const [groupIndex, event] of events.entries()) {
      const { v, index, word } = event;
      if (!v.zh || !v.pos || !v.ex || !v.exZh) block('VOCABULARY_SOURCE_INCOMPLETE', v.key, '詞義、詞性、英文例句或例句中文缺漏。');
      if (!word || p.text.split(/\s+/).filter(t => rendererWord(t) === word).length !== 1) block('HANDOFF_AMBIGUOUS_WORD', `${v.key}.open.word`, 'ReadingCue 會取同名字第一次出現；此切點無法唯一定位。');
      const terms = [v.word, ...forms.get(v.key)], raw = p.text.split(/\s+/);
      const singleLit = terms.filter(t => !/\s/.test(t)).some(t => raw.some(w => cueKey(w) === t.toLowerCase()));
      const phraseLit = findSpans(raw.map(normalizeToken), terms.map(phraseTokens).filter(t => t.length > 1)).length > 0;
      if (!singleLit && !phraseLit) block('SOURCE_HIGHLIGHT_UNSUPPORTED', `${v.key}.forms`, `「${v.word}」在原文「${p.text}」中暫時無法正確標示。請回到「選單字」改選其他單字，再保存並重新免費檢查。`);
      const display = d.meaningDisplay?.[v.key] || v.zh;
      const speech = d.meaningSpeech?.[v.key] || v.zh;
      if (/[—–…]/u.test(speech || '')) block('MEANING_SPEECH_REQUIRED', `${v.key}.meaningSpeech`, '來源詞義含純顯示標點；請在 Studio 明確填寫 Ling 唸法，不自動改寫來源詞義。');
      if (/[A-Za-z]/u.test(speech || '')) block('MIXED_MEANING_LANGUAGE', `${v.key}.meaningSpeech`, 'Ling 詞義段含英文；同段中英混合尚未驗證，需要明確語言分段。');
      if (!english(v.ex || '')) block('MIXED_EXAMPLE_LANGUAGE', `${v.key}.ex`, '英文例句含中文，需明確語言分段。');
      const transition = groupIndex ? `v${index}Transition` : null;
      if (transition) {
        // Close the previous card completely before opening this one; no extra TTS.
        vocabulary.at(-1).close = { line: transition };
        segments.push({ id: transition, kind: 'story', silent: true, text: '', duration: DRAFT_TIMINGS.closeDuration + DRAFT_TIMINGS.openDuration, gap: 0 });
      }
      segments.push({ id: `v${index}Meaning`, kind: 'meaning', text: clean(speech, `${v.key}.meaningSpeech`), gap: DRAFT_TIMINGS.gap }, { id: `v${index}Example`, kind: 'example', text: clean(v.ex, `${v.key}.ex`), gap: DRAFT_TIMINGS.gap });
      // Internal punctuation (e.g. mix-ups) has different keys in the legacy helpers.
      // This part ends exactly at the confirmed handoff: use its real audio end,
      // rather than inventing a word key or changing the source/paid request.
      const endHandoff = word.replace(/[^\p{L}\p{N}']/gu, '') !== word;
      const safeWord = endHandoff ? raw.map(rendererWord).find(w => terms.some(t => phraseTokens(t).includes(w)) && w.replace(/[^\p{L}\p{N}']/gu, '') === w && raw.filter(t => rendererWord(t) === w).length === 1) : word;
      if (!safeWord) block('HANDOFF_AMBIGUOUS_WORD', `${v.key}.open.word`, '這段的教學時間無法唯一定位，請選擇另一個詞彙。');
      const open = { line: p.id, word: safeWord || word };
      vocabulary.push({ id: `v${index}Note`, word: v.word, forms: [...forms.get(v.key)].filter(f => f !== v.word), zh: display, pos: v.pos, meaningLine: `v${index}Meaning`, exampleLine: `v${index}Example`, exampleZh: v.exZh, open, ...(endHandoff ? { openAtPartEnd: true } : {}), ...(transition ? { openAfterTransition: { line: transition, delay: DRAFT_TIMINGS.closeDuration } } : {}), close: null, openDuration: DRAFT_TIMINGS.openDuration, closeDuration: DRAFT_TIMINGS.closeDuration });
      blockParts.push({ type: 'vocabulary', id: `v${index}Note` });
      mapping.push({ key: v.key, form: event.occ.shown, sourceRange: { from: event.occ.from, to: event.occ.to }, sentence: sentence.id, openLine: p.id, noteId: `v${index}Note`, insertion: event.cut < event.tokens.length - 1 ? 'nearest-punctuation-after' : 'sentence-end', after: event.after, boundary: event.tokens[event.cut].raw });
      }
    });
    // A confirmed translation follows the sentence's last reading line (before a sentence-end note), as in the frozen references.
    const translation = production?.translations.mode === 'per-sentence' ? production.translations.items[sentence.id] : null;
    if (translation) {
      if (translation.sourceTextHash !== textHash(sentence.text)) block('TRANSLATION_SOURCE_STALE', `production.translations.${sentence.id}`, '句子原文已變更，翻譯需要重新確認。');
      const lastReading = blockParts.map(p => p.type).lastIndexOf('reading');
      blockParts.splice(lastReading + 1, 0, { type: 'translation', text: translation.text });
    }
    story.push({ id: `${sentence.id}Block`, parts: blockParts });
  }
  // Reuse translation parts; no narration/TTS unit. Preserve source order around spoken blocks.
  const leadingParts = [];
  for (const r of displayRanges) {
    const preceding = sentences.filter(s => s.contentTo <= r.expandedFrom).at(-1);
    const target = preceding ? story.find(b => b.id === `${preceding.id}Block`)?.parts : leadingParts;
    target?.push({ type: 'translation', text: clean(r.text, 'decisions.sourceDisplayOnly') });
  }
  if (story.length) story[0].parts.unshift(...leadingParts);
  if (displayOnly.length) warnings.push(issue('SOURCE_DISPLAY_ONLY_CONFIRMED', 'decisions.sourceDisplayOnly', '已確認原文段落保留畫面、不朗讀；沿用 translation part，顯示時機跟隨相鄰 story block。', { ranges: displayOnly }));
  // Resume on the next displayed reading line, or the silent Quiz if the story ends here.
  const order = story.flatMap(b => [...(b.subtitleLine ? [{ type: 'subtitle', line: b.subtitleLine }] : []), ...b.parts]);
  if (vocabulary.some(v => v.openAfterTransition)) {
    // A serial teaching sequence needs a visual exit before narration resumes.
    // Give collapse and camera movement their declared durations, including short replies.
    for (const v of vocabulary.filter(v => !v.close)) {
      const id = `${v.id}Resume`, at = segments.findIndex(s => s.id === v.exampleLine);
      segments.splice(at + 1, 0, { id, kind: 'story', silent: true, text: '', duration: v.closeDuration + DRAFT_TIMINGS.scrollDuration, gap: 0 });
      v.close = { line: id };
      for (const s of segments) for (const p of s.parts || []) if (p.resumeAfter === v.exampleLine) p.resumeAfter = id;
    }
    const lastReading = segments.filter(s => s.kind === 'story' && !s.silent).at(-1);
    if (lastReading) lastReading.gap = Math.max(lastReading.gap, DRAFT_TIMINGS.scrollDuration);
  }
  for (const v of vocabulary) { const i = order.findIndex(p => p.id === v.id); v.close ||= { line: order.slice(i + 1).find(p => p.type === 'reading' || p.type === 'subtitle')?.line || 'question' }; }
  const q = d.quiz;
  if (q.type !== 'meaning' || !d.vocabulary.includes(q.key)) block('QUIZ_SELECTION_INVALID', 'quiz', 'Quiz 必須是已選詞彙的 meaning 題。');
  segments.push({ id: 'question', kind: 'quiz', silent: true, text: '是什麼意思？', duration: DRAFT_TIMINGS.questionDuration, gap: DRAFT_TIMINGS.thinkingGap }, { id: 'answer', kind: 'quiz', silent: true, text: q.options?.[q.answer] || '', duration: DRAFT_TIMINGS.answerDuration, gap: DRAFT_TIMINGS.answerGap });
  const revealWord = rendererWord(hookText.split(/\s+/).at(-1) || '');
  if (!revealWord || hookText.split(/\s+/).filter(t => rendererWord(t) === revealWord).length !== 1) block('HOOK_REVEAL_AMBIGUOUS', 'hook.reveal', 'Hook 最後一個字在 Hook 中出現不只一次或沒有文字，renderer 會在第一次出現時揭曉；不能猜。');
  const episode = {
    id: `${draft.contentId}-auto`, contentId: draft.contentId, series: d.series, seriesEpisode: d.seriesEpisode, level: d.level,
    plan: `/docs/${draft.contentId}-auto/${draft.contentId}-auto.plan.json`, audio: `/docs/${draft.contentId}-auto/narration.wav`,
    brand: '● toEfu', author: { name: record.author?.name, avatar: record.author?.avatar, meta: record.author?.handle ? `@${record.author.handle}` : null }, social: record.post.topic, outside: seriesConfig.name,
    vocabulary, hook: { id: 'hook', type: d.hook.type, label: record.post.topic, setup: [hookDisplay], payoff: [], zh: typeof d.hook.zh === 'string' ? d.hook.zh.trim() || null : null, reveal: { line: 'hookLine', word: revealWord }, revealDuration: 0.16 }, story,
    // Only the deterministic initial Hook anchor exists. Story / Quiz anchors are deliberately absent.
    camera: [{ at: 0, id: 'hook', offset: 0 }], visibility: [], scrollDuration: DRAFT_TIMINGS.scrollDuration,
    quiz: { id: 'quiz', type: 'meaning', meta: '↳ 回覆這則串文', word: q.word, quote: [sentences.find(s => s.events.some(e => e.v.key === q.key))?.text || ''], question: '是什麼意思？', options: q.options, answer: q.answer, questionLine: 'question', answerLine: 'answer', feedback: `✓ ${'ABC'[q.answer]} · ${q.options?.[q.answer] || ''}`, feedbackDetail: selected.find(v => v.key === q.key)?.exZh },
    status: { reading: seriesConfig.tagline, question: '剛剛那個字，你記住了嗎？', answer: '✓ 答案揭曉', readingPhase: '● 正在朗讀', thinkingPhase: '● 換你想想', answerPhase: '● 答案揭曉' },
  };
  if (production) {
    // Confirmed Outro copy / timing. cueDuration keeps the mascot to the end of the Outro (current rule), computed per episode.
    const o = production.outro, cueDuration = +(o.duration - o.scrollDuration - 0.45).toFixed(3);
    episode.outro = { id: 'outro', start: 'planEnd', duration: o.duration, scrollDuration: o.scrollDuration, offset: o.offset, author: seriesConfig.name, lead: o.lead, cta: o.cta, words: selected.map(v => ({ en: v.word, zh: d.meaningDisplay?.[v.key] || v.zh })), brandLine: seriesConfig.tagline, status: o.status, phase: o.phase, mascot: { enabled: true, lookAt: 'cta', cueDuration } };
    const audio = AUDIO_PRESETS[production.audio.preset];
    if (audio.music) episode.music = { ...audio.music };
    if (audio.soundEffects.length) episode.soundEffects = audio.soundEffects.map(e => ({ ...e, at: { ...e.at } }));
  }
  // resolvedBy says which 2B gate closes each item: a decision (must exist before paying), the camera solver, the audit or the human review.
  pending('CAMERA_FIT_REQUIRED', 'camera', '僅有初始 Hook anchor；story / vocabulary / Quiz anchors 與 offsets 需真實 plan、geometry 擬合及 audit，不能 render。', 'camera');
  pending('VISIBILITY_UNRESOLVED', 'visibility', '未決定下一段提前出現的時間；需真實 plan 與視覺 audit，未複製 P5 visibility。', 'camera');
  if (!production) pending('OUTRO_UNRESOLVED', 'outro', 'Outro 尚無人工文案與 timing 決策，未輸出 Outro，也未套用 cueDuration=1.5。', 'decision');
  pending('LAYOUT_AUDIT_REQUIRED', 'story', '逐句文字與完整 Hook / Quiz quote 僅是內容草稿；需要實際版面檢查與分行。', 'audit');
  pending('HOOK_CHOREOGRAPHY_REVIEW', 'hook.reveal', '目前用選定英文最後一個 token 作 draft reveal reference；視覺節奏未驗證。', 'review');
  if (!production) pending('DRAFT_TIMINGS_REVIEW', 'timing', 'gap、Quiz 與教學動畫使用明確 draft planning timings，未提升為 production defaults。', 'decision');
  if (!production) pending('STORY_TRANSLATION_UNRESOLVED', 'story.translation', '保留英文原文，尚未建立可靠逐句中英對照；未猜測翻譯。', 'decision');
  else if (production.translations.mode === 'none') warnings.push(issue('STORY_TRANSLATION_NONE', 'story.translation', '你決定不顯示逐句中文翻譯；與 P2–P5 不同，人工驗收時需確認。'));
  if (!production) pending('AUDIO_PRESENTATION_UNRESOLVED', 'music', '配樂 / 答對音效尚未配置；本輪只規劃旁白。', 'decision');
  if (mapping.some(m => m.insertion === 'nearest-punctuation-after')) pending('SEAM_LISTEN_REQUIRED', 'narration.parts', '使用整句一次 TTS + parts；切點聲音自然度與 cut:late 必須生成後實聽，本輪不猜測。', 'review');
  warnings.push(issue('DRAFT_ARTIFACT_ONLY', 'episode', '這是現行 schema 的內容 / refs 草稿，不是 render-ready episode；schema PASS 不等於 production ready。'));
  // Language is a compiler contract (meaning / English story + example), never inferred from request text.
  for (const s of segments) if (!s.silent) s.language = s.kind === 'meaning' ? 'zh' : 'en';
  return { status: 'succeeded', compilerVersion: COMPILER_VERSION, errors, warnings, blocked, unresolved, productionReady: false, mapping, timings: DRAFT_TIMINGS, artifacts: { narration: { id: draft.contentId, requestContract: 'explicit-language-v1', segments }, episode } };
}
