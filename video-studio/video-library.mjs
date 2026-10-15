import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {randomUUID} from 'node:crypto';
import {StudioError} from './store.mjs';
import {Candidate} from './candidate.mjs';

export function videoLibrary(repo,productionDir,onlyId=null) {
  const items=[];
  const dbFile=path.join(productionDir,'coordinator.db');
  if(fs.existsSync(dbFile)){
    const db=new DatabaseSync(dbFile,{readOnly:true});
    try{
      const sql="SELECT * FROM runs WHERE EXISTS (SELECT 1 FROM steps WHERE steps.run_id=runs.run_id AND step='verify' AND status='succeeded')";
      const runs=onlyId?db.prepare(sql+' AND run_id=? ORDER BY created_at DESC').all(onlyId):db.prepare(sql+' ORDER BY created_at DESC').all();
      for(const run of runs)try{
        const inputs=JSON.parse(run.inputs),candidate=new Candidate(productionDir,run.candidate_id,inputs.bindings.engine);
        const mix=db.prepare("SELECT result FROM steps WHERE run_id=? AND step='mix' AND status='succeeded' ORDER BY finished_at DESC LIMIT 1").get(run.run_id);
        if(!mix)continue;const ref=JSON.parse(mix.result).outputs.find(r=>r.role==='final');if(!ref)continue;
        candidate.verifyDeep(ref);const file=candidate.verify(ref),d=candidate.readJson(inputs.inputRefs.decisions).decisions,n=candidate.readJson(inputs.inputRefs.narration);
        items.push({id:run.run_id,draftId:run.draft_id,contentId:n.id,label:d.hook?.text?.trim()||n.id,series:d.series,episode:d.seriesEpisode,revision:run.revision,status:run.state==='approved'?'已確認':run.state==='awaiting_review'?'等你確認':'先前版本',createdAt:run.created_at,file,etag:ref.bytesHash,bytes:fs.statSync(file).size});
      }catch{ /* Missing/tampered evidence must never yield a playable library entry. */ }
    }finally{db.close();}
  }
  // Explicit canonical legacy mapping; labels never inferred from content IDs.
  for(const [id,series,episode] of [['p2','TOEFL',1],['p348','TOEFL',2],['toeic-079','TOEIC',1],['ielts-068','IELTS',1]]){
    if(onlyId&&onlyId!=='reference-'+id)continue;
    const manifest=path.join(repo,'docs',id+'-auto','FROZEN.json');if(!fs.existsSync(manifest))continue;
    const frozen=JSON.parse(fs.readFileSync(manifest)),file=path.resolve(repo,frozen.reference);
    if(!file.startsWith(path.resolve(repo)+path.sep)||!fs.existsSync(file)||path.extname(file)!=='.mp4')continue;
    const expected=Object.values(frozen.hashes).map(group=>group[frozen.reference]).find(Boolean),etag=createHash('sha256').update(fs.readFileSync(file)).digest('hex');if(!expected||etag!==expected)continue;
    items.push({id:'reference-'+id,contentId:id,series,episode,status:'已保存的正式影片',createdAt:frozen.acceptedAt||'',file,etag,bytes:fs.statSync(file).size});
  }
  const latest=onlyId?items:latestVideos(items),state=readUploadState(productionDir);
  return latest.map(item=>({...item,title:`${item.series} · 第 ${item.episode} 集 · ${item.label||item.contentId}`,uploaded:state.items[videoKey(item)]?.versionId===item.id&&state.items[videoKey(item)]?.uploaded===true,playUrl:'/api/video-library/'+item.id+'/final',downloadUrl:'/api/video-library/'+item.id+'/final?download=1'}));
}

const videoKey=v=>JSON.stringify([v.series,v.contentId]);
export function latestVideos(items){const keys=new Set();return [...items].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).filter(v=>{const key=videoKey(v);if(keys.has(key))return false;keys.add(key);return true;});}
function readUploadState(dir){const file=path.join(dir,'library-upload-status.json');if(!fs.existsSync(file))return {version:1,items:{}};const state=JSON.parse(fs.readFileSync(file));if(state.version!==1||!state.items||typeof state.items!=='object'||Array.isArray(state.items))throw new StudioError('影片分類紀錄無法讀取，請保留檔案並重新檢查。',409);return state;}
export function setVideoUploaded(repo,dir,id,uploaded){
  if(typeof uploaded!=='boolean')throw new StudioError('請選擇已上傳或未上傳。');
  const item=videoLibrary(repo,dir).find(v=>v.id===id);if(!item)throw new StudioError('影片已有更新版本，請重新整理後再移動。',409);
  const state=readUploadState(dir);state.items[videoKey(item)]={versionId:id,uploaded,updatedAt:new Date().toISOString()};
  fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'library-upload-status.json'),temp=file+'.'+randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(state,null,2)+'\n',{flag:'wx'});fs.renameSync(temp,file);
  return {...item,uploaded};
}
