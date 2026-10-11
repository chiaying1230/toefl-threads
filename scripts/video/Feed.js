// Feed: ONE tall column of items and a camera (scroll position) that moves through it.
//
//  - items are laid out top to bottom; at rest each item sits at its own anchor on screen
//  - the gap after an item is chosen so that, at rest, the TOP EDGE OF THE NEXT ITEM peeks in at the bottom
//    of the screen (inside the fade) – the viewer always feels there is more below
//  - the camera moves with a swipe (moves: t0 → t1, to item i). Nothing fades in the middle of the screen;
//    only the viewport's top and bottom edges fade content (CSS mask, styles.css .feed)
//  - the background colour follows the item being scrolled to (paper → dark for the quiz → paper)
import { el, lerp, clamp } from "./core.js";
import { ease } from "./motion.js";

const PEEK_Y = 1490;       // where the next item's top edge shows at rest
const GAP_MIN = 64;
const RGB = { paper: [255, 248, 236], dark: [32, 36, 44] };
const INK = { paper: { t: [35, 31, 28], t2: [123, 112, 103] }, dark: { t: [255, 255, 255], t2: [191, 197, 207] } };
const mix = (a, b, p) => a.map((v, i) => Math.round(lerp(v, b[i], p)));
const css = (c) => `rgb(${c.join(",")})`;

// items: [{ id, api: { el, update(t), height? }, anchor, bg }]   moves: [{ t0, t1, to, extra? }]
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
    y += it.h + Math.max(GAP_MIN, PEEK_Y - (it.anchor + it.h));
  });

  function state(t) {
    let from = items[0].rest, fromIdx = 0, s = { y: from, moving: false, focus: 0, a: items[0].bg, b: items[0].bg, p: 0 };
    for (const m of moves) {
      const target = items[m.to].rest + (m.extra || 0);
      if (t < m.t0) break;
      if (t >= m.t1) { s = { y: target, moving: false, focus: m.to, a: items[m.to].bg, b: items[m.to].bg, p: 0 }; from = target; fromIdx = m.to; continue; }
      const p = ease.inOut(clamp((t - m.t0) / (m.t1 - m.t0), 0, 1));
      s = { y: lerp(from, target, p), moving: true, focus: p > 0.5 ? m.to : fromIdx, a: items[fromIdx].bg, b: items[m.to].bg, p };
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
    items.forEach((it) => it.api.update(t));
    return { moving: s.moving, focus: items[s.focus].id, scrollY: s.y };
  }
  return { update, items };
}
