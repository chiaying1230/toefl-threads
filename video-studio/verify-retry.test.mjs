// TEMP fixture/mock provider only; no live P6 state or real provider calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, FAKE_STEPS } from './test-support.mjs';
import { StepFailure } from './production-steps.mjs';

test('unchanged VERIFY_FAILED bundle blocks UI/API/internal retry and survives restart; new sealed bundle permits a new verify', async () => {
  let verifications = 0;
  const s = setup({ autoChain: true, localSteps: { ...FAKE_STEPS, verifyStep: async () => { verifications++; throw new StepFailure('VERIFY_FAILED', 'same deterministic acoustic failure'); } } });
  try {
    const p = await s.preview(); await s.confirm(p); await s.service.idle();
    let v = s.service.view(s.id);
    assert.equal(v.run.state, 'failed'); assert.equal(v.retryBlocker.code, 'DETERMINISTIC_VERIFY_BLOCKED');
    const attempts = () => s.service.coordinator.steps(p.run.runId).filter(x => x.step === 'verify').length;
    assert.equal(attempts(), 1); assert.equal(verifications, 1);
    const requests = s.provider.calls.length;
    assert.throws(() => s.service.resume(s.id, p.run.runId), e => e.status === 409 && e.problems[0].code === 'DETERMINISTIC_VERIFY_BLOCKED');
    await s.service.startChain(p.run.runId); assert.equal(attempts(), 1); assert.equal(verifications, 1);
    s.service.close(); s.service = s.open(); v = s.service.view(s.id);
    assert.equal(v.retryBlocker.code, 'DETERMINISTIC_VERIFY_BLOCKED');
    assert.throws(() => s.service.resume(s.id, p.run.runId), e => e.status === 409);
    assert.equal(s.provider.calls.length, requests); assert.equal(v.readiness.canReview, false); assert.equal(v.readiness.productionReady, false);
    // A genuinely different sealed predecessor is new evidence, never a hash rewrite of the failed bundle.
    const run = s.service.coordinator.run2B(p.run.runId), candidate = s.service.candidate(run);
    await s.service.runStep(run, 'mix', ({ attemptId }) => FAKE_STEPS.mixStep({ candidate, attemptId }));
    assert.equal(s.service.view(s.id).retryBlocker, null);
    s.service.resume(s.id, p.run.runId); await s.service.idle();
    assert.equal(verifications, 2); assert.equal(attempts(), 2); assert.equal(s.provider.calls.length, requests);
    assert.equal(s.service.view(s.id).retryBlocker.code, 'DETERMINISTIC_VERIFY_BLOCKED');
  } finally { s.close(); }
});
