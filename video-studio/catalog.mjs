import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { makeQuizCandidate } from './quiz.mjs';
export const seriesNames = { toefl: 'TOEFL', toeic: 'TOEIC', ielts: 'IELTS', hs: '高中', elem: '國小國中' };
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const plain = text => text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, key, form) => form || key.replaceAll('_', ' '));

// Execute only repository-owned data files, never browser input. No Node APIs in the context.
export function loadCatalog(root) {
  const window = {};
  const context = vm.createContext({ window });
  const run = file => vm.runInContext(fs.readFileSync(path.join(root, 'js/data', file), 'utf8'), context, { filename: file, timeout: 5000 });
  run('characters.js');
  for (let i = 1; i <= 13; i++) run(`batch-${i}.js`);
  run('levels.js'); run('packs/index.js'); run('kk.js');
  for (const pack of ['elem', 'hs', 'toeic', 'ielts']) run(`packs/${pack}.js`);
  const records = new Map();
  for (const [pack, posts] of [['toefl', window.POSTS], ...Object.entries(window.PACK_POSTS)]) {
    for (const post of posts) {
      const keys = [...new Set([...post.text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(m => m[1]))];
      const vocabulary = keys.map(key => ({ key, word: window.VOCAB[key]?.w || key.replaceAll('_', ' '), ...window.VOCAB[key], kk: window.KK?.[key] || null }));
      const source = JSON.parse(JSON.stringify({ pack, post, author: window.CHARACTERS[post.author] || null, vocabulary }));
      if (records.has(post.id)) throw Error(`Duplicate content id: ${post.id}`);
      records.set(post.id, { ...source, sourceHash: digest(source) });
    }
  }
  const frozen = new Set();
  for (const dir of fs.readdirSync(path.join(root, 'docs'), { withFileTypes: true }).filter(d => d.isDirectory())) {
    const file = path.join(root, 'docs', dir.name, 'FROZEN.json');
    if (fs.existsSync(file) && dir.name.endsWith('-auto')) frozen.add(dir.name.slice(0, -5));
  }
  return { records, frozen, vocab: JSON.parse(JSON.stringify(window.VOCAB)) };
}

export function candidates(record, vocab) {
  const text = plain(record.post.text).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').trim();
  const fragments = text.split(/\n+|(?<=[.!?])\s+/).filter(s => /[a-z]/i.test(s));
  // Prefer an intact source clause over an arbitrary word-count cut (which creates broken English).
  const seeds = fragments.slice(0, 3).map(s => s.split(/,\s+(?:and|but)\s+/i)[0].trim()).filter(Boolean);
  while (seeds.length < 3) seeds.push(seeds[0] || text);
  const hooks = seeds.map((s, i) => ({ id: `hook-${i + 1}`, type: 'scene_contrast', text: s, method: 'source-excerpt', warning: '原文擷取草稿；請檢查英文完整性、懸念與是否提前透露故事。原文不足三段時可能重複。' }));
  const quizzes = record.vocabulary.filter(v => v.zh && v.ex).map(v => {
    const distractors = Object.entries(vocab).filter(([key, w]) => key !== v.key && w.zh && w.zh !== v.zh && w.pos === v.pos && w.level === v.level);
    const distinct = [], meanings = new Set([v.zh]);
    for (const entry of distractors) { if (!meanings.has(entry[1].zh)) { distinct.push(entry); meanings.add(entry[1].zh); } if (distinct.length === 2) break; }
    return makeQuizCandidate(record, v, distinct, vocab);
  }).filter(q => q.options.length === 3);
  return { hooks, quizzes };
}

export function suggestions(root, record) {
  // Explicit legacy mapping documented in canonical design rules, never inferred from IDs.
  const maxima = { TOEFL: 2, TOEIC: 1, IELTS: 1, 高中: 0, 國小國中: 0 };
  for (const file of fs.readdirSync(path.join(root, 'scripts/video/episodes')).filter(f => f.endsWith('.json'))) {
    const ep = JSON.parse(fs.readFileSync(path.join(root, 'scripts/video/episodes', file), 'utf8'));
    if (Number.isInteger(ep.seriesEpisode) && ep.series) maxima[ep.series] = Math.max(maxima[ep.series] || 0, ep.seriesEpisode);
  }
  const levels = record.vocabulary.map(v => v.level).filter(v => [1, 2, 3].includes(v));
  return { series: seriesNames[record.pack], seriesEpisode: (maxima[seriesNames[record.pack]] || 0) + 1, level: levels.length ? { min: Math.min(...levels), max: Math.max(...levels) } : null, basis: 'series 來自來源 pack；集數來自明確 episode metadata 與 canonical legacy 對照；level 來自詞彙資料。僅供建議，需人工填入確認。' };
}
