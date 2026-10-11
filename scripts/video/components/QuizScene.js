// QuizScene: one question, three options, a short think time, then the answer.
// The mascot asks (its line is a Subtitle cue); the screen shows only the word and the options.
import { L } from "../layout.js";
import { el, esc, fitWidth, fitLines } from "../core.js";
import { DUR, fadeWin, enter, prog, ease } from "../motion.js";

export function createQuizScene(root, spec) {
  const q = spec.scenes.quiz;
  const layer = el("div", "scene");
  const y0 = L.main.y + 50;
  const word = el("div", "qz-word", { top: y0 + 10 + "px", fontSize: "132px" }, esc(q.word));
  const hint = el("div", "qz-hint", { top: y0 + 190 + "px" }, "選出正確的意思");
  const timer = el("div", "qz-timer", { top: y0 + 270 + "px" }, "<i></i>");
  layer.append(word, hint, timer);
  const opts = q.options.map((text, i) => {
    const r = el("div", "qz-opt", { top: y0 + 330 + i * 180 + "px" },
      `<div class="qz-badge">${"ABC"[i]}</div><div class="qz-text">${esc(text)}</div><div class="qz-check"></div>`);
    layer.appendChild(r);
    return r;
  });
  root.appendChild(layer);
  fitLines(word, [132, 116, 100, 88, 76, 64], 2, 1.05);   // a long phrase wraps onto two lines
  opts.forEach((r) => fitWidth(r.querySelector(".qz-text"), 560, [56, 50, 44, 38]));

  function update(t) {
    layer.style.opacity = fadeWin(t, q.start, q.end, DUR.fade, DUR.fade);
    enter(word, t, q.start, DUR.base, 16);
    enter(hint, t, q.start + 0.1, DUR.base, 12);
    opts.forEach((r, i) => enter(r, t, q.start + 0.2 + i * 0.08, DUR.base, 18));
    // timer drains while the viewer thinks
    const used = prog(t, q.thinkStart, q.revealAt - q.thinkStart, ease.linear);
    timer.style.opacity = t >= q.thinkStart - 0.1 && t < q.revealAt ? 1 : 0;
    timer.firstChild.style.transform = `scaleX(${1 - used})`;
    // reveal
    const rv = prog(t, q.revealAt, DUR.base);
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
