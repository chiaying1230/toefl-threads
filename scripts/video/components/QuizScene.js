// QuizScene: one question, three options, a short think time, then the answer.
//
//   context quiz  the post's own sentence with the word blanked out; options are English words.
//                 At the reveal the blank fills in (yellow) and the sentence reads whole again, so it is still the post.
//   meaning quiz  (older episodes) the word, options are Chinese meanings.
//
// The mascot asks (its line is a Subtitle cue). Thin timer bar, no countdown numbers.
import { L } from "../layout.js";
import { el, esc, fitWidth, fitLines } from "../core.js";
import { DUR, fadeWin, enter, prog, ease } from "../motion.js";
import { marker } from "./KaraokeText.js";

const ROW = 136, GAP = 22, MAIN_BOTTOM = L.main.y + L.main.h;

export function createQuizScene(root, spec) {
  const q = spec.scenes.quiz, isCtx = q.type === "context";
  const layer = el("div", "scene");
  let head, blank = null;
  const y0 = L.main.y + 30;

  if (isCtx) {
    head = el("div", "qz-sentence", { top: y0 + "px" });
    head.dataset.aud = "quiz-sentence";
    const parts = q.sentence.split("____");
    head.innerHTML = `${esc(parts[0])}<span class="qz-blank">&nbsp;</span>${esc(parts[1] || "")}`;
    layer.appendChild(head);
    blank = head.querySelector(".qz-blank");
  } else {
    head = el("div", "qz-word", { top: y0 + 10 + "px" }, esc(q.word));
    head.dataset.aud = "quiz-word";
    layer.appendChild(head);
  }
  const hint = !isCtx ? el("div", "qz-hint", {}, "選出正確的意思") : null;
  const timer = el("div", "qz-timer", {}, "<i></i>");
  const opts = q.options.map((text, i) => {
    const r = el("div", "qz-opt", {}, `<div class="qz-badge">${"ABC"[i]}</div><div class="qz-text ${isCtx ? "en" : "zh"}">${esc(text)}</div><div class="qz-check"></div>`);
    r.dataset.aud = "quiz-opt-" + i;
    return r;
  });
  layer.append(...[hint, timer, ...opts].filter(Boolean));
  root.appendChild(layer);

  // layout: heading, then timer, then the three options. Everything must end inside the main zone:
  // shrink the heading (to its floor) first, then tighten the rows.
  head.style.whiteSpace = "normal";
  const sizes = isCtx ? [64, 60, 56, 52, 48] : [150, 130, 112, 96, 80, 68], lh = isCtx ? 1.36 : 1.05, maxLines = isCtx ? 4 : 2;
  let row = ROW, gap = GAP, done = false;
  const place = () => {
    const headBottom = y0 + head.offsetHeight;
    if (hint) hint.style.top = headBottom + 20 + "px";
    const timerTop = headBottom + (hint ? 90 : 48), optTop = timerTop + 44;
    timer.style.top = timerTop + "px";
    opts.forEach((r, i) => { r.style.height = row + "px"; r.style.top = optTop + i * (row + gap) + "px"; });
    return optTop + 3 * row + 2 * gap;
  };
  for (const s of sizes) {
    head.style.fontSize = s + "px";
    if (head.scrollHeight > s * lh * maxLines + 4) continue;
    if (place() <= MAIN_BOTTOM) { done = true; break; }
  }
  if (!done) { row = 116; gap = 14; place(); }
  opts.forEach((r) => fitWidth(r.querySelector(".qz-text"), 560, [64, 58, 52, 48]));

  function update(t) {
    layer.style.opacity = fadeWin(t, q.start, q.end, DUR.fade, DUR.fade);
    enter(head, t, q.start, DUR.base, 16);
    if (hint) enter(hint, t, q.start + 0.1, DUR.base, 12);
    opts.forEach((r, i) => enter(r, t, q.start + 0.2 + i * 0.08, DUR.base, 18));
    // timer drains while the viewer thinks
    const used = prog(t, q.thinkStart, q.revealAt - q.thinkStart, ease.linear);
    timer.style.opacity = t >= q.thinkStart - 0.1 && t < q.revealAt ? 1 : 0;
    timer.firstChild.style.transform = `scaleX(${1 - used})`;
    // reveal
    const rv = prog(t, q.revealAt, DUR.base);
    if (blank) {
      if (rv > 0) { blank.textContent = q.options[q.answer]; Object.assign(blank.style, marker(rv), { borderBottom: "0", minWidth: "0", lineHeight: "inherit", fontWeight: 800 }); }
      else { blank.innerHTML = "&nbsp;"; Object.assign(blank.style, { borderBottom: "", minWidth: "", backgroundImage: "none", fontWeight: "", lineHeight: "" }); }
    }
    opts.forEach((r, i) => {
      const ok = i === q.answer;
      r.style.background = ok && rv > 0 ? "var(--c-accent)" : "var(--c-surface)";
      r.style.borderColor = ok && rv > 0 ? "var(--c-text)" : "var(--c-border)";
      r.querySelector(".qz-check").textContent = ok && rv > 0 ? "✓" : "";
      if (rv > 0 && !ok) r.style.opacity = parseFloat(r.style.opacity || 1) * (1 - 0.65 * rv);
    });
  }
  return { update };
}
