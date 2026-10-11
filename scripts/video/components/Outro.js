// Outro: a short, fixed sign-off. Wordmark + tagline; the mascot (same slot as always) says the closing line.
// One action only: if the episode's CTA is a link, the address is shown here; a comment CTA was already asked in the quiz.
import { el, esc } from "../core.js";
import { DUR, fadeWin, enter } from "../motion.js";

export function createOutro(root, spec) {
  const s = spec.scenes.outro, series = spec.series;
  const layer = el("div", "scene");
  const mark = el("div", "ot-mark", { top: "560px" }, "toEfu");
  const tag = el("div", "ot-tag", { top: "760px" }, esc(series.tagline));
  layer.append(mark, tag);
  let url = null;
  if (s.showUrl) { url = el("div", "ot-url", { top: "880px" }, `<span>${esc(series.url)}</span>`); layer.appendChild(url); }
  root.appendChild(layer);
  function update(t) {
    layer.style.opacity = fadeWin(t, s.start, s.end + 1, DUR.fade, 0);   // holds on the last frame
    enter(mark, t, s.start, DUR.base, 18);
    enter(tag, t, s.start + 0.12, DUR.base, 14);
    if (url) enter(url, t, s.start + 0.24, DUR.base, 14);
  }
  return { update };
}
