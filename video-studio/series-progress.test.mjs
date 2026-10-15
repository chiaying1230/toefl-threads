import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {once} from 'node:events';
import {fixture} from './fixtures.mjs';import {createStudio} from './server.mjs';import {DraftStore} from './store.mjs';import {correctSeriesEpisode} from './series-correction.mjs';
test('series remembers reserved numbers across creation, manual overrides and server restart',async()=>{
 const f=fixture(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'series-memory-'));f.catalog.frozen=new Set();let server;
 const start=async()=>{server=createStudio({stateDir:dir,catalogLoader:()=>f.catalog,apiKey:()=>{throw Error('No key reads')}});server.listen(0,'127.0.0.1');await once(server,'listening');};
 const close=async()=>{await new Promise(r=>{server.close(r);server.closeAllConnections()});};
 const api=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}`+p,{method:body?'POST':'GET',...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});assert.equal(r.ok,true);return r.json();};
 try{await start();const suggested=(await api('/api/contents/'+f.record.post.id)).suggestions.seriesEpisode;
 const create=()=>api('/api/drafts',{contentId:f.record.post.id});const a=await create(),b=await create();assert.equal(a.decisions.seriesEpisode,suggested);assert.equal(b.decisions.seriesEpisode,suggested+1);
 const store=new DraftStore(dir,f.catalog),first=store.get(a.id);first.decisions.seriesEpisode=20;store.persist(first);
 assert.equal((await api('/api/series-progress')).series.TOEFL.nextEpisode,21);assert.equal((await api('/api/series-progress')).series['高中'].nextEpisode,1);
 await close();await start();const [c,d]=await Promise.all([create(),create()]);assert.deepEqual([c.decisions.seriesEpisode,d.decisions.seriesEpisode].sort((x,y)=>x-y),[21,22]);assert.equal((await api('/api/drafts/'+a.id)).decisions.seriesEpisode,20);
 const page=await fetch(`http://127.0.0.1:${server.address().port}/videos`);assert.equal(page.status,200);assert.match(await page.text(),/我的影片/);
 const video=await fetch(`http://127.0.0.1:${server.address().port}/api/video-library/reference-p2/final`,{headers:{range:'bytes=0-3'}});assert.equal(video.status,206);assert.equal((await video.arrayBuffer()).byteLength,4);
 const missing=await fetch(`http://127.0.0.1:${server.address().port}/api/video-library/unknown/final`);assert.equal(missing.status,404);
 }finally{if(server?.listening)await close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('correcting numbering changes only that field, keeps history, rejects stale revision and invalid number',()=>{
 const f=fixture(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'series-correction-'));
 try{const store=new DraftStore(dir,f.catalog);store.persist(f.draft);const before=structuredClone(f.draft.decisions);const updated=correctSeriesEpisode(store,f.draft.id,{revision:1,episode:2});assert.deepEqual(updated.decisions,{...before,seriesEpisode:2});assert.equal(updated.revision,2);assert.equal(updated.productionReady,false);assert.throws(()=>correctSeriesEpisode(store,f.draft.id,{revision:1,episode:3}));assert.throws(()=>correctSeriesEpisode(store,f.draft.id,{revision:2,episode:-1}));assert.equal(correctSeriesEpisode(store,f.draft.id,{revision:2,episode:2}).revision,2);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
