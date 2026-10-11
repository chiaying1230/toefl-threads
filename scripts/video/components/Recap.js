// Recap (silent, ≤ 2 s): the words just learned tick off one by one. Not a second card – just a checklist.
import { L } from "../layout.js";
import { el, esc, fitWidth, fitLines } from "../core.js";
import { DUR, fadeWin, enter } from "../motion.js";

export function createRecap(root, spec) {
  const s = spec.scenes.recap;
  const layer = el("div", "scene");
  const rowH = Math.min(200, Math.floor(860 / s.items.length)), y0 = Math.round(L.main.y + (L.main.h - s.items.length * rowH) / 2);
  const rows = s.items.map((it, i) => {
    const r = el("div", "rc-row", { top: y0 + i * rowH + "px", height: rowH - 20 + "px" },
      `<div class="rc-check">✓</div><div class="rc-text"><div class="rc-word">${esc(it.word)}</div><div class="rc-zh">${esc(it.zh)}</div></div>`);
    r.dataset.aud = "recap-" + i;
    layer.appendChild(r);
    return r;
  });
  root.appendChild(layer);
  rows.forEach((r) => {
    const w = r.querySelector(".rc-word"); w.style.whiteSpace = "normal"; w.style.maxWidth = "700px";
    fitLines(w, [96, 84, 72, 64, 56], 2, 1.04);
    fitLines(r.querySelector(".rc-zh"), [52, 48, 44], 2, 1.2);
  });
  function update(t) {
    layer.style.opacity = fadeWin(t, s.start, s.end, DUR.fade, DUR.fade);
    rows.forEach((r, i) => enter(r, t, s.items[i].at, DUR.base, 26));
  }
  return { update };
}
