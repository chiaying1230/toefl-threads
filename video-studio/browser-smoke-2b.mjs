// 2B UI smoke on a FIXTURE (not P6, never canonical): the provider is the local mock, so nothing is paid and nothing leaves
// the machine. Drives the real UI: production decisions → free plan → paid-confirmation preview → confirm (gated by the
// acknowledgements) → real local chain (assemble … verify) → human review (gated by every checkbox) → approved.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { createStudio } from './server.mjs';
import { fixture } from './fixtures.mjs';
import { mockProvider } from './mock-provider.mjs';
const modulePath = process.env.PLAYWRIGHT_MODULE || 'C:/Users/123/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(modulePath.startsWith('playwright') ? modulePath : pathToFileURL(modulePath).href);
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-browser-2b-'));
const f = fixture('single', '課堂準備開始了。'), provider = mockProvider();
f.catalog.frozen = new Set(); // the fixture catalog has no frozen references
let server, browser;
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
try {
  server = createStudio({ stateDir, catalogLoader: () => f.catalog, fetchImpl: provider.fetchImpl, apiKey: () => 'test-key-not-real' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (!r.url().startsWith(url)) external.push(r.url()); });
  page.on('dialog', d => d.accept());
  await page.goto(url);
  await page.waitForFunction(() => document.getElementById('message').textContent.includes('1 篇'));
  await page.selectOption('#content', f.record.post.id);
  await page.locator('#create').click();
  await page.locator('#editor').waitFor({ state: 'visible' });
  await page.locator('#use-suggestions').click();
  await page.locator('input[name=vocab]').first().check();
  await page.locator('input[name=hook]').first().check();
  await page.locator('#hook-text').fill('The class starts.');
  await page.locator('#hook-zh').fill('課堂準備開始了。');
  await page.locator('input[name=quiz]').first().check();
  // production decisions: proposal shown, nothing confirmed until a person checks it
  await page.locator('#pd-enabled').check();
  assert.equal(await page.locator('#pd-lead').inputValue(), '剛剛那篇，你看懂了。');
  assert.match(await page.locator('#pd-cue').textContent(), /cueDuration = .*1\.50s/);
  await page.locator('input[name=pd-translation][value=per-sentence]').check();
  await page.locator('#pd-sentences textarea').first().fill('我們分配用品，課堂開始了。');
  await page.locator('#save').click();
  await page.waitForFunction(() => document.getElementById('message').textContent.includes('Production 決策無效') || document.getElementById('message').textContent.startsWith('已保存'));
  assert.match(await page.locator('#message').textContent(), /請確認 Studio visual policy/); // confirmations are required
  await page.locator('#pd-policy').check(); await page.locator('#pd-timings').check();
  await page.locator('#save').click();
  await page.waitForFunction(() => document.getElementById('message').textContent.startsWith('已保存到磁碟'));
  await page.locator('#run-production').click();
  await page.waitForFunction(() => document.getElementById('voice-summary').textContent.includes('免費初步規劃'));
  // free preview: requests table, cost, budget, retry policy, disclaimer; confirm disabled until both acknowledgements
  await page.getByRole('button', { name: /免費查看這次需要多少新語音/ }).click();
  try { await page.locator('#p2b-confirm').waitFor(); }
  catch (e) { throw Error(`no confirm button: ${await page.locator('#p2b-summary').textContent()} | ${await page.locator('#p2b-message').textContent()} | ${await page.locator('#p2b-actions').textContent()}`); }
  const envelope = await page.locator('#p2b-envelope').textContent();
  for (const text of ['最多送出', 'UTF-16', '自動付費重試 0 次', 'arthur', 'ling', 'eleven_v4', '不是 ElevenLabs 實際扣額', 'We allocate supplies, and the class starts.', '整句只送一次']) assert.ok(envelope.includes(text), text);
  assert.equal(await page.locator('#p2b-confirm').isDisabled(), true);
  assert.equal(provider.calls.length, 0);
  await page.locator('#ack-retry').check(); assert.equal(await page.locator('#p2b-confirm').isDisabled(), true);
  await page.locator('#ack-billing').check(); assert.equal(await page.locator('#p2b-confirm').isDisabled(), false);
  assert.equal(await overflow(page), false);
  fs.mkdirSync('video-studio/state/qa', { recursive: true });
  await page.locator('#p2b').screenshot({ path: 'video-studio/state/qa/2b-confirm-mobile.png' });
  await page.locator('#p2b-confirm').dblclick(); // a double click must not create a second paid execution
  await page.waitForFunction(() => document.getElementById('p2b-review').textContent.includes('人工驗收') || /blocked|failed|stale/.test(document.getElementById('p2b-summary').textContent), null, { timeout: 10 * 60 * 1000, polling: 2000 });
  assert.match(await page.locator('#p2b-summary').textContent(), /awaiting_human_review/, await page.locator('#p2b-actions').textContent());
  assert.equal(provider.calls.length, 4);
  // review: video served, every seam / visual / warning needs an explicit check before Accept is enabled
  assert.equal(await page.locator('#p2b-video').count(), 1);
  const boxes = page.locator('#p2b-review input[data-group]');
  assert.ok(await boxes.count() >= 7);
  assert.equal(await page.locator('#p2b-accept').isDisabled(), true);
  for (let i = 0; i < await boxes.count() - 1; i++) await boxes.nth(i).check();
  assert.equal(await page.locator('#p2b-accept').isDisabled(), true);
  await boxes.nth(await boxes.count() - 1).check();
  assert.equal(await page.locator('#p2b-accept').isDisabled(), false);
  assert.equal(await overflow(page), false);
  await page.locator('#p2b').screenshot({ path: 'video-studio/state/qa/2b-review-mobile.png' });
  await page.locator('#p2b-accept').click();
  await page.waitForFunction(() => document.getElementById('p2b-summary').textContent.includes('approved'));
  assert.match(await page.locator('#p2b-summary').textContent(), /productionReady true/);
  assert.match(await page.locator('#p2b-promotion').textContent(), /本輪未開通/);
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await overflow(page), false);
  await page.screenshot({ path: 'video-studio/state/qa/2b-desktop.png', fullPage: true });
  await page.reload();
  await page.waitForFunction(() => document.getElementById('p2b-summary').textContent.includes('approved'));
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: 2B UI – decisions require explicit confirmations; preview shows requests / cost / budget / retry policy; confirm gated by acknowledgements; double click = one execution (4 mock requests); real local chain to review; Accept gated by every seam / visual / warning check; approved survives reload; no overflow, page errors or external requests.');
} finally {
  await browser?.close();
  if (server?.listening) { await server.production.idle(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
  fs.rmSync(stateDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
