// Real elem-02 decisions copied to TEMP; source/live draft remain read-only. Only the free workflow is exercised.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { createStudio, root } from './server.mjs';
import { DraftStore } from './store.mjs';
import { loadCatalog } from './catalog.mjs';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || 'C:/Users/123/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const liveFile = path.join(root, 'video-studio/state/drafts/20ee16ed-e72f-4b06-9b4c-0387fc82b0f8.json'), original = fs.readFileSync(liveFile);
const copy = JSON.parse(original), catalog = loadCatalog(root), record = catalog.records.get('elem-02'), rawSource = JSON.stringify(record);
copy.steps = []; copy.artifacts = {}; copy.approvals = {}; copy.status = 'configured'; delete copy.workflow; delete copy.workflowHistory;
copy.decisions.sourceDisplayOnly = []; // normalize the temp fixture; the live P6 revision already has a selected range
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-display-browser-'));
new DraftStore(dir, catalog).persist(copy);
let server, browser, providerRequests = 0, keyReads = 0;
async function start() {
  server = createStudio({ stateDir: dir, catalogLoader: () => catalog, apiKey: () => { keyReads++; throw Error('Secret access forbidden'); }, fetchImpl: () => { providerRequests++; throw Error('Provider access forbidden'); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`;
}
try {
  let url = await start();
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage();
  const errors = [], external = []; page.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : (external.push(route.request().url()), route.abort()));
  const load = async () => {
    await page.goto(url); await page.waitForFunction(() => document.querySelector('#message').textContent.includes('923'));
    await page.selectOption('#drafts', copy.id); await page.click('#resume');
    await page.waitForFunction(() => document.querySelector('#editor').hidden === false);
  };
  const range = () => page.locator('#source-display .choice').filter({ hasText: '週末你們都去哪了' }).locator('input');
  const save = async () => { await page.click('#save'); await page.waitForFunction(() => document.querySelector('#message').textContent.startsWith('已保存到磁碟')); };
  const plan = async () => { await page.click('#run-production'); await page.waitForFunction(() => document.querySelector('#voice-summary').textContent.includes('免費初步規劃')); };
  await load(); assert.equal(await range().isChecked(), false); assert.equal(await page.locator('#hook-zh').inputValue(), '');
  // Toggling a source range must preserve ALL unrelated pending form decisions, including sentence translations.
  const translation = page.locator('#pd-sentences textarea[data-id=story002]');
  await translation.fill('我現在好睏。'); await page.fill('#pd-cta', '收藏這篇。');
  await range().check(); assert.equal(await translation.inputValue(), '我現在好睏。');
  assert.equal(await page.locator('#pd-sentences textarea[data-id=story005]').count(), 0);
  assert.equal(await page.locator('#run-production').isDisabled(), true);
  await range().uncheck(); assert.equal(await translation.inputValue(), '我現在好睏。');
  assert.equal(await page.locator('#pd-sentences textarea[data-id=story005]').count(), 1);
  await range().check(); await save(); await plan();
  assert.match(await page.locator('#production-summary').textContent(), /整理影片內容 ✓ · 檢查內容 ✓ · 計算語音需求 ✓/);
  const job = await (await fetch(`${url}/api/drafts/${copy.id}`)).json();
  const artifact = name => fetch(`${url}/api/drafts/${copy.id}/artifacts/${name}`).then(r => r.json());
  const episode = await artifact('episode'), narration = await artifact('narration'), voicePlan = await artifact('voicePlan');
  assert.equal(episode.hook.zh, null); assert.ok(episode.story.at(-1).parts.some(p => p.type === 'translation' && p.text === '週末你們都去哪了'));
  assert.ok(narration.segments.every(s => !s.text.includes('週末你們都去哪了')));
  assert.ok(voicePlan.segments.every(s => !s.text.includes('週末你們都去哪了')));
  assert.equal(job.decisions.production.translations.items.story002.text, '我現在好睏。');
  assert.equal(voicePlan.networkRequests, 0); assert.equal(voicePlan.generatedThisRun, 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 1280, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  // Real server restart, not merely a browser reload. Restore the exact checked snapshot.
  await page.goto('about:blank'); await new Promise(r => server.close(r)); url = await start(); await load();
  assert.equal(await range().isChecked(), true); assert.match(await page.locator('#voice-summary').textContent(), /免費初步規劃/);
  assert.equal(await translation.inputValue(), '我現在好睏。');
  // Cancel and save; old plan gone, CTA speech correctly blocks instead of silently excluding it.
  await range().uncheck(); await page.locator('#pd-sentences textarea[data-id=story005]').fill('週末你們都去哪了'); await save();
  await page.click('#run-production'); await page.waitForFunction(() => document.querySelector('#message').textContent.includes('停住了'));
  assert.match(await page.locator('#production-results').textContent(), /MIXED_STORY_LANGUAGE/);
  assert.equal(await page.locator('#voice-summary').textContent(), '');
  await range().check(); await save(); await plan();
  const confirmed = JSON.parse(fs.readFileSync(path.join(dir, `${copy.id}.json`))).decisions.sourceDisplayOnly;
  record.post.text = record.post.text.replace('週末你們都去哪了', '週末你們都去哪了（來源變更）'); // TEMP in-memory catalog only
  await page.reload(); await page.waitForFunction(() => document.querySelector('#production-notice').textContent.includes('原文顯示設定已過期'));
  assert.equal(await page.locator('#run-production').isDisabled(), true); assert.equal(await page.locator('#voice-summary').textContent(), '');
  assert.match(await page.locator('#source-display').textContent(), /這段需要重新確認/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, `${copy.id}.json`))).decisions.sourceDisplayOnly, confirmed);
  record.post.text = JSON.parse(rawSource).post.text;
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.equal(providerRequests, 0); assert.equal(keyReads, 0);
  assert.deepEqual(fs.readFileSync(liveFile), original); assert.equal(JSON.stringify(record), rawSource);
  console.log('PASS: elem-02 explicit source checkbox/save → compile/validation/free plan; null Hook; translation part retained/no CTA TTS; pending fields preserved; restart restore; cancel BLOCK; stale browser BLOCK; mobile/desktop no overflow; provider/key access 0; live source/draft unchanged.');
  console.log('voicePlan', JSON.stringify({ segmentCount: voicePlan.segmentCount, counts: voicePlan.counts, charsToGenerate: voicePlan.charsToGenerate, spoken: voicePlan.segments.filter(s => !s.silent).map(s => ({ id: s.id, speaker: s.speaker, text: s.text })) }));
} finally {
  await browser?.close(); if (server?.listening) await new Promise(r => server.close(r));
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
