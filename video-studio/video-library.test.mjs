import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import {latestVideos,videoLibrary,setVideoUploaded} from './video-library.mjs';
test('latest playable version per content and series, stable identity despite changed numbering',()=>{
 const list=[{id:'old',series:'國小國中',contentId:'a',episode:1,createdAt:'2026-01-01'},{id:'new',series:'國小國中',contentId:'a',episode:2,createdAt:'2026-02-01'},{id:'other',series:'TOEFL',contentId:'a',createdAt:'2026-01-01'},{id:'b',series:'國小國中',contentId:'b',createdAt:'2026-01-01'}];
 assert.deepEqual(latestVideos(list).map(x=>x.id),['new','other','b']);assert.equal(list.length,4);
});
test('upload status persists, toggles back and refuses unknown or corrupted video',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'library-board-')),dir=path.join(root,'state');fs.mkdirSync(path.join(root,'docs/p2-auto'),{recursive:true});fs.mkdirSync(path.join(root,'outputs'));
 const file=path.join(root,'outputs/p2.mp4'),bytes=Buffer.from('fixture-video'),hash=createHash('sha256').update(bytes).digest('hex');fs.writeFileSync(file,bytes);fs.writeFileSync(path.join(root,'docs/p2-auto/FROZEN.json'),JSON.stringify({reference:'outputs/p2.mp4',acceptedAt:'2026-01-01',hashes:{output:{'outputs/p2.mp4':hash}}}));
 try{assert.equal(videoLibrary(root,dir)[0].uploaded,false);assert.equal(setVideoUploaded(root,dir,'reference-p2',true).uploaded,true);assert.equal(videoLibrary(root,dir)[0].uploaded,true);assert.equal(setVideoUploaded(root,dir,'reference-p2',false).uploaded,false);assert.throws(()=>setVideoUploaded(root,dir,'reference-p2','yes'));assert.throws(()=>setVideoUploaded(root,dir,'unknown',true));fs.writeFileSync(file,'tampered');assert.deepEqual(videoLibrary(root,dir),[]);assert.throws(()=>setVideoUploaded(root,dir,'reference-p2',true));}finally{fs.rmSync(root,{recursive:true,force:true});}
});
