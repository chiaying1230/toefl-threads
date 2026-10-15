import {seriesNames} from './catalog.mjs';
import {StudioError,configurationComplete} from './store.mjs';

// Only numbering changes here. Every content/take decision remains byte-equivalent;
// revision and downstream freshness still change exactly as with an editor save.
export function correctSeriesEpisode(store,id,{revision,episode}) {
  const d=store.get(id),record=store.catalog.records.get(d.contentId);
  if(revision!==d.revision)throw new StudioError('草稿已更新，請重新載入。',409);
  if(!record||record.sourceHash!==d.sourceHash)throw new StudioError('來源已變更，請先重新檢查文章。',409);
  if(!Object.values(seriesNames).includes(d.decisions.series)||!Number.isSafeInteger(episode)||episode<1)throw new StudioError('請選擇系列，集數必須是正整數。');
  if(episode===d.decisions.seriesEpisode)return d;
  if(d.workflow)d.workflowHistory=[...(d.workflowHistory||[]),{...d.workflow,steps:d.steps,artifacts:d.artifacts,invalidatedAt:new Date().toISOString(),reason:'series-episode-corrected'}].slice(-10);
  d.decisions.seriesEpisode=episode;d.revision++;d.updatedAt=new Date().toISOString();d.status=configurationComplete(d.decisions)?'configured':'draft';
  d.steps=[];d.artifacts={};d.approvals={};delete d.workflow;
  return store.persist(d);
}
