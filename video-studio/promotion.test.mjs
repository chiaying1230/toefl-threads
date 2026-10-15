// Canonical promotion safety on a TEMPORARY fake repository root. Nothing here touches the real repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Coordinator, LifetimeLock } from './coordinator.mjs';
import { promotionPreview, promote, recoverPublications, publicationGateOpen, frozenInventory, deniedReason } from './promotion.mjs';
import { fileEvidence, jsonHash } from './hashing.mjs';

function world() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-promotion-')), root = path.join(base, 'repo'), state = path.join(base, 'state'), sealed = path.join(base, 'sealed');
  const write = (rel, data) => { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); return f; };
  write('scripts/video/reference/PostTemplate.js', 'shared');
  write('scripts/video/episodes/p9-auto.json', '{"frozen":true}');
  write('scripts/video/narration/alignment/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json', '{"shared":"alignment"}');
  write('docs/p9-auto/FROZEN.json', JSON.stringify({ hashes: { referenceVideos: { 'outputs/p9-final.mp4': 'x' }, narrationPlanManifestAndConfig: { 'scripts/video/episodes/p9-auto.json': 'y' } }, revisions: [{ templateAndPipeline: { 'scripts/video/reference/PostTemplate.js': 'z' } }] }));
  fs.mkdirSync(sealed, { recursive: true });
  const artifact = (role, canonical, data) => { const f = path.join(sealed, role.replace(/[^a-z0-9]/gi, '_')); fs.writeFileSync(f, data); return { role, path: f, ...fileEvidence(f), canonical }; };
  const manifest = { version: 1, candidateId: 'c1', contentId: 'demo-1', artifacts: [
    artifact('episode', 'scripts/video/episodes/demo-1-auto.json', '{"episode":1}'),
    artifact('narration', 'scripts/video/narration/demo-1.json', '{"narration":1}'),
    artifact('plan', 'docs/demo-1-auto/demo-1-auto.plan.json', '{"plan":1}'),
    artifact('final', 'outputs/demo-1-studio-final.mp4', 'mp4-bytes'),
    artifact('alignment:shared', 'scripts/video/narration/alignment/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json', '{"shared":"alignment"}'),
    artifact('alignment:new', 'scripts/video/narration/alignment/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.json', '{"new":"alignment"}'),
  ] };
  fs.mkdirSync(state, { recursive: true });
  const coordinator = new Coordinator(state);
  const args = (extra = {}) => ({ coordinator, root, stagingRoot: path.join(state, 'promotion'), lockDir: path.join(state, 'locks'), manifest, approval: { receiptHash: 'sha256:approval' }, source: t => t.path, fresh: () => {}, ...extra });
  return { base, root, state, manifest, coordinator, args, write, exists: rel => fs.existsSync(path.join(root, ...rel.split('/'))), close: () => { coordinator.close(); fs.rmSync(base, { recursive: true, force: true }); } };
}
const created = ['scripts/video/episodes/demo-1-auto.json', 'scripts/video/narration/demo-1.json', 'docs/demo-1-auto/demo-1-auto.plan.json', 'outputs/demo-1-studio-final.mp4', 'scripts/video/narration/alignment/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.json'];

test('denylist: every FROZEN.json path, frozen folders (any case), shared code and traversal are refused; malformed FROZEN fails closed', () => {
  const w = world();
  try {
    const inv = frozenInventory(w.root);
    for (const p of ['scripts/video/episodes/p9-auto.json', 'outputs/p9-final.mp4', 'docs/p9-auto/new.json', 'docs/P9-auto/new.json', 'scripts/video/reference/PostTemplate.js', 'scripts/video/render-lib.mjs', '../outside.json', 'docs/x/../p9-auto/a.json', 'outputs/CON.mp4']) assert.ok(deniedReason(p, inv), p);
    assert.equal(deniedReason('scripts/video/episodes/demo-1-auto.json', inv), null);
    const p = promotionPreview({ root: w.root, manifest: w.manifest });
    assert.equal(p.ok, true, JSON.stringify(p.problems));
    assert.equal(p.targets.find(t => t.role === 'alignment:shared').action, 'reuse');
    const frozen = { ...w.manifest, artifacts: [...w.manifest.artifacts, { ...w.manifest.artifacts[0], canonical: 'scripts/video/episodes/p9-auto.json' }] };
    assert.ok(promotionPreview({ root: w.root, manifest: frozen }).problems.some(x => x.code === 'DESTINATION_DENIED'));
    fs.writeFileSync(path.join(w.root, 'docs/p9-auto/FROZEN.json'), '{broken');
    assert.throws(() => frozenInventory(w.root), /fail closed/);
  } finally { w.close(); }
});

