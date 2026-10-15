import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createStudio, root } from './server.mjs';
import { loadCatalog, candidates, suggestions } from './catalog.mjs';
import { DraftStore } from './store.mjs';

test('real catalog follows app data order, phrase forms and canonical episode suggestions', () => {
  const c = loadCatalog(root);
  assert.equal(c.records.size, 923);
  assert.deepEqual([...new Set([...c.records.values()].map(r => r.pack))].sort(), ['elem', 'hs', 'ielts', 'toefl', 'toeic']);
  const record = c.records.get('p2');
  assert.equal(record.vocabulary.find(v => v.key === 'arbitrary').level, 3); // levels.js override
  assert.equal(suggestions(root, record).seriesEpisode, 3); // canonical legacy P2/P3
  assert.equal(c.records.get('toeic-079').vocabulary.find(v => v.key === 'be_consumed_with').word, 'be consumed with');
  assert.equal(c.frozen.size, 4);
});

test('draft decisions survive store restart; partial drafts, conflicts and source drift are guarded', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-store-'));
  try {
    const c = loadCatalog(root), store = new DraftStore(directory, c), record = c.records.get('p1');
    const d = store.create('p1'); assert.equal(d.decisions.series, null); assert.equal(d.decisions.hook, null);
    const choices = candidates(record, c.vocab);
    const decisions = { ...d.decisions, series: 'TOEFL', seriesEpisode: 3, level: { min: 2, max: 3 }, vocabulary: [record.vocabulary[0].key], hook: { candidateId: choices.hooks[1].id, text: choices.hooks[1].text }, quiz: { ...choices.quizzes[0], candidateId: choices.quizzes[0].id } };
    const saved = store.update(d.id, { revision: 1, decisions });
    assert.equal(saved.status, 'configured');
    assert.deepEqual(new DraftStore(directory, loadCatalog(root)).get(d.id), saved);
    assert.throws(() => store.update(d.id, { revision: 1, decisions }), e => e.status === 409);
    assert.throws(() => store.update(d.id, { revision: 2, decisions: { ...decisions, vocabulary: ['invented'] } }), /vocabulary/);
    assert.throws(() => store.update(d.id, { revision: 2, decisions: { ...decisions, level: { min: 3, max: 1 } } }), /level/);
    assert.throws(() => store.update(d.id, { revision: 2, decisions: { ...decisions, vocabulary: [record.vocabulary[1].key] } }), /Quiz/);
    record.sourceHash = 'changed';
    assert.throws(() => store.update(d.id, { revision: 2, decisions }), e => e.status === 409);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('HTTP API restart recovery, origin protection and static allowlist; paid/freeze endpoints unavailable', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-http-'));
  let server;
  const start = async () => { server = createStudio({ stateDir }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; };
  const stop = () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  try {
    let base = await start();
    assert.equal((await fetch(base)).status, 200);
    assert.equal((await fetch(`${base}/.env`)).status, 404);
    assert.equal((await fetch(`${base}/api/contents`, { headers: { Origin: 'https://example.com' } })).status, 403);
    const headers = { 'content-type': 'application/json' };
    const created = await (await fetch(`${base}/api/drafts`, { method: 'POST', headers, body: JSON.stringify({ contentId: 'p1' }) })).json();
    const record = await (await fetch(`${base}/api/contents/p1`)).json();
    const decisions = { ...created.decisions, vocabulary: [record.record.vocabulary[0].key], hook: { candidateId: 'hook-1', text: record.candidates.hooks[0].text }, quiz: { ...record.candidates.quizzes[0], candidateId: record.candidates.quizzes[0].id } };
    const saved = await (await fetch(`${base}/api/drafts/${created.id}`, { method: 'PUT', headers, body: JSON.stringify({ revision: 1, decisions }) })).json();
    assert.equal(saved.status, 'draft');
    assert.equal((await fetch(`${base}/api/voice-generate`, { method: 'POST', headers, body: '{}' })).status, 405);
    assert.equal((await fetch(`${base}/api/freeze`, { method: 'POST', headers, body: '{}' })).status, 405);
    await stop(); base = await start();
    assert.deepEqual(await (await fetch(`${base}/api/drafts/${created.id}`)).json(), saved);
    assert.equal((await fetch(`${base}/api/drafts/..%2f..%2f.env`)).status, 400);
  } finally { if (server.listening) await stop(); fs.rmSync(stateDir, { recursive: true, force: true }); }
});
