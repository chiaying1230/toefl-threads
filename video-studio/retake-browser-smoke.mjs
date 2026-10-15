// Live GET-only smoke. No receipt/selection/paid mutation, no external network.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const proof=JSON.parse(fs.readFileSync('video-studio/state/qa/p6-retake-preflight.json'));
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'C:/Users/123/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],violations=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{const q=r.request();if(new URL(q.url()).origin!=='http://127.0.0.1:8140'||q.method()!=='GET'){violations.push(q.url());return r.abort();}return r.continue();});
 await page.goto('http://127.0.0.1:8140');await page.waitForFunction(()=>document.querySelector('#drafts').options.length>1);
 await page.selectOption('#drafts',proof.draftId);await page.click('#resume');
 await page.waitForFunction(()=>document.querySelector('#p2b-summary').textContent.includes('awaiting_confirmation'));
 const text=await page.locator('#p2b-envelope').textContent();
 assert.match(text,/human rejected/);assert.match(text,/固定 reuse（10 spoken）/);assert.match(text,/預計送出 4 characters/);assert.match(text,/requests 1/);assert.match(text,/language_code zh/);
 assert.equal(await page.locator('#p2b-envelope .requests li').count(),1);assert.equal(await page.locator('#p2b-accept').count(),0);assert.equal(await page.locator('#p2b-confirm').count(),0,'GET cannot restore confirmation token');
 assert.match(await page.locator('#p2b-summary').textContent(),/productionReady false/);assert.equal(await page.locator('#hook-zh').inputValue(),'');
 assert.equal(await page.locator('input[name=source-display]:checked').count(),1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.setViewportSize({width:1280,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);assert.deepEqual(violations,[]);
 console.log('PASS: mobile/desktop; human rejected old take; one zh request /4 chars; 10 reuse; no paid mutation, receipt, selection or approval; Promotion OFF.');
}finally{await browser.close();}
