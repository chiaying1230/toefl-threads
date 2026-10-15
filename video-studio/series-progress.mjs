import {seriesNames,suggestions} from './catalog.mjs';

// Saved drafts reserve their explicitly chosen numbers, including unfinished ones.
// Reload/retry/retake keeps that number; only a new draft advances the series.
export function seriesProgress(root,drafts) {
  return Object.fromEntries(Object.entries(seriesNames).map(([pack,series])=>{
    const canonical=suggestions(root,{pack,vocabulary:[]}).seriesEpisode-1;
    const saved=drafts.filter(d=>d.decisions?.series===series&&Number.isSafeInteger(d.decisions.seriesEpisode)&&d.decisions.seriesEpisode>0);
    const highest=Math.max(canonical,0,...saved.map(d=>d.decisions.seriesEpisode));
    return [series,{series,lastEpisode:highest,nextEpisode:highest+1}];
  }));
}
