// Feed items: every piece of the video is an item of the one scrolling feed (Feed.js).
// Each creator returns { el, update(t), layout?(), height? }. Items never fade themselves in or out –
// they are moved by the camera; inside an item only small reveals (rise + fade) happen.
import { el, esc, fitLines, fitWidth } from "../core.js";
import { DUR, prog, enter, ease } from "../motion.js";
import { karaoke, marker } from "./KaraokeText.js";

const HOOK_SIZE = { xl: 108, l: 96, m: 72, s: 54 };
const mark = (spans, tokens, p) => spans.forEach((sp, i) => { if (tokens[i].role === "main" || tokens[i].role === "taught") { Object.assign(sp.style, marker(p)); sp.style.fontWeight = 800; } });

// ---------- HOOK: big content lines, left aligned. The first line is revealed word by word (pattern interrupt) ----------
export function createHook(it) {
  const root = el("div", "hk");
  const beats = it.beats.map((b, i) => {
    const wrap = el("div", "hk-w"), t = el("div", "hk-b" + (b.size === "s" ? " s" : "") + (b.caps ? " caps" : ""), { fontSize: HOOK_SIZE[b.size] + "px" });
    t.dataset.aud = "hook";
    wrap.appendChild(t);
    const k = karaoke(t, b.tokens, { ink: true });
    if (b.big) k.spans[0].classList.add("big");
    let emo = null;
    if (b.emoji) { emo = el("span", "hk-emo", null, b.emoji); t.appendChild(emo); }
    let zh = null;
    if (b.zh) { zh = el("div", "hk-zh", null, esc(b.zh)); zh.dataset.aud = "hook-zh"; wrap.appendChild(zh); }
    wrap.style.marginTop = (i === 0 ? 0 : 26) + "px";
    root.appendChild(wrap);
    return { b, wrap, k, zh, emo, i };
  });
  function update(t) {
    beats.forEach((x) => {
      if (x.i === 0) { x.wrap.style.opacity = 1; x.wrap.style.transform = ""; }
      else enter(x.wrap, t, x.b.start - 0.1, DUR.base, 34);
      x.k.update(t);
      if (x.i === 0) x.k.spans.forEach((sp, j) => { sp.style.opacity = j === 0 ? 1 : prog(t, Math.max(x.b.tokens[j].s - 0.12, 0.4), 0.14); });
      if (x.emo) x.emo.style.opacity = prog(t, x.b.start + 0.35, DUR.fast);
      mark(x.k.spans, x.b.tokens, prog(t, x.b.start + 0.2, DUR.slow));
      if (x.zh) enter(x.zh, t, x.b.start + 0.25, DUR.base, 16);
    });
  }
  return { el: root, update };
}

