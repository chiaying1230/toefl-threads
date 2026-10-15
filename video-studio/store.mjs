import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { candidates, seriesNames } from './catalog.mjs';
import { confirmedQuiz, quizHash } from './quiz.mjs';
import { enforceNotReady, StudioError } from './state-contract.mjs';
import { sourceSentences, normalizeStoryChinese, TIMINGS_ID } from './compiler.mjs';
import { validateProductionDecisions } from './production-decisions.mjs';
import { validateSourceDisplayOnly } from './source-display.mjs';
import { jsonHash } from './hashing.mjs';
export { StudioError };
export const configurationComplete = d => Boolean(d?.series && d.seriesEpisode && d.level && d.vocabulary?.length && d.hook && d.quiz);
export class DraftStore {
  constructor(directory, catalog) { this.directory = directory; this.catalog = catalog; fs.mkdirSync(directory, { recursive: true }); }
  file(id) { if (!/^[a-f0-9-]{36}$/.test(id)) throw new StudioError('Invalid draft id'); return path.join(this.directory, `${id}.json`); }
  get(id) {
    const file = this.file(id); if (!fs.existsSync(file)) throw new StudioError('Draft not found', 404);
    const draft = JSON.parse(fs.readFileSync(file, 'utf8')), before = JSON.stringify(draft);
    enforceNotReady(draft);
    if (before !== JSON.stringify(draft)) this.persist(draft);
    return draft;
  }
  list() { return fs.readdirSync(this.directory).filter(f => /^[a-f0-9-]{36}\.json$/.test(f)).map(f => this.get(f.slice(0, -5))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  persist(draft) {
    enforceNotReady(draft);
    const file = this.file(draft.id), temp = `${file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(draft, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(temp, file);
    return draft;
  }
  create(contentId, expectedSourceHash) {
    const record = this.catalog.records.get(contentId);
    if (!record) throw new StudioError('Unknown content');
    if (expectedSourceHash !== undefined && expectedSourceHash !== record.sourceHash) throw new StudioError('來源已變更，請重新載入文章。', 409);
    const now = new Date().toISOString();
    return this.persist({ schemaVersion: 1, id: randomUUID(), contentId, sourceHash: record.sourceHash, revision: 1, status: 'draft', createdAt: now, updatedAt: now, decisions: { series: null, seriesEpisode: null, level: null, vocabulary: [], hook: null, quiz: null }, steps: [], artifacts: {}, approvals: {} });
  }
  update(id, input, { dryRun = false } = {}) {
    const draft = this.get(id), record = this.catalog.records.get(draft.contentId);
    if (input.revision !== draft.revision) throw new StudioError('另一個視窗已保存；請重新載入後再修改。', 409);
    if (!record || record.sourceHash !== draft.sourceHash) throw new StudioError('來源已變更；請建立新 draft，避免套用過期選擇。', 409);
    const d = input.decisions;
    if (!d || !Array.isArray(d.vocabulary) || new Set(d.vocabulary).size !== d.vocabulary.length || d.vocabulary.some(k => !record.vocabulary.some(v => v.key === k))) throw new StudioError('Invalid vocabulary selection');
    if (d.series !== null && !Object.values(seriesNames).includes(d.series)) throw new StudioError('Invalid series');
    if (d.seriesEpisode !== null && (!Number.isSafeInteger(d.seriesEpisode) || d.seriesEpisode < 1)) throw new StudioError('集數必須為正整數');
    if (d.level !== null && (!d.level || ![1, 2, 3].includes(d.level.min) || ![1, 2, 3].includes(d.level.max) || d.level.min > d.level.max)) throw new StudioError('Invalid level range');
    const choices = candidates(record, this.catalog.vocab);
    let hook = null, quiz = null;
    if (d.hook !== null) {
      const candidate = choices.hooks.find(h => h.id === d.hook?.candidateId);
      if (!candidate || typeof d.hook.text !== 'string' || !d.hook.text.trim() || d.hook.text.length > 500 || /\p{Extended_Pictographic}/u.test(d.hook.text)) throw new StudioError('Invalid Hook');
      if (d.hook.zh !== undefined && d.hook.zh !== null && (typeof d.hook.zh !== 'string' || d.hook.zh.length > 1000)) throw new StudioError('Invalid Hook 中文');
      hook = { candidateId: candidate.id, type: candidate.type, text: d.hook.text.trim(), zh: d.hook.zh?.trim() || null };
    }
    if (d.quiz !== null) {
      const candidate = choices.quizzes.find(q => q.id === d.quiz?.candidateId);
      if (!candidate || !d.vocabulary.includes(candidate.key)) throw new StudioError('Quiz 必須考已選的詞彙');
      if (!d.quiz.candidateHash || d.quiz.candidateHash !== quizHash(d.quiz) || d.quiz.candidateHash !== candidate.candidateHash) throw new StudioError('Quiz snapshot 或來源已變更／不完整，請重新確認最新候選。', 409);
      // Verification uses the live candidate; storage uses the exact submitted human snapshot.
      quiz = draft.decisions.quiz?.candidateHash === d.quiz.candidateHash && draft.decisions.quiz.confirmation ? draft.decisions.quiz : confirmedQuiz(d.quiz, draft.revision + 1);
    }
    const meaningSpeech = {}, meaningDisplay = {};
    if (d.meaningSpeech !== undefined && (!d.meaningSpeech || typeof d.meaningSpeech !== 'object' || Array.isArray(d.meaningSpeech))) throw new StudioError('Invalid Ling speech decisions');
    for (const [key, value] of Object.entries(d.meaningSpeech || {})) {
      if (!d.vocabulary.includes(key) || typeof value !== 'string' || value.length > 1000) throw new StudioError('Invalid Ling speech decision');
      if (value.trim()) meaningSpeech[key] = value.trim();
    }
    if (d.meaningDisplay !== undefined && (!d.meaningDisplay || typeof d.meaningDisplay !== 'object' || Array.isArray(d.meaningDisplay))) throw new StudioError('畫面詞義格式無效');
    for (const [key, value] of Object.entries(d.meaningDisplay || {})) {
      const source = record.vocabulary.find(v => v.key === key);
      if (!d.vocabulary.includes(key) || !source || typeof value !== 'string' || !value.trim() || value.length > 1000 || /\p{Extended_Pictographic}/u.test(value)) throw new StudioError('畫面詞義必須是非空文字，且不能包含 emoji');
      if (value.trim() !== source.zh) meaningDisplay[key] = value.trim();
    }
    // 2B production decisions (Outro / music / translations / policy confirmation); validated against the current source sentences.
    const sourceDisplayOnly = validateSourceDisplayOnly(record, d.sourceDisplayOnly);
    let storyChinese;
    try { storyChinese = normalizeStoryChinese(d.storyChinese); } catch (e) { throw new StudioError(e.message); }
    const production = validateProductionDecisions(d.production ?? null, sourceSentences(record, sourceDisplayOnly, storyChinese), TIMINGS_ID);
    const nextDecisions = { series: d.series, seriesEpisode: d.seriesEpisode, level: d.level ? { min: d.level.min, max: d.level.max } : null, vocabulary: d.vocabulary, hook, quiz, meaningSpeech, meaningDisplay, sourceDisplayOnly, ...(storyChinese ? { storyChinese } : {}), ...(production ? { production } : {}) };
    const old = { ...draft.decisions, meaningSpeech: draft.decisions.meaningSpeech || {}, meaningDisplay: draft.decisions.meaningDisplay || {}, sourceDisplayOnly: draft.decisions.sourceDisplayOnly || [] };
    if (jsonHash(old) === jsonHash(nextDecisions)) return draft;
    if (dryRun) return null; // validation only; nothing has been changed yet
    draft.decisions = nextDecisions;
    draft.status = configurationComplete(draft.decisions) ? 'configured' : 'draft';
    if (draft.workflow) draft.workflowHistory = [...(draft.workflowHistory || []), { ...draft.workflow, steps: draft.steps, artifacts: draft.artifacts, invalidatedAt: new Date().toISOString(), reason: 'decisions-edited' }].slice(-10);
    draft.steps = []; draft.artifacts = {}; draft.approvals = {}; delete draft.workflow;
    draft.quizReview = { status: quiz ? 'confirmed' : 'not_selected', errors: [], productionReady: false };
    draft.sourceDisplayReview = { status: 'confirmed', errors: [], productionReady: false };
    draft.revision++; draft.updatedAt = new Date().toISOString();
    return this.persist(draft);
  }
}
