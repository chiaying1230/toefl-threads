// WordHandoff: the taught word is pulled out of the sentence, lands on its card, and later goes back.
//
//   lift    [card.start → card.landing]       the word leaves the stream and flies to the card's WORD slot
//   (the card's own word is shown while the card is open)
//   settle  [card.infoEnd → card.end]         the word flies back to its place in the stream
//
// To the eye it is the same word travelling: a stream-style clone (A) cross-fades into a card-style clone (B)
// while both move centre-to-centre and scale by width.
// A phrase that wraps over two lines cannot travel: it stays in the (dimmed) stream and the card simply opens.
import { el, esc, lerp, rect, clamp } from "../core.js";
import { DUR, ease, prog } from "../motion.js";
import { marker } from "./KaraokeText.js";

export function createHandoff(root, stream, vc, card) {
  const layer = el("div", "scene");
  layer.style.opacity = 1;
  const mk = () => { const e = el("div", "", { position: "absolute", left: "0px", top: "0px", whiteSpace: "nowrap", transformOrigin: "0 0", opacity: 0 }); layer.appendChild(e); return e; };
  const A = mk(), B = mk();
  root.appendChild(layer);

  const span = stream.spanOf(card);
  const multiLine = span.getClientRects().length > 1;
  const travels = !multiLine && !vc.wrapped;
  A.innerHTML = `<span class="tk">${esc(card.word)}</span>`;
  B.innerHTML = `<span class="tk">${esc(card.word)}</span>`;
  Object.assign(A.firstChild.style, marker(1), { fontFamily: "var(--font-body)", fontWeight: 800, color: "var(--c-text)", fontSize: stream.fontSize + "px", lineHeight: "1.2", display: "inline-block" });
  Object.assign(B.firstChild.style, marker(1, "var(--c-accent)", ".4em"), { fontFamily: "var(--font-heading)", color: "var(--c-text)", fontSize: vc.wordStyle.fontSize, lineHeight: "1.1", display: "inline-block", padding: "0 .06em" });

  function place(C, cx, cy, w) {
    const n = C.firstChild, w0 = n.offsetWidth || 1, h0 = n.offsetHeight || 1, k = w / w0;
    C.style.transform = `translate(${cx - (w0 * k) / 2}px,${cy - (h0 * k) / 2}px) scale(${k})`;
  }

  function update(t) {
    const flying = travels && ((t >= card.start && t <= card.landing) || (t >= card.infoEnd + 0.05 && t <= card.end));
    // while the word is away its slot in the sentence is empty
    span.style.visibility = travels && t >= card.start && t < card.end ? "hidden" : "visible";
    if (!flying) { A.style.opacity = 0; B.style.opacity = 0; return; }
    const out = t <= card.landing;                                       // lifting out, or settling back
    const e = out ? prog(t, card.start, DUR.lift, ease.inOut) : 1 - prog(t, card.infoEnd + 0.05, DUR.settle, ease.inOut);
    const live = rect(span), to = vc.wordRect;
    const cx = lerp(live.x + live.w / 2, to.x + to.w / 2, e), cy = lerp(live.y + live.h / 2, to.y + to.h / 2, e), w = lerp(live.w, to.w, e);
    place(A, cx, cy, w); place(B, cx, cy, w);
    const m = clamp((e - 0.15) / 0.55, 0, 1);
    A.style.opacity = 1 - m; B.style.opacity = m;
  }
  return { update };
}
