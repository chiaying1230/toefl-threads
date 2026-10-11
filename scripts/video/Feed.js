// Feed: ONE tall track of items and a camera (scroll position) that moves along it.
//
//  - items sit one after another with a small, constant gap (GAP): at rest the tail of the previous item is
//    still visible above and the head of the next item already shows below – it is a feed, not a slide deck
//  - the camera moves with a swipe (moves: t0 → t1, to item i). Outgoing and incoming items are on screen together;
//    nothing fades in the middle of the screen, only the viewport's top and bottom edges fade (CSS mask, styles.css .feed)
//  - the item the camera rests on is full strength, its neighbours are dimmed (DIM)
//  - `far: true` on an item puts a big gap after it, so the next item does NOT peek (used around the dark quiz)
//  - the background colour follows the item being scrolled to (paper → dark for the quiz → paper)
import { el, lerp, clamp } from "./core.js";
import { ease } from "./motion.js";

const GAP = 48;
const FAR_Y = 1720;        // with `far`, the next item's top is at least this low at rest
const DIM = 0.5;
const RGB = { paper: [255, 248, 236], dark: [32, 36, 44] };
const INK = { paper: { t: [35, 31, 28], t2: [123, 112, 103] }, dark: { t: [255, 255, 255], t2: [191, 197, 207] } };
const mix = (a, b, p) => a.map((v, i) => Math.round(lerp(v, b[i], p)));
const css = (c) => `rgb(${c.join(",")})`;

// items: [{ id, api: { el, update(t), layout?(), height? }, anchor, bg, far }]   moves: [{ t0, t1, to, extra? }]
export function createFeed(stage, hdr, items, moves) {
  const view = el("div", "feed"), col = el("div", "feed-col");
  view.appendChild(col);
  stage.insertBefore(view, stage.firstChild);
  items.forEach((it) => { it.api.el.classList.add("fi"); col.appendChild(it.api.el); });
  items.forEach((it) => it.api.layout && it.api.layout());
  let y = 0;
  items.forEach((it) => {
    it.h = it.api.height || it.api.el.offsetHeight;
    it.y = y; it.api.el.style.top = y + "px";
    it.rest = y - it.anchor;
    y += it.h + (it.far ? Math.max(GAP, FAR_Y - (it.anchor + it.h)) : GAP);
  });

  function state(t) {
    let from = items[0].rest, fromIdx = 0;
    let s = { y: from, moving: false, focus: 0, from: 0, to: 0, a: items[0].bg, b: items[0].bg, p: 0 };
    for (const m of moves) {
      const target = items[m.to].rest + (m.extra || 0);
      if (t < m.t0) break;
      if (t >= m.t1) { s = { y: target, moving: false, focus: m.to, from: m.to, to: m.to, a: items[m.to].bg, b: items[m.to].bg, p: 0 }; from = target; fromIdx = m.to; continue; }
      const p = ease.inOut(clamp((t - m.t0) / (m.t1 - m.t0), 0, 1));
      s = { y: lerp(from, target, p), moving: true, focus: p > 0.5 ? m.to : fromIdx, from: fromIdx, to: m.to, a: items[fromIdx].bg, b: items[m.to].bg, p };
      break;
    }
    return s;
  }

  const ep = hdr.querySelector(".ep");
  function update(t) {
    const s = state(t);
    col.style.transform = `translateY(${-s.y}px)`;
    stage.style.background = css(mix(RGB[s.a], RGB[s.b], s.p));
    stage.style.color = css(mix(INK[s.a].t, INK[s.b].t, s.p));
    hdr.style.color = css(mix(INK[s.a].t2, INK[s.b].t2, s.p));
    if (ep) ep.style.color = css(mix(INK[s.a].t, INK[s.b].t, s.p));
    items.forEach((it, i) => {
      const w = s.moving ? (s.from === s.to ? (i === s.to ? 1 : 0) : i === s.from ? 1 - s.p : i === s.to ? s.p : 0) : (i === s.focus ? 1 : 0);
      it.api.el.style.opacity = (DIM + (1 - DIM) * w).toFixed(3);
      it.api.update(t);
    });
    return { moving: s.moving, focus: items[s.focus].id, scrollY: s.y };
  }
  return { update, items };
}
