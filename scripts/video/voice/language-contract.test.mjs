import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prepareNarration } from './segments.mjs';
import { buildRequest } from './elevenlabs.mjs';
import { loadVoiceConfig } from './config.mjs';
const cfg=loadVoiceConfig();
const narration=()=>({id:'dry-language',requestContract:'explicit-language-v1',segments:[
 {id:'story',kind:'story',text:'We study at home.',language:'en'},
 {id:'meaning',kind:'meaning',text:'家庭作業',language:'zh'},
 {id:'quiz',kind:'quiz',silent:true,duration:2},
]});
const prepare=n=>prepareNarration(n,cfg,{requireApiKey:false,env:{}});

test('explicit en/zh metadata enters exact existing HTTP body; silent has no voice/hash',()=>{
 const p=prepare(narration());
 assert.equal(buildRequest({voice:p.segments[0].voice,text:p.segments[0].speak}).body.language_code,'en');
 assert.equal(buildRequest({voice:p.segments[1].voice,text:p.segments[1].speak}).body.language_code,'zh');
 assert.equal(p.segments[2].hash,undefined);assert.equal(p.segments[2].voice,undefined);
});
test('spoken missing/unsupported/wrong-speaker language blocks; request text cannot choose language',()=>{
 for(const language of [undefined,null,'','fr','en']){
  const n=narration();n.segments[1].language=language;
  assert.throws(()=>prepare(n),/explicit.*language/);
 }
});
test('legacy hash remains separate; sealed-reuse preserves exact original hash only',()=>{
 const legacy=narration();delete legacy.requestContract;for(const s of legacy.segments)delete s.language;
 const old=prepare(legacy),n=narration(),fresh=prepare(n);
 assert.notEqual(old.segments[1].hash,fresh.segments[1].hash);
 n.segments[1].ttsTake={kind:'sealed-reuse',id:'11111111-1111-4111-8111-111111111111',hash:old.segments[1].hash,languageCode:null};
 assert.equal(prepare(n).segments[1].hash,old.segments[1].hash);
 n.segments[1].text+='錯';assert.throws(()=>prepare(n),/contract mismatch/);
});
test('immutable take identities separate identical-body retakes; language changes always separate audio identity',()=>{
 const a=narration(),b=narration();
 a.segments[1].ttsTake={kind:'retake',id:'11111111-1111-4111-8111-111111111111'};
 b.segments[1].ttsTake={kind:'retake',id:'22222222-2222-4222-8222-222222222222'};
 const x=prepare(a).segments[1],y=prepare(b).segments[1];assert.notEqual(x.hash,y.hash);
 assert.deepEqual(buildRequest({voice:x.voice,text:x.speak}),buildRequest({voice:y.voice,text:y.speak}));
});
test('interrupted sentence retains one TTS unit + identical parts under explicit language contract',()=>{
 const n=JSON.parse(fs.readFileSync('scripts/video/narration/p348.json'));
 const before=prepare(n);n.requestContract='explicit-language-v1';
 for(const s of n.segments)if(!s.silent)s.language=s.kind==='meaning'?'zh':'en';
 const after=prepare(n);assert.equal(after.segments.length,before.segments.length);assert.deepEqual(after.order,before.order);
 assert.ok(after.segments.some(s=>s.parts));
 for(let i=0;i<after.segments.length;i++)assert.deepEqual(after.segments[i].parts,before.segments[i].parts);
});
