// Live GET-only MP4/review smoke. Blocks every mutation/paid/external request; does not accept the human review.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'C:/Users/123/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const proof=JSON.parse(fs.readFileSync('video-studio/state/qa/p6-r10-recovery.json'));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],violations=[];
 await page.route('**/*',route=>{const r=route.request();if(new URL(r.url()).origin!=='http://127.0.0.1:8140'||r.method()!=='GET'){violations.push(r.url());return route.abort();}return route.continue();});
 page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8140');
 await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('923'));
 await page.selectOption('#drafts',proof.draftId);await page.click('#resume');
 await page.waitForFunction(()=>document.querySelector('#p2b-review #p2b-video'));
 assert.match(await page.locator('#p2b-summary').textContent(),/awaiting_human_review · awaiting_review/);
 assert.equal(await page.locator('#p2b-accept').isDisabled(),true);assert.equal(await page.locator('#hook-zh').inputValue(),'');
 assert.equal(await page.locator('input[name=source-display]:checked').count(),1);
 await page.locator('#p2b-video').evaluate(async v=>{v.muted=true;await v.play();});
 await page.waitForFunction(()=>document.querySelector('#p2b-video').currentTime>.05);
 const duration=await page.locator('#p2b-video').evaluate(v=>v.duration);assert.ok(Math.abs(duration-24.066667)<.1);
 await page.locator('#p2b-video').evaluate(v=>v.pause());
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.setViewportSize({width:1280,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);assert.deepEqual(violations,[]);
 const db=new DatabaseSync(path.resolve('video-studio/state/drafts/production/coordinator.db'),{readOnly:true});
 try{for(const [table,n]of [['receipts',1],['executions',1],['attempts',11]])assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,n);assert.equal(db.prepare('SELECT SUM(network_attempted) n FROM attempts').get().n,11);assert.equal(db.prepare("SELECT COUNT(*) n FROM reviews WHERE status='accepted'").get().n,0);}finally{db.close();}
 console.log(`PASS: live r10 P6 MP4 plays (${duration}s); awaiting_human_review, accept disabled, null Hook/CTA snapshot restored; mobile/desktop; GET-only, no extra paid attempt or approval.`);
}finally{await browser.close();}
