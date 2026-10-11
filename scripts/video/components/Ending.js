// Ending: the same content, wrapped up – ✓ the words learned, an optional teaser for the next post.
// No logo page: the series chip in the header is the brand. The mascot (same slot) says the closing line.
// One action only: a link CTA shows the address here; a comment CTA was already asked in the quiz.
import { L } from "../layout.js";
import { el, esc } from "../core.js";
import { DUR, fadeWin, enter } from "../motion.js";

export function createEnding(root, spec) {
  const s = spec.scenes.ending, series = spec.series;
  const layer = el("div", "scene");
  const chips = el("div", "en-chips", { top: (s.teaserZh ? 470 : 600) + "px" },
    s.words.map((w) => `<div class="en-chip"><span class="en-check">✓</span><span class="en-word">${esc(w)}</span></div>`).join(""));
  chips.dataset.aud = "end-chips";
  layer.appendChild(chips);
  let tease = null, url = null;
  if (s.teaserZh) { tease = el("div", "en-tease", { top: "820px" }, esc(s.teaserZh)); tease.dataset.aud = "end-tease"; layer.appendChild(tease); }
  if (s.showUrl) { url = el("div", "en-url", { top: "1090px" }, `<span>${esc(series.url)}</span>`); url.dataset.aud = "end-url"; layer.appendChild(url); }
  root.appendChild(layer);
  const kids = [...chips.children];
  function update(t) {
    layer.style.opacity = fadeWin(t, s.start, s.end + 1, DUR.fade, 0);          // holds on the last frame
    kids.forEach((k, i) => enter(k, t, s.start + 0.05 + i * 0.1, DUR.base, 18));
    if (tease) enter(tease, t, s.start + 0.2 + kids.length * 0.1, DUR.base, 18);
    if (url) enter(url, t, s.start + 0.4, DUR.base, 14);
  }
  return { update };
}
