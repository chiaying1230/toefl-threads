import { createHash } from 'node:crypto';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
export const QUIZ_CANDIDATE_VERSION = 1;
// Only these fields constitute the question a person sees and confirms.
export function quizEvidence(q) {
  return { id: q.id, type: q.type, key: q.key, word: q.word, question: q.question, options: q.options, answer: q.answer, candidateVersion: q.candidateVersion, sourceEvidence: q.sourceEvidence };
}
export function quizHash(q) { return hash(quizEvidence(q)); }
export function makeQuizCandidate(record, target, distractors, vocab) {
  const options = distractors.map(([, v]) => v.zh);
  const answer = parseInt(hash([record.post.id, target.key]).slice(0, 8), 16) % (options.length + 1);
  options.splice(answer, 0, target.zh);
  const q = {
    id: `meaning:${target.key}`, type: 'meaning', key: target.key, word: target.word, question: '是什麼意思？',
    options, answer, candidateVersion: QUIZ_CANDIDATE_VERSION,
    sourceEvidence: { contentId: record.post.id, sourceHash: record.sourceHash, dependencies: [target.key, ...distractors.map(([key]) => key)].map(key => ({ key, hash: hash(vocab[key]) })) },
    warning: '干擾項依詞性與難度推薦；請確認沒有近義或多個正確答案。',
  };
  return { ...q, candidateHash: quizHash(q) };
}
export function confirmedQuiz(q, revision, time = new Date().toISOString()) {
  return { ...clone(quizEvidence(q)), candidateId: q.id, candidateHash: q.candidateHash, warning: q.warning, confirmation: { revision, sourceHash: q.sourceEvidence.sourceHash, confirmedAt: time } };
}
export function quizReview(draft, available) {
  const saved = draft.decisions?.quiz;
  if (!saved) return { status: 'not_selected', productionReady: false, errors: [] };
  const current = available.find(q => q.id === (saved.candidateId || saved.id));
  // Preserve already confirmed option ordering; new recommendations vary A/B/C.
  const sameOptions = current && Array.isArray(saved.options) && JSON.stringify([...saved.options].sort()) === JSON.stringify([...current.options].sort()) && saved.options[saved.answer] === current.options[current.answer];
  const currentHash = sameOptions ? quizHash({ ...current, options: saved.options, answer: saved.answer }) : current?.candidateHash;
  const valid = saved.confirmation && saved.candidateVersion === QUIZ_CANDIDATE_VERSION && saved.candidateHash === quizHash(saved) && saved.sourceEvidence?.sourceHash === draft.sourceHash && saved.confirmation.sourceHash === draft.sourceHash && currentHash === saved.candidateHash;
  return { status: valid ? 'confirmed' : 'needs_confirmation', productionReady: false, errors: valid ? [] : [{ code: 'QUIZ_RECONFIRMATION_REQUIRED', path: 'decisions.quiz', message: '已保存的 Quiz 來源 / distractors / candidate evidence 已變更或缺少完整確認，請明確選取最新候選重新確認；舊 snapshot 保留，不自動改寫。', savedCandidateHash: saved.candidateHash || null, currentCandidateHash: current?.candidateHash || null }] };
}
