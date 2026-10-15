// Read-only live Studio smoke. ALL non-GET requests and external traffic are blocked in this browser context.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { root } from './server.mjs';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || 'C:/Users/123/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), violations = [], errors = [];
  await page.route('**/*', route => {
    const r = route.request();
    if (new URL(r.url()).origin !== 'http://127.0.0.1:8140' || r.method() !== 'GET') { violations.push({ url: r.url(), method: r.method() }); return route.abort(); }
    return route.continue();
  });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8140');
  await page.waitForFunction(() => document.querySelector('#message').textContent.includes('923'));
  await page.selectOption('#drafts', '20ee16ed-e72f-4b06-9b4c-0387fc82b0f8'); await page.click('#resume');
  await page.waitForFunction(() => document.querySelector('#p2b-summary').textContent.includes('awaiting_confirmation'));
  assert.match(await page.locator('#draft-status').textContent(), /voice_planned · revision 4/);
  assert.equal(await page.locator('#hook-zh').inputValue(), '');
  assert.equal(await page.locator('input[name=source-display]:checked').count(), 1);
  assert.match(await page.locator('input[name=source-display]:checked').locator('..').textContent(), /週末你們都去哪了/);
  assert.match(await page.locator('#production-summary').textContent(), /Compiler ✓ · Validation ✓ · Voice Plan ✓/);
  assert.match(await page.locator('#p2b-envelope').textContent(), /Segments 13 · cache 命中 0 · 需要產生 11 · duplicate 0 · silent 2/);
  assert.match(await page.locator('#p2b-envelope').textContent(), /預計送出 202 characters/);
  assert.equal(await page.locator('#p2b-envelope .requests li').count(), 11);
  assert.equal(await page.locator('#p2b-confirm').count(), 0, 'GET never restores a paid confirmation token/button');
  assert.match(await page.locator('#p2b-envelope').textContent(), /請重新產生免費預覽後再確認/);
  assert.equal(await page.getByRole('button', { name: '免費：重新做付費前預覽（production preflight + 成本）' }).isEnabled(), true);
  assert.equal(await page.locator('#p2b-ledger').textContent(), '');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 1280, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(violations, []); assert.deepEqual(errors, []);
  const db = new DatabaseSync(path.join(root, 'video-studio/state/drafts/production/coordinator.db'), { readOnly: true });
  try {
    for (const table of ['receipts', 'executions', 'attempts']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM challenges WHERE consumed_at IS NOT NULL').get().n, 0);
  } finally { db.close(); }
  console.log('PASS: live P6 revision4/awaiting_confirmation survives server restart; 11 requests/2 silent/202 chars; null Hook/confirmed CTA restored; no receipt/attempt/confirmation token via GET; mobile/desktop; all non-GET and external requests forbidden.');
} finally { await browser.close(); }