// ---------- POST: author header + chunks being read (+ translation after each sentence) ----------
const SIZES = [64, 60, 56, 52];
export function createPost(it, spec) {
  const a = spec.char, root = el("div", "pi");
  const head = it.head === "full"
    ? el("div", "pi-head", null, `<div class="pi-av" style="background:${esc(a.color)}">${a.avatar}</div><div><div class="pi-name">${esc(a.name)}</div><div class="pi-meta">@${esc(a.handle)}</div></div>${a.topic ? `<div class="pi-topic">#${esc(a.topic)}</div>` : ""}`)
    : el("div", "pi-head cont", null, `<div class="pi-av" style="background:${esc(a.color)}">${a.avatar}</div><div class="pi-cont">${esc(a.name)} · continued</div>`);
  head.dataset.aud = "post-head";
  root.appendChild(head);
  const blocks = it.chunks.map((c) => {
    const b = el("div", "pi-chunk"); b.dataset.aud = "post";
    root.appendChild(b);
    const k = karaoke(b, spec.lines[c.line].tokens);
    let zh = null;
    if (c.zh) { zh = el("div", "pi-zh", null, esc(c.zh)); zh.dataset.aud = "post-zh"; root.appendChild(zh); }
    return { c, b, k, zh };
  });
  const layout = () => {
    let size = SIZES[SIZES.length - 1];
    for (const s of SIZES) { blocks.forEach((x) => { x.b.style.fontSize = s + "px"; }); if (blocks.every((x) => x.b.scrollHeight <= s * 1.38 * 3 + 4)) { size = s; break; } }
    blocks.forEach((x) => { x.b.style.fontSize = size + "px"; });
  };
  function update(t) {
    blocks.forEach((x) => { x.k.update(t); if (x.zh) enter(x.zh, t, x.c.zhAt, DUR.base, 14); });
  }
  return { el: root, update, layout };
}

// ---------- VOCABULARY CARD: an editorial card inside the feed. Hierarchy: word · meaning · EXAMPLE · example zh · small meta ----------
export function createCard(it, spec) {
  const root = el("div", "vcx"), frame = el("div", "vc");
  const L = spec.lines, wl = L[it.lines.word], ml = L[it.lines.mean], xl = L[it.lines.ex];
  const word = el("div", "vc-word", null, `<span class="wd">${esc(it.word)}</span>`); word.dataset.aud = "card-word";
  const [zhMain, zhNote] = splitZh(it.zh);
  const s1 = el("div", "vc-s1"); const zh = el("div", "vc-zh", null, esc(zhMain)); zh.dataset.aud = "card-zh"; s1.appendChild(zh);
  if (zhNote) s1.appendChild(el("div", "vc-note", null, esc(zhNote)));
  const s2 = el("div", "vc-sec vc-s2");
  s2.appendChild(el("div", "vc-label", null, "EXAMPLE"));
  const ex = el("div", "vc-ex"); ex.dataset.aud = "card-ex"; s2.appendChild(ex);
  const exK = karaoke(ex, xl.tokens, { cur: "var(--c-learn-soft)" });
  if (it.exZh) { const e = el("div", "vc-exzh", null, esc(it.exZh)); e.dataset.aud = "card-exzh"; s2.appendChild(e); }
  const s3 = el("div", "vc-s3");
  s3.appendChild(el("div", "vc-meta", null, `<span class="vc-pos">${esc(it.pos)}</span>${it.kk ? `<span>${esc(it.kk)}</span>` : ""}`));
  let fromSpans = null;
  if (it.from) {
    const w = el("div", "vc-from-wrap");
    w.appendChild(el("div", "vc-label", null, "FROM THIS POST"));
    const f = el("div", "vc-from"); f.dataset.aud = "card-from";
    f.innerHTML = it.from.map((k) => `<span class="tk">${esc(k.text)}</span>`).join(" ");
    w.appendChild(f); s3.appendChild(w);
    fromSpans = [...f.querySelectorAll(".tk")];
  }
  frame.append(word, s1, s2, s3);
  root.appendChild(frame);
  const times = [0, ml.start - 0.05, xl.start - 0.05, xl.end - 0.4];
  const secs = [s1, s2, s3];
  const api = { el: root, height: 0 };
  api.layout = () => {
    fitWidth(word, 768, [150, 136, 124, 112]);
    frame.style.position = "relative";
    api.height = Math.ceil(frame.getBoundingClientRect().height);
    frame.style.position = "absolute";
    root.style.height = api.height + "px"; frame.style.height = api.height + "px";
  };
  api.update = (t) => {
    secs.forEach((s, i) => { const p = prog(t, times[i + 1], DUR.base); s.style.opacity = p; s.style.transform = `translateY(${(1 - p) * 22}px)`; });
    marker1(word.firstChild, prog(t, wl.start, DUR.slow));
    exK.update(t);
    if (fromSpans) fromSpans.forEach((sp, i) => { if (it.from[i].role === "main") { Object.assign(sp.style, marker(prog(t, times[3] + 0.1, DUR.slow))); sp.style.fontWeight = 800; } });
  };
  return api;
}
const marker1 = (sp, p) => Object.assign(sp.style, marker(p, "var(--c-accent)", ".5em"));
function splitZh(zh) {
  const m = zh.match(/^(.*?)\s*[（(]([^）)]*)[）)]\s*$/);
  return m ? [m[1], m[2]] : [zh, ""];
}

// ---------- RECAP: back to the post, the learned words lit ----------
export function createRecap(it, spec) {
  const a = spec.char, root = el("div", "rc");
  const head = el("div", "rc-head", null, `<div class="rc-av" style="background:${esc(a.color)}">${a.avatar}</div><div class="rc-name">${esc(a.name)} · the whole post</div>`);
  head.dataset.aud = "recap-head"; root.appendChild(head);
  const rows = it.lines.map((l) => {
    const d = el("div", "rc-line"); d.dataset.aud = "recap";
    d.innerHTML = l.tokens.map((k) => `<span class="tk">${esc(k.text)}</span>`).join(" ");
    root.appendChild(d);
    return { l, d, spans: [...d.querySelectorAll(".tk")] };
  });
  const note = el("div", "rc-note", null, esc(it.note)); note.dataset.aud = "recap-note"; root.appendChild(note);
  function update(t) {
    rows.forEach((r) => {
      enter(r.d, t, r.l.at, DUR.base, 30);
      r.spans.forEach((sp, i) => { if (r.l.tokens[i].role === "main") { Object.assign(sp.style, marker(prog(t, r.l.at + 0.15, DUR.slow))); sp.style.fontWeight = 800; } });
    });
    enter(note, t, it.noteAt, DUR.base, 20);
  }
  return { el: root, update };
}

