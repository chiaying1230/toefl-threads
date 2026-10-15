// N2 REVIEW ONLY. Finite encoding matrix, fake runtime keys, temporary candidates, no real provider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { setup } from './test-support.mjs';
const files = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(x => x.isDirectory() ? files(path.join(d, x.name)) : [path.join(d, x.name)]);
const pct = s => [...s].map(c => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('');
const b64 = s => Buffer.from(s).toString('base64');
const hex = s => Buffer.from(s).toString('hex');
const representations = {
  'partial-percent': s => [...s].map((c, i) => i % 2 ? pct(c) : c).join(''),
  'three-layer-percent': s => pct(pct(pct(s))),
  'mixed-literal-unicode-percent': s => [...s].map((c, i) => [c, `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`, pct(c)][i % 3]).join(''),
  'base64url': s => Buffer.from(s).toString('base64url'),
  'hex': hex,
  'percent-of-base64': s => pct(b64(s)),
  'base64-of-percent': s => b64(pct(s)),
  'base64-twice': s => b64(b64(s)),
  'hex-of-percent': s => hex(pct(s)),
  'segmented-array': s => JSON.stringify([...s]),
};

for (const name of [...Object.keys(representations), 'header-name-echo']) test(`N2 ONLY independent persistence: ${name}`, async () => {
  const secret = `sk_${randomBytes(24).toString('hex')}`;
  const encoded = name === 'header-name-echo' ? secret : representations[name](secret);
  // Independently confirm the composed representations are reversible; do not use production decodeView as the oracle.
  if (name === 'base64-of-percent') assert.equal(decodeURIComponent(Buffer.from(encoded, 'base64').toString()), secret);
  if (name === 'base64-twice') assert.equal(Buffer.from(Buffer.from(encoded, 'base64').toString(), 'base64').toString(), secret);
  if (name === 'hex-of-percent') assert.equal(decodeURIComponent(Buffer.from(encoded, 'hex').toString()), secret);
  const raw = JSON.stringify({ detail: { status: 'invalid_api_key', message: name === 'header-name-echo' ? 'rejected' : encoded } });
  const header = name === 'header-name-echo' ? { [`x-request-id-${secret}`]: 'diagnostic-id' } : { 'request-id': `req-${encoded}`, 'history-item-id': encoded };
  const s = setup({ apiKey: () => secret }); let requests = 0;
  s.service.fetchImpl = async () => { requests++; return new Response(raw, { status: 401, headers: header }); };
  try {
    const p = await s.preview(); await s.confirm(p); await s.service.idle();
    assert.equal(requests, 1, 'no automatic retry');
    const run = s.service.coordinator.run2B(p.run.runId), c = s.service.candidate(run), dir = path.join(c.dir, 'voice/responses');
    const saved = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8'));
    assert.equal(saved.status, 401);
    const needles = [secret, encoded, JSON.stringify(encoded).slice(1, -1)];
    const scan = () => files(s.dir).filter(f => {
      const t = fs.readFileSync(f).toString('latin1').toLowerCase();
      return needles.some(n => t.includes(n.toLowerCase()));
    }).map(f => path.relative(s.dir, f));
    const live = scan();
    s.service.close(); s.service = s.open();
    const view = s.service.view(s.id), restored = scan();
    assert.equal(requests, 1, 'restart/GET never dispatches');
    assert.equal(view.readiness.productionReady, false);
    const uiLeak = needles.some(n => JSON.stringify(view).toLowerCase().includes(n.toLowerCase()));
    console.info(`N2 ${name}: redactions=${saved.sanitization.redactions ?? 'omitted'}; droppedPayload=${saved.raw === null}; leakedPaths=${[...new Set([...live, ...restored])].length}; uiLeak=${uiLeak}; requests=${requests}`);
    if (name === 'segmented-array') {
      assert.equal(saved.raw, null); assert.deepEqual(saved.headers, {});
      assert.equal(saved.sanitization.failed, 'SECRET_SANITIZATION_FAILED');
      assert.equal(view.executions[0].error.code, 'SECRET_SANITIZATION_FAILED');
      assert.equal(view.executions[0].attempts[0].providerRequestId, null);
    }
    assert.deepEqual([...new Set([...live, ...restored])], [], 'reversible fake credential persisted; path evidence only');
    assert.equal(uiLeak, false, 'UI-readable state must not retain the reversible credential');
  } finally { s.close(); }
});
