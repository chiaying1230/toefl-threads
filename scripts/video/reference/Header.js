// Series identity in the top right: `series · #NN · level`, e.g. "TOEIC · #01 · L2" or "TOEFL · #02 · L1–L2".
// An episode uses it when it carries structured metadata (`series`, `seriesEpisode`, `level: { min, max }`, `contentId`).
// Nothing is ever derived from `contentId`, the file name or the folder: series and seriesEpisode are explicit data.
// Without `series` the episode is legacy: the header shows `episodeLabel` and the account row keeps its level badge, as before.
// Browser file. scripts/video/voice/episode-refs.mjs holds the twin used by the validator and verify-episode (the repo has no
// package.json "type", so Node cannot import this file); series.test.mjs locks the two together.

export const usesSeriesHeader = (d) => d.series !== undefined;

/** L2 for min === max, otherwise L1–L2 (an en dash, no spaces). The range is a display form; the data stays { min, max }. */
export function levelText(level) {
  return level.min === level.max ? `L${level.min}` : `L${level.min}–L${level.max}`;
}

/** The episode number: 1 → #01, 10 → #10, 100 → #100 (at least two digits, no upper limit). */
export const episodeText = (n) => `#${String(n).padStart(2, "0")}`;

export function headerLabel(d) {
  return `${d.series} · ${episodeText(d.seriesEpisode)} · ${levelText(d.level)}`;
}
