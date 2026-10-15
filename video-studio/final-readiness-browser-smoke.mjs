// REVIEW ONLY. Real UI with mocked provider and fake local steps; no renderer / real key / remote requests.
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { setup, FAKE_STEPS, key } from './test-support.mjs';
import { createStudio } from './server.mjs';
const mod = process.env.PLAYWRIGHT_MODULE || 'C:/Users/123/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(mod).href);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const rewrite = (f, b) => { fs.chmodSync(f, 0o666); fs.writeFileSync(f, b); };
try {
  for (const kind of ['partial-failed', 'approved-narration']) {
    const s = setup(kind === 'partial-failed' ? { behavior: c => c.n === 2 ? { status: 500 } : null } : { autoChain: true, localSteps: FAKE_STEPS });
    let server, context;
    try {
      const p = await s.preview(); await s.confirm(p); await s.service.idle();
      const v = s.service.view(s.id), run = s.service.coordinator.run2B(v.run.runId), c = s.service.candidate(run);
      if (kind === 'approved-narration') {
        const acknowledgements = Object.fromEntries(['seams', 'visual', 'warnings'].map(k => [k, Object.fromEntries(v.review[k === 'visual' ? 'visualChecklist' : k].map(x => [x.id, true]))]));
        s.service.decideReview(s.id, { runId: run.run_id, bundleHash: v.review.bundleHash, decision: 'accept', acknowledgements, idempotencyKey: key(915) });
      }
      const target = kind === 'partial-failed' ? path.join(c.dir, 'voice/sealed', `${v.executions[0].attempts.find(x => x.status === 'succeeded').segmentHash}.mp3`) : path.join(c.dir, run.inputs.inputRefs.narration.path);
      const calls = s.provider.calls.length;
      s.service.close(); s.f.catalog.frozen = new Set();
      server = createStudio({ stateDir: s.dir, catalogLoader: () => s.f.catalog, fetchImpl: s.provider.fetchImpl, apiKey: () => 'browser-fake-secret-only' });
      server.listen(0, '127.0.0.1'); await once(server, 'listening');
      const url = `http://127.0.0.1:${server.address().port}`;
      context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await context.addInitScript(id => localStorage.setItem('videoStudioDraft', id), s.id);
      const page = await context.newPage(), errors = [], external = [];
      page.on('pageerror', e => errors.push(e.message));
      await context.route('**/*', route => { if (!route.request().url().startsWith(url)) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
      await page.goto(url); await page.waitForFunction(() => document.getElementById('p2b-summary').textContent.includes('Run '));
      // Tamper AFTER startup, to cover the reported failed→blocked lag within a live server.
      rewrite(target, Buffer.concat([fs.readFileSync(target), Buffer.from(' ')]));
      await page.reload();
      await page.waitForFunction(() => document.getElementById('p2b-summary').textContent.includes('stale'));
      assert.match(await page.locator('#p2b-summary').textContent(), /productionReady false/);
      const next = await page.locator('#p2b-actions').textContent();
      for (const t of ['下一步', '新的免費預覽', '新的 bundle 需要重新人工驗收']) assert.ok(next.includes(t), t);
      assert.equal(await page.locator('#p2b-accept').count(), 0);
      assert.equal(await page.locator('#p2b-confirm').count(), 0);
      assert.equal(await page.locator('#p2b-video').count(), 0);
      if (kind === 'partial-failed') {
        const b = page.getByRole('button', { name: /續跑語音/ });
        assert.equal(await b.count(), 1, 'reproduces P2 UX issue instead of silently skipping it');
        const response = page.waitForResponse(r => r.url().endsWith('/resume-voice'));
        await b.click(); assert.equal((await response).status(), 409);
        await page.waitForFunction(() => document.getElementById('p2b-message').textContent.includes('失效'));
        assert.equal(server.production.view(s.id).run.state, 'stale');
      }
      assert.equal(s.provider.calls.length, calls);
      assert.equal(server.production.view(s.id).readiness.canPromote, false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.setViewportSize({ width: 1280, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
      console.log(`PASS stale browser ${kind}: nextActions visible, readiness false, no approval/paid button/media, ${kind === 'partial-failed' ? 'misleading resume rejected HTTP409, ' : ''}no additional provider call, no overflow/errors/external network.`);
    } finally {
      await context?.close();
      if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
      s.close();
    }
  }
} finally { await browser.close(); }
