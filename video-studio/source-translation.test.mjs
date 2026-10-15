import {test} from 'node:test';import assert from 'node:assert/strict';
import path from 'node:path';import {loadCatalog} from './catalog.mjs';
import {sourceTranslations,fillMissingSourceTranslations} from './source-translation.mjs';import {sourceSentences} from './compiler.mjs';import {productionProposal} from './production-decisions.mjs';
const root=path.resolve(import.meta.dirname,'..');
test('elem-012 mixed source maps original Chinese punctuation and automatically prefills only four English sentences',()=>{
 const record=loadCatalog(root).records.get('elem-012'),prefill=sourceTranslations(record);
 assert.equal(prefill.status,'mapped',prefill.reason);
 const sentences=sourceSentences(record,[],{mode:'subtitle',seconds:2}),proposal=productionProposal(record,null,sentences,prefill);
 assert.deepEqual(Object.keys(proposal.translations.items),['story001','story003','story004','story005']);
 assert.deepEqual(Object.values(proposal.translations.items).map(i=>i.text),['家庭聚餐時，我叔叔說：「只吃穀類食物就可以省錢！」','他說他國中時這樣做過。','他存了很多錢。','然後他在體育課跌倒了。']);
});
test('Chinese full-width question/exclamation/period match their parallel source units',()=>{
 const record={post:{text:'He smiles. 我們笑了。\nDid he leave? 真的嗎？\nGo! 太好了！',zh:'他笑了。我們笑了。\n他走了嗎？真的嗎？\n走吧！太好了！'},vocabulary:[]};
 const r=sourceTranslations(record);assert.equal(r.status,'mapped',r.reason);
});
test('genuinely changed source-Chinese text and unequal sentence counts still reject a positional guess',()=>{
 for(const zh of ['他笑了。她哭了。','他笑了。']){
  assert.equal(sourceTranslations({post:{text:'He smiles. 我們笑了。',zh},vocabulary:[]}).status,'blocked');
 }
});
test('toeic-016: no space after Chinese full stop; split English ids get their source translation',()=>{
 const record=loadCatalog(root).records.get('toeic-016'),r=sourceTranslations(record,{subtitle:true});
 assert.equal(r.status,'mapped',r.reason);
 assert.deepEqual(r.items,{story001En1:'婚禮',story002:'鵝在你靠近牠的巢時可能會很有攻擊性。',story003En1:'我現在視力不好，所以以為牠是一個白色的手提包。'});
});
test('multiple English spans are sliced using the exact surrounding Chinese, not repeated whole translations',()=>{
 const r=sourceTranslations({post:{text:'我 like 這個 cake。',zh:'我喜歡這個蛋糕。'},vocabulary:[]},{subtitle:true});
 assert.equal(r.status,'mapped',r.reason);assert.deepEqual(r.items,{story001En1:'喜歡',story001En2:'蛋糕。'});
});
test('already-open editor blanks recover on save without overriding unsaved human choices or translation edits',()=>{
 const record=loadCatalog(root).records.get('toeic-016'),decisions={seriesEpisode:7,storyChinese:{mode:'subtitle',seconds:3},production:{outro:{cta:'我的設定'},translations:{mode:'per-sentence',items:{story001En1:{text:'',sourceTextHash:'old'},story002:{text:'保留我的翻譯',sourceTextHash:'existing'}}}}};
 const copy=structuredClone(decisions),next=fillMissingSourceTranslations(record,decisions);
 assert.deepEqual(decisions,copy);assert.equal(next.seriesEpisode,7);assert.equal(next.storyChinese.seconds,3);assert.equal(next.production.outro.cta,'我的設定');
 assert.equal(next.production.translations.items.story001En1.text,'婚禮');assert.equal(next.production.translations.items.story002.text,'保留我的翻譯');assert.ok(next.production.translations.items.story003En1.text);
 assert.equal(fillMissingSourceTranslations(record,{...decisions,production:{...decisions.production,translations:{mode:'none',items:{}}}}).production.translations.mode,'none');
});
