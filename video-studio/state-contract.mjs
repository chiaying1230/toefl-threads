export class StudioError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
// The 2A capability ceiling is authoritative server policy, never persisted/client readiness.
export function enforceNotReady(draft) {
  draft.productionReady = false;
  draft.workflow ||= { status: 'idle' };
  draft.workflow.productionReady = false;
  draft.steps ||= []; draft.artifacts ||= {};
  const stamp = step => { step.productionReady = false; if (step.result && typeof step.result === 'object') step.result.productionReady = false; };
  draft.steps.forEach(stamp);
  for (const h of draft.workflowHistory || []) { h.productionReady = false; h.steps?.forEach(stamp); }
  if (draft.quizReview) draft.quizReview.productionReady = false;
  return draft;
}
