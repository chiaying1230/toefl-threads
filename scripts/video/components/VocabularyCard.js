// VocabularyCard: the main word, as a fixed, self-contained module (never a shrunken app page).
//
//   [ level chip ]                         [ pos ]
//   WORD  (serif, yellow marker)
//   [kk phonetic]
//   中文意思  (big, bold)  （補充說明 small）
//   ───────────────
//   EXAMPLE
//   example sentence (karaoke)
//   例句中文
//
// Entrance: the thread's key word flies into the WORD slot (see ThreadScene) while the card fades in.
// Reveal order follows the narration: word → meaning → example → example translation.
import { el, esc, fitWidth, fitLines, rect } from "../core.js";
import { DUR, fadeWin, prog, enter } from "../motion.js";
import { karaoke, marker } from "./KaraokeText.js";

const NOTE = /^(.*?)\s*[（(]([^）)]*)[）)]\s*$/;

export function createVocabularyCard(root, spec) {
  const w = spec.scenes.word, th = spec.scenes.thread;
  const mean = spec.lines[w.lines.mean], exLine = spec.lines[w.lines.ex];
  const layer = el("div", "scene");
  const m = w.zh.match(NOTE), zhMain = m ? m[1] : w.zh, zhNote = m ? m[2] : "";
  const card = el("div", "vc", { top: "372px" });
  card.innerHTML =
    `<div class="vc-top"><span class="chip dark" id="vc-level">${esc(w.level)}</span><span class="chip" id="vc-pos">${esc(w.pos || "")}</span></div>` +
    `<div class="vc-word" id="vc-word"><span class="tk" id="vc-wordtext">${esc(w.word)}</span></div>` +
    `<div class="vc-sub" id="vc-kk">${esc(w.kk || "")}</div>` +
    `<div class="vc-zh" id="vc-zh">${esc(zhMain)}</div>` +
    (zhNote ? `<div class="vc-note" id="vc-note">${esc(zhNote)}</div>` : "") +
    `<div id="vc-lower"><div class="vc-rule"></div><div class="vc-label">EXAMPLE · 例句</div><div class="vc-ex" id="vc-ex"></div><div class="vc-exzh" id="vc-exzh">${esc(w.exZh || "")}</div></div>`;
  layer.appendChild(card);
  root.appendChild(layer);
  const $ = (id) => card.querySelector("#" + id);
  if (!w.pos) $("vc-pos").style.display = "none";
  if (!w.kk) $("vc-kk").style.display = "none";

  // fit: word on one line; meaning ≤ 2 lines; example ≤ 3 lines
  const wordEl = $("vc-word"), wordText = $("vc-wordtext");
  fitWidth(wordEl, 752, [168, 150, 132, 116, 100, 88]);
  let wrapped = false;
  if (wordEl.scrollWidth > 753) {          // a phrase that cannot fit on one line: wrap it onto two
    wrapped = true; wordEl.style.whiteSpace = "normal";
    fitLines(wordEl, [116, 104, 92, 80, 70, 60], 2, 1.04);
  }
  Object.assign(wordText.style, marker(1, "var(--c-accent)", ".4em"));
  const zhEl = $("vc-zh");
  fitLines(zhEl, [76, 68, 60, 54, 48, 44], 2, 1.16);
  const k = karaoke($("vc-ex"), exLine.tokens);
  const exEl = $("vc-ex");
  fitLines(exEl, [46, 42, 38, 35, 32], 3, 1.38);
  // keep the whole card inside the main zone: trade example size for height if needed
  const exZhEl = $("vc-exzh");
  for (const s of [38, 34, 30]) { if (card.offsetHeight <= 900) break; exZhEl.style.fontSize = s + "px"; }

  const wordRect = rect(wordText);   // where the key word must land (card is un-transformed here)
  const wordStyle = getComputedStyle(wordText);
  const appearAt = th.handoffStart + DUR.handoffZoom, landAt = w.start;

  function update(t) {
    const a = fadeWin(t, appearAt, w.end, DUR.handoffMove, DUR.fade);
    layer.style.opacity = a;
    if (a <= 0) return;
    // the word itself is drawn by ThreadScene's clone until it lands
    wordText.style.opacity = wrapped ? prog(t, landAt - 0.2, DUR.fast) : (t >= landAt ? 1 : 0);
    enter($("vc-level"), t, landAt + 0.0, DUR.fast, 10);
    enter($("vc-pos"), t, landAt + 0.05, DUR.fast, 10);
    enter($("vc-kk"), t, landAt + 0.12, DUR.fast, 10);
    enter(zhEl, t, mean.start - 0.05, DUR.base, 18);
    const nt = $("vc-note"); if (nt) enter(nt, t, mean.start + 0.1, DUR.base, 12);
    const low = $("vc-lower"); low.style.opacity = prog(t, exLine.start - 0.25, DUR.base);
    low.style.transform = `translateY(${(1 - prog(t, exLine.start - 0.25, DUR.base)) * 18}px)`;
    $("vc-exzh").style.opacity = prog(t, exLine.start + 0.4, DUR.base);
    k.update(t);
  }
  return { update, wordRect, wordText, wordStyle, wrapped };
}
