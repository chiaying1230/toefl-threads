// Dry-run data only: not canonical content, not an episode assignment, never called P6.
import { digest, candidates } from './catalog.mjs';
import { confirmedQuiz } from './quiz.mjs';
import { sourceSentences, TIMINGS_ID } from './compiler.mjs';
import { productionProposal, VISUAL_POLICY } from './production-decisions.mjs';
export function fixture(kind = 'single', hookZh = '課堂準備開始了。', { production = false, longExample = false } = {}) {
  const allocate = { key: 'allocate', word: 'allocate', zh: '分配；撥出（資源）', pos: 'v.', level: 2, ex: longExample ? Array(14).fill('We allocate supplies to each class every single morning before the long lessons begin again.').join(' ') : 'We allocate supplies to each class.', exZh: '我們分配用品給每個班級。' };
  const arbitrary = { key: 'arbitrary', word: 'arbitrary', zh: '任意的；武斷的', pos: 'adj.', level: 3, ex: 'The rule seemed arbitrary.', exZh: '這條規則看起來很隨意。' };
  const phrase = { key: 'be_consumed_with', word: 'be consumed with', zh: '深受困擾', pos: 'v. phr.', level: 2, ex: 'He was consumed with fear.', exZh: '他深受恐懼困擾。' };
  const vocabulary = kind === 'phrase' ? [phrase] : kind === 'multiple' ? [allocate, arbitrary] : [allocate];
  const post = { id: `studio-fixture-${kind}`, author: 'fixture', topic: 'Campus Life', text: kind === 'phrase' ? 'She [[be_consumed_with|was consumed with]] guilt, but she recovered.' : kind === 'multiple' ? 'We [[allocate]] supplies, then review [[arbitrary]] rules.' : 'We [[allocate]] supplies, and the class starts.', zh: '測試原文翻譯。' };
  const source = { pack: 'toefl', post, author: { name: 'Fixture Teacher', handle: 'fixture_teacher', avatar: 'T' }, vocabulary };
  const record = { ...source, sourceHash: digest(source) };
  const draft = { id: '00000000-0000-0000-0000-000000000001', contentId: post.id, sourceHash: record.sourceHash, revision: 1, status: 'configured', decisions: { series: 'TOEFL', seriesEpisode: 100, level: { min: 2, max: 3 }, vocabulary: vocabulary.map(v => v.key), hook: { candidateId: 'hook-1', type: 'scene_contrast', text: 'The class starts.', zh: hookZh }, quiz: { candidateId: `meaning:${vocabulary[0].key}`, id: `meaning:${vocabulary[0].key}`, type: 'meaning', key: vocabulary[0].key, word: vocabulary[0].word, options: [vocabulary[0].zh, '食物', '時間'], answer: 0 } }, steps: [], artifacts: {}, approvals: {} };
  const vocab = Object.fromEntries(vocabulary.map(v => [v.key, v]));
  vocab.fixture_food = { pos: vocabulary[0].pos, level: vocabulary[0].level, zh: '食物' };
  vocab.fixture_time = { pos: vocabulary[0].pos, level: vocabulary[0].level, zh: '時間' };
  draft.decisions.quiz = confirmedQuiz(candidates(record, vocab).quizzes[0], draft.revision);
  if (production) draft.decisions.production = productionDecisions(record, draft.decisions);
  return { record, draft, catalog: { records: new Map([[post.id, record]]), vocab } };
}
/** Confirmed production decisions for a fixture (what a person would submit from the proposal, with translations filled in). */
export function productionDecisions(record, decisions, overrides = {}) {
  const sentences = sourceSentences(record), proposal = productionProposal(record, decisions, sentences);
  return {
    version: proposal.version, outro: { ...proposal.outro, ...overrides.outro }, audio: { preset: overrides.audio || 'reference-music-v1' },
    translations: { mode: 'per-sentence', items: Object.fromEntries(Object.entries(proposal.translations.items).map(([id, item]) => [id, { ...item, text: `第 ${id.slice(-1)} 句的中文。` }])) },
    confirmations: { visualPolicyVersion: VISUAL_POLICY.version, timingsVersion: TIMINGS_ID },
  };
}
