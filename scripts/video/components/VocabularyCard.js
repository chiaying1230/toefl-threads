// VocabularyCard: the ONE card used for every taught word (main or not).
// It opens over the dimmed stream and grows as information is revealed, in this order:
//
//   1. the WORD            (arrives from the sentence, see WordHandoff)
//   2. pos · [kk] · MEANING  (when the meaning is spoken)
//   3. a short CONTEXT with the word lit   (when it is spoken)  + its translation if there is room
//
// Information priority when space runs out (never shrink below the floors in tokens.css):
//   word > meaning > pos > context > kk > context translation > level
// so low-priority items are dropped before any text gets smaller.
import { L } from "../layout.js";
import { el, esc, fitWidth, fitLines, rect } from "../core.js";
import { DUR, prog } from "../motion.js";
import { karaoke, marker } from "./KaraokeText.js";
import { zhParts } from "../text-zh.js";

const CARD_TOP = 470;
const MAX_H = L.main.y + L.main.h - CARD_TOP;      // the card never reaches the mascot / subtitle area

export function createVocabularyCard(root, spec, card) {
  const mean = spec.lines[card.lines.mean], ctxLine = spec.lines[card.lines.ctx];
  const { main: zhMain, note: zhNote } = zhParts(card.zh);
  const layer = el("div", "scene");
  const f = el("div", "vc", { top: CARD_TOP + "px" });
  f.innerHTML =
    `<div class="vc-lvl">${esc(card.level)}</div>` +
    `<div class="vc-word"><span class="tk">${esc(card.word)}</span></div>` +
    `<div class="vc-meta">${card.pos ? `<span class="vc-pos">${esc(card.pos)}</span>` : ""}${card.kk ? `<span class="vc-kk">${esc(card.kk)}</span>` : ""}</div>` +
    `<div class="vc-zh">${esc(zhMain)}</div>` + (zhNote ? `<div class="vc-note">${esc(zhNote)}</div>` : "") +
    `<div class="vc-ctxbox"><div class="vc-ctx"></div>${card.ctxZh ? `<div class="vc-ctxzh">${esc(card.ctxZh)}</div>` : ""}</div>`;
  layer.appendChild(f);
  root.appendChild(layer);
  const $ = (c) => f.querySelector("." + c);
  const wordEl = $("vc-word"), wordText = wordEl.firstChild, zhEl = $("vc-zh"), ctxEl = $("vc-ctx"), noteEl = $("vc-note");
  const metaEl = $("vc-meta"), lvlEl = $("vc-lvl"), ctxBox = $("vc-ctxbox"), ctxZhEl = $("vc-ctxzh");
  f.dataset.aud = "card"; wordEl.dataset.aud = "card-word"; zhEl.dataset.aud = "card-zh"; ctxBox.dataset.aud = "card-ctx";
  const kar = karaoke(ctxEl, ctxLine.tokens);

  // ---- fit: wrap long phrases, then drop low-priority information, never go below the floors ----
  let wrapped = false;
  fitWidth(wordEl, 752, [180, 160, 140, 124, 110]);
  if (wordEl.scrollWidth > 753) { wrapped = true; wordEl.style.whiteSpace = "normal"; fitLines(wordEl, [130, 116, 104, 92, 80], 2, 1.04); }
  fitLines(zhEl, [72, 66, 60, 56], 2, 1.16);
  fitLines(ctxEl, [54, 50, 46, 44], 3, 1.36);
  const drops = [() => ctxZhEl && (ctxZhEl.style.display = "none"), () => { const k = $("vc-kk"); if (k) k.style.display = "none"; }, () => { lvlEl.style.display = "none"; }];
  for (const d of drops) { if (f.offsetHeight <= MAX_H) break; d(); }
  Object.assign(wordText.style, marker(1, "var(--c-accent)", ".4em"));

  // heights at each reveal step (frame grows downward; the word slot never moves)
  const N = f.offsetHeight;
  const bottom = (e) => e.offsetTop + e.offsetHeight;
  const bWord = bottom(wordEl), bMean = Math.max(bottom(metaEl), bottom(zhEl), noteEl ? bottom(noteEl) : 0), bCtx = bottom(ctxBox);
  const h = (b) => N - (bCtx - b);
  const H1 = h(bWord + 18), H2 = h(bMean + 6), H3 = N;

  const wordRect = rect(wordText), wordStyle = getComputedStyle(wordText);

  function update(t) {
    const open = Math.min(prog(t, card.start + 0.12, 0.25), 1 - prog(t, card.infoEnd, 0.15));   // clears quickly so it never overlaps the returning text
    layer.style.opacity = open > 0 ? 1 : 0;
    f.style.opacity = open;
    if (open <= 0) return;
    const r2 = prog(t, mean.start - 0.05, DUR.base), r3 = prog(t, ctxLine.start - 0.1, DUR.base), r4 = prog(t, ctxLine.start + 0.5, DUR.base);
    f.style.height = (H1 + (H2 - H1) * r2 + (H3 - H2) * r3) + "px";
    // the card's own word takes over when the travelling word has landed, and hands back before it leaves
    wordText.style.opacity = t >= card.landing && t < card.infoEnd + 0.05 ? 1 : 0;
    for (const e of [lvlEl, metaEl, zhEl, noteEl]) if (e) { e.style.opacity = r2; e.style.transform = `translateY(${(1 - r2) * 14}px)`; }
    ctxBox.style.opacity = r3; ctxBox.style.transform = `translateY(${(1 - r3) * 14}px)`;
    if (ctxZhEl) ctxZhEl.style.opacity = r4;
    kar.update(t);
  }
  return { update, wordRect, wordStyle, wrapped };
}
