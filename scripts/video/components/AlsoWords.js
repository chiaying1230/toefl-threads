// AlsoWords: the other words of the same post, as quick one-line rows (word · meaning).
// Only words that were visible in the thread excerpt appear here. The main word keeps the full card.
import { L } from "../layout.js";
import { el, esc, fitLines } from "../core.js";
import { DUR, fadeWin, enter } from "../motion.js";

export function createAlsoWords(root, spec) {
  const s = spec.scenes.also;
  if (!s) return { update() {} };
  const layer = el("div", "scene");
  // the block (title + rows) is centred in the main zone
  const blockH = 90 + s.items.length * 190, y0 = Math.round(L.main.y + (L.main.h - blockH) / 2);
  const title = el("div", "aw-title", { top: y0 + "px" }, "同一篇裡還有");
  layer.appendChild(title);
  const rows = s.items.map((it, i) => {
    const r = el("div", "aw-row", { top: y0 + 90 + i * 190 + "px" },
      `<div><span class="aw-word">${esc(it.word)}</span><span class="aw-pos">${esc(it.pos || "")}</span></div><div class="aw-zh">${esc(it.zh.replace(/\s*[（(].*?[）)]/g, ""))}</div>`);
    layer.appendChild(r);
    return r;
  });
  root.appendChild(layer);
  rows.forEach((r) => {
    const aw = r.querySelector(".aw-word"); aw.style.whiteSpace = "normal"; aw.style.maxWidth = "440px"; aw.style.display = "inline-block";
    fitLines(aw, [80, 70, 60, 52, 46], 2, 1.05);
    const zh = r.querySelector(".aw-zh");
    for (const f of [50, 44, 38]) { zh.style.fontSize = f + "px"; if (zh.scrollHeight <= f * 1.2 * 2 + 4) break; }
  });

  function update(t) {
    layer.style.opacity = fadeWin(t, s.start, s.end, DUR.fade, DUR.fade);
    enter(title, t, s.start, DUR.base, 14);
    rows.forEach((r, i) => {
      const it = s.items[i], ln = spec.lines[it.lines.word], z = spec.lines[it.lines.mean];
      enter(r, t, ln.start - 0.1, DUR.base, 18);
      const speaking = t >= ln.start - 0.05 && t <= z.end + 0.15;
      r.style.borderBottomColor = speaking ? "var(--c-accent)" : "var(--c-border)";
      r.style.borderBottomWidth = speaking ? "6px" : "2px";
    });
  }
  return { update };
}
