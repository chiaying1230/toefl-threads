// Subtitle: ONE component for every line of text that is spoken but not already on screen.
//
//   guide        centred under the hook sentence
//   translation  centred, quieter: the Chinese for the sentence being read
//   mascot       to the right of the mascot, left-aligned: what the mascot says
//
// No boxes: the background is plain paper, so plain ink text reads best.
// Cues come from the plan: { start, end, variant, text | line:{tokens,lang}, withMascot }
import { L } from "../layout.js";
import { fadeWin } from "../motion.js";
import { karaoke } from "./KaraokeText.js";
import { esc } from "../core.js";

export function createSubtitle(root, cues) {
  const box = document.getElementById("sub") || Object.assign(document.createElement("div"), { id: "sub" });
  root.appendChild(box);
  let shown = -1, k = null;

  function update(t) {
    let idx = -1;
    cues.forEach((c, i) => { if (t >= c.start - 0.05 && t <= c.end + 0.25) idx = i; });
    if (idx < 0) { box.style.opacity = 0; return; }
    const c = cues[idx];
    if (idx !== shown) {
      shown = idx;
      box.className = c.variant;
      const x = c.withMascot ? L.subWithMascot.x : L.subFull.x, w = c.withMascot ? L.subWithMascot.w : L.subFull.w;
      Object.assign(box.style, c.withMascot
        ? { left: x + "px", width: w + "px", top: L.mascot.y + "px", height: L.mascot.size + "px" }
        : { left: x + "px", width: w + "px", top: L.bottom.y + "px", height: "200px" });
      if (c.line) { const inner = document.createElement("div"); box.innerHTML = ""; box.appendChild(inner); k = karaoke(inner, c.line.tokens, { zh: c.line.lang === "zh" }); }
      else { k = null; box.innerHTML = `<div>${esc(c.text)}</div>`; }
    }
    if (k) k.update(t);
    box.style.opacity = fadeWin(t, c.start - 0.05, c.end + 0.25, 0.15, 0.2);
  }
  return { update };
}