test('collisions: existing destination, a different shared alignment, alias paths and an existing marker block the preview', () => {
  const w = world();
  try {
    w.write('outputs/demo-1-studio-final.mp4', 'someone else');
    w.write('scripts/video/narration/alignment/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.json', 'different');
    const alias = { ...w.manifest, artifacts: [...w.manifest.artifacts, { ...w.manifest.artifacts[0], canonical: 'scripts/video/episodes/Demo-1-auto.json' }] };
    const p = promotionPreview({ root: w.root, manifest: alias });
    assert.equal(p.ok, false);
    assert.ok(p.problems.filter(x => x.code === 'DESTINATION_EXISTS').length >= 2);
    assert.ok(p.problems.some(x => x.code === 'DESTINATION_ALIAS' || x.code === 'DESTINATION_DENIED'));
    assert.throws(() => promote(w.args()), e => e.status === 409);
    assert.equal(fs.readFileSync(path.join(w.root, 'outputs/demo-1-studio-final.mp4'), 'utf8'), 'someone else'); // never overwritten
  } finally { w.close(); }
});

test('commit: files installed with no-replace links, shared alignment only referenced, marker last, gate open again', () => {
  const w = world();
  try {
    const r = promote(w.args());
    assert.equal(r.state, 'COMMITTED'); assert.deepEqual(r.installed.sort(), [...created].sort());
    assert.deepEqual(r.reused, ['scripts/video/narration/alignment/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json']);
    const marker = JSON.parse(fs.readFileSync(path.join(w.root, 'docs/demo-1-auto/studio-publication.json'), 'utf8'));
    assert.equal(marker.bundleHash, jsonHash(w.manifest)); assert.match(marker.note, /不是 FROZEN/);
    for (const a of w.manifest.artifacts) assert.equal(fileEvidence(path.join(w.root, ...a.canonical.split('/'))).bytesHash, a.bytesHash);
    assert.equal(publicationGateOpen(w.coordinator).open, true);
    assert.equal(fs.existsSync(path.join(w.root, 'docs/demo-1-auto/FROZEN.json')), false); // promotion is not a freeze
    assert.throws(() => promote(w.args()), e => e.status === 409); // a second promotion collides with itself
  } finally { w.close(); }
});

for (const at of ['staged', 'install:0', 'install:2', 'ready']) test(`crash at ${at}: the gate closes; recovery rolls back only this transaction's files and folders`, () => {
  const w = world();
  try {
    assert.throws(() => promote(w.args({ faults: { at } })), /fault injected/);
    assert.equal(publicationGateOpen(w.coordinator).open, false);
    const r = recoverPublications({ coordinator: w.coordinator, root: w.root, lockDir: path.join(w.state, 'locks') });
    assert.equal(r[0].state, 'ROLLED_BACK');
    for (const f of created) assert.equal(w.exists(f), false, f);
    assert.equal(w.exists('docs/demo-1-auto'), false); assert.equal(w.exists('scripts/video/episodes/p9-auto.json'), true);
    assert.equal(w.exists('scripts/video/narration/alignment/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json'), true);
    assert.equal(publicationGateOpen(w.coordinator).open, true);
  } finally { w.close(); }
});

test('crash after the marker but before the database: recovery rolls forward without copying again', () => {
  const w = world();
  try {
    assert.throws(() => promote(w.args({ faults: { at: 'committed-before-db' } })), /fault injected/);
    const r = recoverPublications({ coordinator: w.coordinator, root: w.root, lockDir: path.join(w.state, 'locks') });
    assert.equal(r[0].state, 'COMMITTED'); for (const f of created) assert.equal(w.exists(f), true);
  } finally { w.close(); }
});

test('partial / tampered publication is BROKEN (gate stays closed); unclear ownership is never deleted', () => {
  const w = world();
  try {
    assert.throws(() => promote(w.args({ faults: { at: 'committed-before-db' } })), /fault injected/);
    fs.writeFileSync(path.join(w.root, 'docs/demo-1-auto/demo-1-auto.plan.json'), 'tampered');
    assert.equal(recoverPublications({ coordinator: w.coordinator, root: w.root, lockDir: path.join(w.state, 'locks') })[0].state, 'BROKEN');
    assert.equal(publicationGateOpen(w.coordinator).open, false);
  } finally { w.close(); }
  const v = world();
  try {
    assert.throws(() => promote(v.args({ faults: { at: 'install:2' } })), /fault injected/);
    const victim = path.join(v.root, 'scripts/video/episodes/demo-1-auto.json'); fs.unlinkSync(victim); fs.writeFileSync(victim, 'someone else wrote this');
    const r = recoverPublications({ coordinator: v.coordinator, root: v.root, lockDir: path.join(v.state, 'locks') });
    assert.equal(r[0].state, 'BROKEN'); assert.equal(fs.readFileSync(victim, 'utf8'), 'someone else wrote this');
  } finally { v.close(); }
});

test('stale revision during install stops and rolls back; a held publication lock refuses instead of waiting', () => {
  const w = world();
  try {
    let calls = 0;
    assert.throws(() => promote(w.args({ fresh: () => { if (++calls === 3) throw Object.assign(new Error('approval revoked'), { status: 409 }); } })), /approval revoked/);
    for (const f of created) assert.equal(w.exists(f), false, f);
    assert.equal(publicationGateOpen(w.coordinator).open, true);
    const lock = LifetimeLock.acquire(path.join(w.state, 'locks', 'publication.lock'), 'other publisher');
    try { assert.throws(() => promote(w.args()), e => e.status === 409); } finally { lock.release(); }
  } finally { w.close(); }
});
