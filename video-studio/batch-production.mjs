import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {candidates,suggestions,seriesNames} from './catalog.mjs';import {seriesProgress} from './series-progress.mjs';
import {sourceSentences,TIMINGS_ID} from './compiler.mjs';import {productionProposal,VISUAL_POLICY} from './production-decisions.mjs';import {sourceTranslations} from './source-translation.mjs';
import {issueChallenge} from './paid-voice.mjs';import {jsonHash} from './hashing.mjs';import {StudioError} from './store.mjs';

export class BatchProduction {
 constructor(production){this.production=production;this.dir=path.join(production.productionDir,'batches');fs.mkdirSync(this.dir,{recursive:true});this.busy=false;this.job=null;for(const b of this.list())if(['preparing','running'].includes(b.status)){b.status='interrupted';for(const i of b.items)if(['preparing','producing'].includes(i.status)){i.status='needs_attention';i.error='工作室曾中斷，這支不會自動重送語音，請查看草稿的實際進度。';}this.save(b);}}
 file(id){if(!/^[a-f0-9-]{36}$/.test(id))throw new StudioError('找不到這批影片。',404);return path.join(this.dir,id+'.json');}
 get(id){const file=this.file(id);if(!fs.existsSync(file))throw new StudioError('找不到這批影片。',404);return JSON.parse(fs.readFileSync(file));}
 list(){return fs.readdirSync(this.dir).filter(f=>/^[a-f0-9-]{36}\.json$/.test(f)).map(f=>this.get(f.slice(0,-5))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 save(b){const file=this.file(b.id),temp=file+'.'+randomUUID()+'.tmp';b.updatedAt=new Date().toISOString();fs.writeFileSync(temp,JSON.stringify(b,null,2)+'\n',{flag:'wx'});fs.renameSync(temp,file);return b;}
 approval(b){return jsonHash(b.items.filter(i=>i.envelopeHash).map(i=>({draftId:i.draftId,runId:i.runId,envelopeHash:i.envelopeHash,budget:i.budget})));}
 async prepare({count=3,pack=''}){
  if(this.busy||this.production.jobs.size)throw new StudioError('目前有製作正在執行，請完成後再建立新批次。',409);
  if(!Number.isInteger(count)||count<1||count>20||pack&&!Object.hasOwn(seriesNames,pack))throw new StudioError('請選擇1到20支，以及有效的系列。');
  this.busy=true;const b={id:randomUUID(),createdAt:new Date().toISOString(),status:'preparing',count,pack,policy:'auto-source-all-v2',items:[],totals:{requests:0,characters:0}};this.save(b);
  try{
   const ctx=this.production.context(),used=new Set(ctx.store.list().map(d=>d.contentId)),groups=Object.keys(seriesNames).filter(p=>!pack||p===pack).map(p=>[...ctx.store.catalog.records.values()].filter(r=>r.pack===p&&!used.has(r.post.id)&&!ctx.store.catalog.frozen?.has(r.post.id)&&candidates(r,ctx.store.catalog.vocab).quizzes.length));
   const selected=[];while(selected.length<count&&groups.some(g=>g.length))for(const g of groups)if(g.length&&selected.length<count)selected.push(g.shift());
   if(!selected.length)throw new StudioError('這個系列目前沒有尚未建立的合適文章。');
   for(const record of selected){const item={contentId:record.post.id,status:'preparing'};b.items.push(item);this.save(b);
    try{const {store,workflow}=this.production.context(),choices=candidates(record,store.catalog.vocab),s=suggestions(this.production.repoRoot,record),q=choices.quizzes[0],vocabulary=record.vocabulary.map(v=>v.key),next=seriesProgress(this.production.repoRoot,store.list())[s.series].nextEpisode;
     let draft=store.create(record.post.id,record.sourceHash);item.draftId=draft.id;this.save(b);
     const decisions={...draft.decisions,series:s.series,seriesEpisode:next,level:s.level,vocabulary,hook:{candidateId:choices.hooks[0].id,text:choices.hooks[0].text,zh:null},quiz:{...q,candidateId:q.id},storyChinese:{mode:'subtitle',seconds:2}};
     const sentences=sourceSentences(record,[],decisions.storyChinese),proposal=productionProposal(record,decisions,sentences,sourceTranslations(record,{subtitle:true}));
     const translated=Object.values(proposal.translations.items).every(i=>i.text?.trim());
     decisions.production={version:proposal.version,outro:proposal.outro,audio:proposal.audio,translations:translated?{mode:'per-sentence',items:proposal.translations.items}:{mode:'none',items:{}},confirmations:{visualPolicyVersion:VISUAL_POLICY.version,timingsVersion:TIMINGS_ID}};
     if(!translated)item.notice='來源中文無法可靠逐句對應，這支不顯示逐句翻譯；原文中文仍保留。';
     draft=store.update(draft.id,{revision:draft.revision,decisions});const free=workflow.run(draft.id,{revision:draft.revision});item.series=decisions.series;item.episode=next;
     if(free.status!=='voice_planned')throw new StudioError(free.steps.flatMap(s=>s.result?.errors||s.result?.blocked||[]).map(e=>e.message).join('；')||'免費內容檢查未通過。');
     const preview=await this.production.preview(draft.id,{revision:draft.revision});item.runId=preview.run.runId;
     if(!preview.envelope)throw new StudioError(preview.run.reason?.map(r=>r.message).join('；')||'免費前置檢查未通過。');
     item.envelopeHash=preview.envelope.envelopeHash;item.budget=preview.envelope.budget;item.requests=preview.envelope.requests;item.status=item.requests.length?'planned':'producing';this.save(b);
     if(!item.requests.length){await this.production.idle();const view=this.production.view(draft.id);item.status=view.run.state==='awaiting_review'?'awaiting_review':'needs_attention';item.error=view.run.reason?.map(r=>r.message).join('；');}
    }catch(e){item.status='needs_attention';item.error=e.message;}this.save(b);
   }
   b.totals={requests:b.items.reduce((n,i)=>n+(i.budget?.maxRequests||0),0),characters:b.items.reduce((n,i)=>n+(i.budget?.maxSubmittedChars||0),0)};b.approvalHash=this.approval(b);b.status=b.items.some(i=>i.status==='planned')?'ready':'finished';return this.save(b);
  }catch(e){b.status='interrupted';b.error=e.message;this.save(b);throw e;}finally{this.busy=false;}
 }
 start(id,{approvalHash,acknowledgements}){
  const b=this.get(id);if(b.status==='running')return b;
  if(this.busy||this.production.jobs.size)throw new StudioError('目前有影片正在製作，請稍候。',409);
  if(!['ready','interrupted'].includes(b.status)||approvalHash!==b.approvalHash||this.approval(b)!==approvalHash||acknowledgements?.budgetAccepted!==true)throw new StudioError('請重新查看整批的語音需求，再按開始。',409);
  b.status='running';b.authorizedAt=new Date().toISOString();this.save(b);this.busy=true;
  this.job=this.work(b).catch(e=>{b.status='interrupted';b.error=e.message;this.save(b);}).finally(()=>{this.busy=false;this.job=null;});return b;
 }
 async work(b){for(const [index,item]of b.items.entries())if(item.status==='planned'){
  item.status='producing';this.save(b);
  try{const view=this.production.view(item.draftId);if(view.run.runId!==item.runId||view.envelope?.envelopeHash!==item.envelopeHash)throw new StudioError('內容或語音需求已變更，這支停止，不使用舊的批次授權。');
   const challenge=issueChallenge(this.production.coordinator,item.runId,item.envelopeHash);
   const confirmed=await this.production.confirm(item.draftId,{runId:item.runId,challenge:challenge.challenge,idempotencyKey:`batch-${b.id}-${index}`,budget:item.budget,acknowledgements:{noAutomaticRetry:true,estimateIsNotBilling:true}});item.executionId=confirmed.executionId;this.save(b);
   await this.production.idle();const result=this.production.view(item.draftId);item.status=result.run.state==='awaiting_review'?'awaiting_review':'needs_attention';item.error=result.run.reason?.map(r=>r.message).join('；')||null;
  }catch(e){item.status='needs_attention';item.error=e.message;}this.save(b);
 }b.status='finished';this.save(b);}
 view(id){const b=this.get(id);for(const i of b.items)if(['awaiting_review','producing','needs_attention'].includes(i.status)&&i.runId){try{const v=this.production.view(i.draftId);if(v.run.runId===i.runId){if(v.run.state==='approved')i.status='accepted';else if(v.run.state==='awaiting_review')i.status='awaiting_review';}}catch{}}return b;}
}
