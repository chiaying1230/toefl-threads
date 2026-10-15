// Owner-authorized P6 ZERO-PAID gate. Never calls confirm/resume/synthesize or creates/consumes receipts.
// --save-confirmed-display-only persists the already explicitly confirmed elem-02 CTA via the normal mutation boundary.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { loadCatalog } from './catalog.mjs';
import { DraftStore } from './store.mjs';
import { ProductionWorkflow } from './workflow.mjs';
import { ProductionService } from './production.mjs';
import { sourceDisplayCandidates } from './source-display.mjs';
import { sourceSentences } from './compiler.mjs';
import { root } from './server.mjs';
import { jsonHash, bufferHash } from './hashing.mjs';
import { prepareNarration } from '../scripts/video/voice/segments.mjs';
import { buildRequest } from '../scripts/video/voice/elevenlabs.mjs';

const draftId = '20ee16ed-e72f-4b06-9b4c-0387fc82b0f8';
const draftsDir = path.join(root, 'video-studio/state/drafts'), productionDir = path.join(draftsDir, 'production');
const catalog = loadCatalog(root), store = new DraftStore(draftsDir, catalog), workflow = new ProductionWorkflow(store, root);
let providerRequests = 0, keyReads = 0, service;
const denyProvider = () => { providerRequests++; throw Error('Provider forbidden: zero-paid preflight'); };
const denyKey = () => { keyReads++; throw Error('Credentials forbidden: zero-paid preflight'); };
const fsRead = fs.readFileSync;
fs.readFileSync = function (file, ...args) {
  assert.notEqual(path.basename(String(file)), '.env', 'Preflight must not read .env');
  return fsRead.call(this, file, ...args);
};
try {
  service = new ProductionService({ draftsDir, productionDir, repoRoot: root, catalogLoader: loadCatalog, loadedEngineHash: workflow.loadedEngineHash,
    apiKey: denyKey, fetchImpl: denyProvider, promotion: { enabled: false }, autoChain: false });
  for (const table of ['receipts', 'executions', 'attempts']) assert.equal(service.coordinator.all(`SELECT * FROM ${table}`).length, 0, `Existing ${table}: stop, do not interfere with paid evidence`);
  let draft = workflow.reconcile(draftId);
  assert.equal(draft.contentId, 'elem-02'); assert.equal(draft.decisions.hook.zh, null);
  const record = catalog.records.get(draft.contentId); assert.equal(draft.sourceHash, record.sourceHash);
  if (process.argv.includes('--save-confirmed-display-only') && !draft.decisions.sourceDisplayOnly?.length) {
    const cta = sourceDisplayCandidates(record).find(r => r.text === '週末你們都去哪了 😭');
    assert.ok(cta, 'Confirmed original CTA must match exactly; no guessed source position');
    const decisions = structuredClone(draft.decisions); decisions.sourceDisplayOnly = [cta];
    const sentences = new Set(sourceSentences(record, decisions.sourceDisplayOnly).map(s => s.id));
    if (decisions.production?.translations.mode === 'per-sentence') {
      const items = decisions.production.translations.items;
      decisions.production.translations.items = Object.fromEntries(Object.entries(items).filter(([id]) => sentences.has(id)));
      assert.deepEqual(Object.keys(items).filter(id => !sentences.has(id)), ['story005'], 'Only confirmed CTA translation decision removed');
    }
    const input = { revision: draft.revision, decisions }; store.update(draft.id, input, { dryRun: true });
    const mutation = service.beginMutation(draft.id, draft.revision, jsonHash(draft.decisions));
    try { draft = store.update(draft.id, input); service.finishMutation(mutation, true); }
    catch (e) { service.finishMutation(mutation, false); throw e; }
  }
  assert.ok(draft.decisions.sourceDisplayOnly?.length, 'Explicit source display-only confirmation required; never auto-exclude CTA');
  draft = workflow.run(draft.id, { revision: draft.revision });
  assert.equal(draft.status, 'voice_planned', JSON.stringify(draft.steps));
  const freePlan = workflow.read(draft, 'voicePlan'), validation = workflow.read(draft, 'validation'), compiledEpisode = workflow.read(draft, 'episode');
  assert.equal(validation.verdict, 'PASS'); assert.equal(compiledEpisode.hook.zh, null);
  assert.ok(compiledEpisode.story.at(-1).parts.some(p => p.type === 'translation' && p.text === '週末你們都去哪了'));
  assert.equal(freePlan.segmentCount, 13); assert.equal(freePlan.counts.silent, 2); assert.equal(freePlan.charsToGenerate, 202);
  assert.equal(freePlan.networkRequests, 0); assert.equal(freePlan.generatedThisRun, 0);
  const preview = await service.preview(draft.id, { revision: draft.revision });
  assert.equal(preview.run.state, 'awaiting_confirmation', JSON.stringify(preview.run.reason));
  assert.equal(preview.preflight.parity.ok, true); assert.equal(preview.preflight.cards.ok, true);
  const run = service.coordinator.run2B(preview.run.runId), candidate = service.candidate(run), envelope = candidate.readJson(run.inputs.envelopes.at(-1));
  const narration = candidate.readJson(run.inputs.inputRefs.narration), cfg = service.voiceConfig(run);
  const prepared = prepareNarration(narration, cfg, { requireApiKey: false, env: {} });
  const freeSpoken = freePlan.segments.filter(s => !s.silent), spoken = envelope.segments.filter(s => !s.silent);
  assert.equal(spoken.length, 11); assert.equal(envelope.counts.silent, 2); assert.equal(envelope.requests.length, 11);
  assert.equal(envelope.estimatedUniqueTextChars, 202); assert.equal(envelope.charsFromPlanner, 202);
  assert.deepEqual(envelope.counts, freePlan.counts);
  for (const s of spoken) {
    const planned = freeSpoken.find(p => p.id === s.id);
    for (const field of ['id', 'kind', 'hash', 'text', 'speaker', 'model', 'chars', 'partIds', 'status']) assert.deepEqual(s[field], planned[field], `${s.id}/${field}`);
  }
  const requests = envelope.requests.map(r => {
    const seg = prepared.segments.find(s => s.hash === r.segmentHash), planned = freeSpoken.find(p => p.hash === r.segmentHash);
    assert.ok(seg && planned); assert.deepEqual(r.segmentIds, [planned.id]); assert.equal(r.text, planned.text);
    assert.equal(r.voiceId, planned.voiceId); assert.equal(r.model, planned.model); assert.equal(r.chars, planned.chars);
    assert.ok(!r.text.includes('週末你們都去哪了'));
    const request = buildRequest({ voice: seg.voice, text: seg.speak, previousText: seg.previousText, nextText: seg.nextText, outputFormat: prepared.outputFormat, apiBase: prepared.apiBase });
    assert.equal(request.url, r.url); assert.equal(new URL(request.url).origin, 'https://api.elevenlabs.io');
    assert.equal(new URL(request.url).pathname, `/v1/text-to-speech/${seg.voice.voiceId}/with-timestamps`);
    assert.equal(request.body.model_id, r.model); assert.deepEqual(request.body.voice_settings, r.settings);
    assert.equal(bufferHash(Buffer.from(JSON.stringify(request.body))), r.requestBodyHash);
    assert.deepEqual(r.partIds, seg.parts?.map(p => p.id) || []);
    return { segmentId: planned.id, method: 'POST', url: request.url, body: request.body, bodyHash: r.requestBodyHash, speaker: r.speaker, chars: r.chars, partIds: r.partIds };
  });
  assert.equal(envelope.budget.maxRequests, 11); assert.equal(envelope.budget.maxSubmittedChars, 202);
  assert.equal(envelope.retryPolicy.automaticNetworkRetries, 0); assert.equal(envelope.retryPolicy.additionalPaidAttemptsPerHash, 0);
  for (const table of ['receipts', 'executions', 'attempts']) assert.equal(service.coordinator.all(`SELECT * FROM ${table}`).length, 0, table);
  const challenges = service.coordinator.all('SELECT consumed_at FROM challenges WHERE run_id = ?', run.run_id);
  assert.equal(challenges.length, 1); assert.equal(challenges[0].consumed_at, null);
  assert.equal(providerRequests, 0); assert.equal(keyReads, 0); assert.equal(service.promotion.enabled, false);
  assert.equal(preview.readiness.productionReady, false); assert.equal(preview.readiness.canGenerate, true); assert.equal(preview.readiness.canPromote, false);
  assert.deepEqual(service.staleness(run), []);
  const report = { schemaVersion: 1, checkedAt: new Date().toISOString(), draftId: draft.id, revision: draft.revision, sourceHash: draft.sourceHash,
    decisionHash: jsonHash(draft.decisions), studioEngineHash: workflow.loadedEngineHash, runId: run.run_id, candidateId: run.candidate_id, state: run.state,
    exactEnvelopeHash: run.inputs.envelopes.at(-1).bytesHash, inputArtifactHashes: Object.fromEntries(['narration', 'episode', 'validation', 'voicePlan'].map(k => [k, run.inputs.inputRefs[k].bytesHash])),
    preflight: preview.preflight, counts: envelope.counts, spokenSegments: spoken.length, silentSegments: envelope.counts.silent, characters: 202,
    matchesFreePlan: true, budget: envelope.budget, retryPolicy: envelope.retryPolicy, requests, receipts: 0, executions: 0, attempts: 0, challengeConsumed: false,
    challengeExpiresAt: preview.challenge.expiresAt, providerRequests, keyReads, promotionEnabled: false, productionReady: false,
    note: 'No confirmation token persisted in report. Owner must create a fresh UI preview/challenge before personally confirming; any dependency change invalidates this gate.' };
  const reportFile = path.join(root, 'video-studio/state/qa/p6-exact-envelope-preflight.json'); fs.mkdirSync(path.dirname(reportFile), { recursive: true }); fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ verdict: 'PASS', report: path.relative(root, reportFile), draftId: draft.id, revision: draft.revision, runId: run.run_id, state: run.state,
    counts: envelope.counts, spokenSegments: spoken.length, silentSegments: envelope.counts.silent, characters: 202, matchesFreePlan: true, receipts: 0, executions: 0, attempts: 0, providerRequests, keyReads, promotionEnabled: false }));
} finally { service?.close(); fs.readFileSync = fsRead; }
