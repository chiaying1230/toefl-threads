// ThreadScene: the post, cropped to the sentences that matter, read aloud word by word.
//
//   1. the card eases in (replaces the hook text)
//   2. a slow push-in while the author "reads" (no static hold)
//   3. handoff: the camera pushes onto the key word, then the word flies into the
//      VocabularyCard's WORD slot. One continuous move instead of a hard cut to another screen.
//
// No phone chrome, no action buttons, no scrolling: only what is needed to understand the situation.
import { L } from "../layout.js";
import { el, esc, fitFont, lerp, rect, clamp } from "../core.js";
import { DUR, ease, prog } from "../motion.js";
import { karaoke, marker } from "./KaraokeText.js";

const ZOOM = 1.7;                         // camera zoom onto the key word
const FOCUS = { x: 540, y: 700 };         // where the key word sits while zoomed

export function createThreadScene(root, spec, vocab) {
  const th = spec.scenes.thread, line = spec.lines[th.line], a = spec.char;
  const layer = el("div", "scene");
  const card = el("div", "tc");
  card.innerHTML =
    `<div class="tc-head"><div class="tc-av" style="background:${esc(a.color)}">${a.avatar}</div>` +
    `<div><div class="tc-name">${esc(a.name)}</div><div class="tc-meta">@${esc(a.handle)}</div></div>` +
    (a.topic ? `<div class="tc-topic">#${esc(a.topic)}</div>` : "") + `</div>` +
    `<div class="tc-body" id="tc-body"></div>` +
    (spec.thread && spec.thread.source ? `<div class="tc-credit">${esc(spec.thread.source)}</div>` : "");
  layer.appendChild(card);
  root.appendChild(layer);

  const body = card.querySelector("#tc-body");
  const kar = karaoke(body, line.tokens);
  // fit the text so the whole card stays inside the main zone
  const chrome = card.offsetHeight - body.offsetHeight;
  fitFont(body, L.main.h - chrome, [50, 48, 46, 44, 42, 40]);
  const cardH = card.offsetHeight, cardTop = Math.round(L.main.y + (L.main.h - cardH) / 2);
  card.style.top = cardTop + "px";

  const idx = line.tokens.findIndex((k) => k.role === "main");
  const wordSpan = idx >= 0 ? kar.spans[idx] : null;
  const o = { x: L.main.x, y: cardTop }, ctr = { x: o.x + 432, y: o.y + cardH / 2 };
  card.style.transform = "none";
  const wr0 = wordSpan ? rect(wordSpan) : null;
  const wordC0 = wr0 ? { x: wr0.x + wr0.w / 2, y: wr0.y + wr0.h / 2 } : ctr;
  const basePx = wordSpan ? parseFloat(getComputedStyle(wordSpan).fontSize) : 44;

  // clones that fly between the post and the vocabulary card
  const cloneLayer = el("div", "scene");
  cloneLayer.style.opacity = 1;
  const mk = (cls) => { const e = el("div", cls, { position: "absolute", left: "0px", top: "0px", whiteSpace: "nowrap", transformOrigin: "0 0", opacity: 0 }); cloneLayer.appendChild(e); return e; };
  const A = mk("ca"), B = mk("cb");
  root.appendChild(cloneLayer);
  if (wordSpan) {
    A.innerHTML = `<span class="tk">${esc(line.tokens[idx].text)}</span>`;
    Object.assign(A.firstChild.style, marker(1), { fontWeight: 800, color: "var(--c-text)", fontFamily: "var(--font-body)", fontSize: basePx * ZOOM + "px", lineHeight: "1.2", display: "inline-block" });
    B.innerHTML = `<span class="tk">${esc(vocab.wordText.textContent)}</span>`;
    Object.assign(B.firstChild.style, marker(1, "var(--c-accent)", ".4em"), { fontFamily: "var(--font-heading)", fontSize: vocab.wordStyle.fontSize, lineHeight: "1.1", display: "inline-block", color: "var(--c-text)", padding: "0 .06em" });
  }

  const moveStart = th.handoffStart + DUR.handoffZoom;

  function update(t) {
    // entrance / exit of the card
    const inP = prog(t, th.start - 0.1, DUR.base), mv = prog(t, moveStart, DUR.handoffMove, ease.inOut);
    layer.style.opacity = t < th.start - 0.1 || t > th.end + 0.01 ? 0 : inP * (1 - mv);
    kar.update(t);

    // camera: slow push-in, then zoom onto the key word
    const push = prog(t, th.start, th.handoffStart - th.start, ease.out);
    const pz = prog(t, th.handoffStart, DUR.handoffZoom, ease.inOut);
    const s = lerp(lerp(1, 1.035, push), ZOOM, pz);
    const f = { x: lerp(ctr.x, wordC0.x, pz), y: lerp(ctr.y, wordC0.y, pz) };
    const c = { x: lerp(ctr.x, FOCUS.x, pz), y: lerp(ctr.y, FOCUS.y, pz) };
    card.style.transform = `translate(${c.x - o.x - s * (f.x - o.x)}px,${c.y - o.y - s * (f.y - o.y)}px) scale(${s})`;
    card.style.opacity = 1;
    // focus pull: while the camera pushes in, everything but the key word steps back and the card frame dissolves,
    // so the word floats on the paper before it flies into its own card
    card.style.background = `rgba(255,255,255,${1 - pz})`;
    card.style.borderColor = `rgba(234,223,203,${1 - pz})`;
    card.querySelector(".tc-head").style.opacity = 1 - pz;
    kar.spans.forEach((sp, i) => { if (line.tokens[i].role !== "main") sp.style.opacity = 1 - 0.9 * pz; });

    // handoff clones: centre-to-centre, scaled by width so the word grows/shrinks smoothly
    if (!wordSpan || t < moveStart || t > th.end + 0.01) { A.style.opacity = 0; B.style.opacity = 0; if (wordSpan) wordSpan.style.opacity = 1; return; }
    wordSpan.style.opacity = 0;
    const live = rect(wordSpan), er = vocab.wordRect, e = mv;
    const cx = lerp(live.x + live.w / 2, er.x + er.w / 2, e), cy = lerp(live.y + live.h / 2, er.y + er.h / 2, e), w = lerp(live.w, er.w, e);
    const place = (C) => {
      const n = C.firstChild, w0 = n.offsetWidth || 1, h0 = n.offsetHeight || 1, k = w / w0;
      C.style.transform = `translate(${cx - (w0 * k) / 2}px,${cy - (h0 * k) / 2}px) scale(${k})`;
    };
    place(A); place(B);
    const m = clamp((e - 0.15) / 0.55, 0, 1);
    // a wrapped phrase cannot morph into a single-line clone: it just fades out as the card's own word fades in
    A.style.opacity = vocab.wrapped ? 1 - e : 1 - m; B.style.opacity = vocab.wrapped ? 0 : m;
  }
  return { update };
}