// ---------- QUIZ: dark, centered ----------
export function createQuiz(it, spec) {
  const root = el("div", "qd");
  let sentence = null, word = null;
  if (it.kind === "context") {
    sentence = el("div", "qd-s"); sentence.dataset.aud = "quiz-sentence"; root.appendChild(sentence);
  } else {
    word = el("div", "qd-word", null, esc(it.word)); word.dataset.aud = "quiz-word"; root.appendChild(word);
  }
  const timer = el("div", "qd-timer", { margin: "56px 0 12px" }, "<i></i>");
  root.appendChild(timer);
  const bar = timer.firstChild;
  const rows = it.options.map((o, i) => {
    const r = el("div", "qd-opt", null, `<div class="qd-badge">${"ABC"[i]}</div><div class="qd-text ${it.kind === "meaning" ? "zh" : "en"}">${esc(o)}</div><div class="qd-check"></div>`);
    r.dataset.aud = "quiz-option"; root.appendChild(r);
    return r;
  });
  const parts = it.kind === "context" ? it.sentence.split("____") : null;
  const layout = () => {
    if (sentence) {
      sentence.innerHTML = `${esc(parts[0])}<span class="qd-blank"></span>${esc(parts[1])}`;
      fitLines(sentence, [64, 60, 56, 52], 3, 1.36);
    } else fitWidth(word, 780, [150, 130, 110, 96]);
    rows.forEach((r) => fitWidth(r.querySelector(".qd-text"), 560, [64, 58, 52, 48]));
  };
  function update(t) {
    const rv = prog(t, it.revealAt, DUR.base);
    bar.style.transform = `scaleX(${1 - Math.min(1, Math.max(0, (t - it.thinkStart) / (it.revealAt - it.thinkStart)))})`;
    timer.style.opacity = 1 - rv;
    if (sentence) {
      const fill = rv > 0.01;
      sentence.innerHTML = fill
        ? `${esc(parts[0])}<span class="qd-fill" style="background:var(--c-accent);color:#231F1C;border-radius:.2em;padding:0 .18em;opacity:${rv}">${esc(it.options[it.answer])}</span>${esc(parts[1])}`
        : `${esc(parts[0])}<span class="qd-blank"></span>${esc(parts[1])}`;
    }
    rows.forEach((r, i) => {
      const win = i === it.answer;
      r.style.background = win && rv > 0 ? mixCol([45, 50, 61], [255, 214, 107], rv) : "";
      r.style.borderColor = win && rv > 0 ? "var(--c-accent)" : "";
      r.style.color = win && rv > 0.5 ? "#231F1C" : "";
      r.style.opacity = win ? 1 : 1 - 0.55 * rv;
      r.querySelector(".qd-check").textContent = win && rv > 0.5 ? "✓" : "";
    });
  }
  return { el: root, update, layout };
}
const mixCol = (a, b, p) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * p)).join(",")})`;

// ---------- ENDING: what was learned, then the NEXT post already showing below (the video is cut, not finished) ----------
const NEXT_TOP = 760;       // px below the item's anchor where the next post begins (its top ~⅓ is visible)
export function createEnding(it) {
  const root = el("div", "ed");
  const h = el("div", "ed-h", null, `${it.count} WORD${it.count > 1 ? "S" : ""} LEARNED ✓`); h.dataset.aud = "end-h"; root.appendChild(h);
  const ws = el("div", "ed-words");
  const rows = it.words.map((w) => { const r = el("div", "ed-word", null, `<span>${esc(w)}</span><span class="ed-check">✓</span>`); r.dataset.aud = "end-word"; ws.appendChild(r); return r; });
  root.appendChild(ws);
  let url = null;
  if (it.showUrl && it.url) { url = el("div", "ed-url", null, `<span>${esc(it.url)}</span>`); url.dataset.aud = "end-url"; root.appendChild(url); }
  const n = it.next, nx = el("div", "ed-next", { top: NEXT_TOP + "px" },
    `<div class="ed-rule"></div><div class="ed-nl">NEXT POST</div>` +
    `<div class="ed-nrow"><div class="ed-nav" style="background:${esc(n.color)}">${n.avatar}</div><div class="ed-nname">${esc(n.name)}</div></div>` +
    `<div class="ed-ntext">${esc(n.en)}</div>${n.zh ? `<div class="ed-nzh">${esc(n.zh)}</div>` : ""}`);
  root.appendChild(nx);
  root.style.height = NEXT_TOP + 420 + "px";
  function update(t) {
    rows.forEach((r, i) => enter(r, t, it.tickAt[i], DUR.base, 28));
    if (url) enter(url, t, it.tickAt[0] + 0.3, DUR.base, 14);
  }
  return { el: root, update, height: NEXT_TOP + 420 };
}
