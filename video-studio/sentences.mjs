const TITLES = ['Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Rev', 'Capt', 'Lt', 'Sgt'];
const CONTINUATIONS = ['e.g', 'i.e'];
const CONTEXTUAL = ['U.S', 'U.K', 'a.m', 'p.m', 'etc', 'vs', 'approx', 'Inc', 'Co', 'Ltd', 'Dept', 'Fig', 'No'];
const names = [...TITLES, ...CONTINUATIONS, ...CONTEXTUAL];
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const abbreviation = new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.map(escape).sort((a, b) => b.length - a.length).join('|')})\\.`, 'giu');
const token = rest => rest.match(/^[\s,"'“”‘’([{;:]*([\p{L}\p{N}][\p{L}\p{N}'’-]*)/u)?.[1];
const periodMask = '\uE000'; // same UTF-16 length: all ranges still refer to the original text
const sentenceStarters = new Set(['I', 'We', 'You', 'He', 'She', 'It', 'They', 'The', 'This', 'That']);
const timeZones = new Set(['UTC', 'GMT', 'EST', 'EDT', 'CST', 'CDT', 'MST', 'MDT', 'PST', 'PDT']);

export function splitSourceSentences(text) {
  const protectedPeriods = new Set(), blocked = [], handled = new Set();
  const protect = (from, value) => { for (let i = 0; i < value.length; i++) if (value[i] === '.') protectedPeriods.add(from + i); };
  const block = (from, value, message) => blocked.push({ code: 'SENTENCE_BOUNDARY_UNRESOLVED', path: 'story.sentences', message, range: { from, to: from + value.length }, abbreviation: value });
  for (const m of text.matchAll(abbreviation)) {
    const name = m[0].slice(0, -1).toLowerCase(), rest = text.slice(m.index + m[0].length), next = token(rest);
    protect(m.index, m[0]); for (let i = m.index; i < m.index + m[0].length; i++) handled.add(i);
    if (TITLES.some(t => t.toLowerCase() === name)) {
      if (!next || !/^\p{Lu}/u.test(next) || !/^\s/.test(rest) || sentenceStarters.has(next)) block(m.index, m[0], `稱謂 ${m[0]} 後沒有可辨識的名稱，需確認完整 sentence boundary。`);
    } else if (CONTINUATIONS.some(t => t.toLowerCase() === name)) {
      if (!next) block(m.index, m[0], `${m[0]} 後缺少說明內容，不能當成完整句。`);
    } else {
      // A numeric clock time before a normal capitalized sentence start has a terminal abbreviation dot.
      // Time-zone codes continue the same time expression; heading-like continuations remain ambiguous.
      const numericTime = ['a.m', 'p.m'].includes(name) && /\b\d{1,2}(?::\d{2})?\s*$/.test(text.slice(0, m.index));
      const heading = /^(Meeting|Session|Appointment|Class|Flight|Departure)$/i.test(next || '');
      if (numericTime && next && /^\p{Lu}/u.test(next) && !timeZones.has(next) && !heading && /^\s+/.test(rest)) {
        protectedPeriods.delete(m.index + m[0].length - 1);
        continue;
      }
      // Internal lower-case continuation or explicit comma/semicolon is safe; capitalized continuation is ambiguous.
      const inside = /^\s*[,:;]/.test(rest) || (next && /^\p{Ll}/u.test(next)) || (numericTime && timeZones.has(next));
      if (!inside && rest.trim()) block(m.index, m[0], `${m[0]} 可能是縮寫或句尾；後續大寫 / 其他內容需人工確認，不猜切句。`);
    }
  }
  // Unknown dotted abbreviations / initials need a decision; don't quietly accept the Segmenter split.
  for (const m of text.matchAll(/(?<![\p{L}\p{N}])(?:[A-Za-z]\.)+(?![\p{L}\p{N}])/gu)) {
    if (handled.has(m.index)) continue;
    protect(m.index, m[0]); block(m.index, m[0], `未支援的縮寫 / initial ${m[0]}，需要明確 sentence boundary。`);
  }
  if (text.includes(periodMask)) blocked.push({ code: 'SENTENCE_BOUNDARY_UNRESOLVED', path: 'story.sentences', message: '原文含 sentence adapter 保留字元，無法安全分句。' });
  const masked = [...text.split('')].map((c, i) => protectedPeriods.has(i) ? periodMask : c).join('');
  const sentences = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(masked)].filter(s => s.segment.trim()).map(s => ({ segment: text.slice(s.index, s.index + s.segment.length), index: s.index }));
  return { sentences, blocked, protectedPeriods };
}
