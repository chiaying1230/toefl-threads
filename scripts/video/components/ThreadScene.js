// ThreadScene = the stream: one post that keeps moving up while it is read aloud.
//
//  - the post is cut into chunks (plan.mjs); only ~2–3 lines of large text are "live" at a time
//  - a chunk fades in below, the whole column rises so it sits at the reading line,
//    the chunk before it stays as a dim echo above (the viewer still feels it is the same post)
//  - the author header never re-appears: it is the same container all the way through
//  - while a word card is open the stream steps back (dims) and the taught word is lifted out by WordHandoff
//
// No phone chrome, no buttons, no card per section.
import { el, esc, lerp } from "../core.js";
import { DUR, ease, prog, fadeWin } from "../motion.js";
import { karaoke } from "./KaraokeText.js";

const FOCUS_Y = 500;                 // y (inside the window) where the chunk being read sits
const FIRST_Y = 300;                 // the first chunk starts close to the author header
const SIZES = [64, 60, 56, 52];      // largest that keeps every chunk within 3 lines; never smaller than 52

export function createThreadScene(root, spec) {
  const fl = spec.scenes.flow, a = spec.char;
  const layer = el("div", "scene");
  const head = el("div", "fl-head", null,
    `<div class="fl-av" style="background:${esc(a.color)}">${a.avatar}</div>` +
    `<div><div class="fl-name">${esc(a.name)}</div><div class="fl-meta">@${esc(a.handle)}</div></div>` +
    (a.topic ? `<div class="fl-topic">#${esc(a.topic)}</div>` : ""));
  const win = el("div", "fl-win"), col = el("div", "fl-col");
  win.appendChild(col);
  layer.append(head, win);
  root.appendChild(layer);

  const blocks = fl.chunks.map((c) => {
    const b = el("div", "fl-chunk");
    b.dataset.aud = "flow";
    col.appendChild(b);
    return { b, c, kar: karaoke(b, spec.lines[c.line].tokens) };
  });
  let size = SIZES[SIZES.length - 1];
  for (const s of SIZES) {
    blocks.forEach((x) => { x.b.style.fontSize = s + "px"; });
    if (blocks.every((x) => x.b.scrollHeight <= s * 1.38 * 3 + 4)) { size = s; break; }
  }
  blocks.forEach((x) => { x.b.style.fontSize = size + "px"; });
  // column offset that puts chunk i on the reading line; it only ever moves up (≥ 40 px per chunk)
  const S = [];
  blocks.forEach((x, i) => {
    const ideal = (i === 0 ? FIRST_Y : FOCUS_Y) - (x.b.offsetTop + x.b.offsetHeight / 2);
    S.push(i === 0 ? ideal : Math.min(ideal, S[i - 1] - 40));
  });

  const spanOf = (card) => blocks[card.chunk].kar.spans[card.tokenIndex];

  function update(t) {
    const vis = fadeWin(t, fl.start - 0.1, fl.end + 0.15, DUR.base, DUR.fade);
    layer.style.opacity = vis;
    if (vis <= 0) return;
    let i = 0;
    blocks.forEach((x, k) => { if (t >= x.c.start) i = k; });
    const sP = prog(t, blocks[i].c.start, DUR.scroll);                       // the column rises to the next chunk
    col.style.transform = `translateY(${lerp(i > 0 ? S[i - 1] : S[0] + 70, S[i], sP)}px)`;
    // reading line: current chunk full, the one before as a dim echo, older ones nearly gone
    const O = (j, cur) => (j === cur ? 1 : j === cur - 1 ? 0.3 : j < cur - 1 ? 0.1 : 0);
    blocks.forEach((x, j) => {
      x.b.style.opacity = t < x.c.start ? 0 : j === i ? prog(t, x.c.start, DUR.base) : lerp(O(j, i - 1), O(j, i), sP);
      x.kar.update(t);
    });
    // the stream steps back while a word card is open
    let dim = 0;
    fl.cards.forEach((c) => { dim = Math.max(dim, prog(t, c.start, DUR.dim) * (1 - prog(t, c.infoEnd + 0.14, DUR.dim))); });
    win.style.opacity = head.style.opacity = 1 - 0.88 * dim;
  }
  return { update, spanOf, fontSize: size };
}
