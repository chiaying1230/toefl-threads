// Plan: episode JSON → a feed timeline for the render page.
//
// The video is ONE vertical feed that the camera scrolls through:
//
//   HOOK ↑ POST ↑ WORD CARD ↑ POST (continued) ↑ WORD CARD ↑ RECAP ↑ QUIZ (dark) ↑ ENDING (+ the next post peeking in)
//
// Items are laid out top to bottom (Feed.js); `moves` are the camera swipes. A word card is an item of the
// feed like any other: the post scrolls away, the card slides in from below, then the post carries on below it.
// The post is cut into chunks (a sentence, or a clause of a long sentence, ≤ ~3 lines of large text).
//
// Every spoken line has text, language, a voice and (estimated, or measured from audio) timing.
// All pacing numbers are in PACE, in one place.
import { tokenize, hash, zhSpoken, chunkSentence, isKeyToken, contextFor, keysIn, wordCount } from "./text.mjs";
import { DUR } from "./motion.js";

const LEVEL = { 1: "Soy Milk 豆漿", 2: "Tofu 豆腐", 3: "Natto 納豆" };
const CHAR_VOICES = ["en-US-GuyNeural", "en-US-AriaNeural", "en-GB-RyanNeural", "en-AU-NatashaNeural", "en-US-ChristopherNeural", "en-GB-SoniaNeural"];
const pickVoice = (author) => ({ voice: CHAR_VOICES[hash(author) % CHAR_VOICES.length], rate: "+0%", pitch: ["-6Hz", "+0Hz", "+8Hz"][hash(author) % 3] });

export const PACE = {
  hookLead: 0.05, beatGap: 0.04, hookTail: 0.12, hookSpeed: 0.6,   // the hook is read a little faster
  readLead: 0.3,            // reading starts while the post is still sliding in
  chunkGap: 0.04, readHold: 0.1,
  cardLead: 0.25,           // the word is spoken while the card is still sliding in
  cardGap: 0.05, cardHold: 0.2, mainHold: 0.3,
  recapRow: 0.3, recapRead: 0.5,
  quizLead: 0.4, quizThink: 1.2, quizTail: 0.4,
  endLead: 0.4, endTail: 0.5, endHold: 1.3,
};

export function buildPlan(ep, { series, voiceFile = () => null, probe = null } = {}) {
  const lines = [], cues = [], beats = [];
  const beat = (t, what) => beats.push({ t: +t.toFixed(2), what });
  const HOST_ZH = { voice: "zh-TW-HsiaoChenNeural", rate: "+5%", pitch: "+0Hz" };
  const HOST_EN = { voice: "en-US-AnaNeural", rate: "-5%", pitch: "+0Hz" };
  const CHAR = pickVoice(ep.author.handle);

  // opts.silent: shown but not spoken (no audio, no mouth movement). opts.speed < 1: spoken a little faster.
  const line = (speaker, lang, tokens, voice, opts = {}) => {
    const l = { id: lines.length, speaker: opts.silent ? "silent" : speaker, silent: !!opts.silent, lang, text: tokens.filter((k) => !k.ell).map((k) => k.text).join(lang === "zh" ? "" : " "), tokens, voice: opts.speed && !opts.silent ? { ...voice, rate: "+12%" } : voice, start: 0, end: 0 };
    const f = opts.silent ? null : voiceFile(l.id);
    l.dur = f && probe ? probe(f) + 0.05 : tokens.reduce((s, k) => s + k.w + k.pause, 0) * (opts.speed || 1) + 0.1;
    lines.push(l);
    return l.id;
  };
  let t = 0;
  const place = (ids, lead, gap = 0.12) => {          // lay lines out one after another from t + lead
    let c = t + lead;
    for (const id of ids) {
      const l = lines[id];
      l.start = +c.toFixed(3); l.end = +(c + l.dur).toFixed(3);
      const total = l.tokens.reduce((s, k) => s + k.w + k.pause, 0) || 1, scale = (l.dur - 0.1) / total;
      let x = l.start;
      for (const k of l.tokens) { k.s = +x.toFixed(3); x += k.w * scale; k.e = +x.toFixed(3); x += k.pause * scale; }
      c = l.end + gap;
    }
    return lines[ids[ids.length - 1]].end;
  };
  const zhTokens = (s) => tokenize(s, "zh");
  const teachSet = new Set(ep.teach);
  const disp = (k) => k.replace(/_/g, " ");

  const items = [], moves = [], SW = DUR.swipe;
  const add = (it) => { items.push(it); return items.length - 1; };
  const swipeTo = (idx, t0, extra) => { moves.push({ t0, t1: t0 + SW, to: idx, ...(extra ? { extra } : {}) }); beat(t0, `scroll → ${items[idx].type}`); };

  // ---------------- hook: content lines, the first part of the feed ----------------
  const beatsSrc = ep.hook.beats || [{ en: ep.hook.text, size: "xl", zh: ep.hook.guideZh }];
  const hookIdsArr = [];
  const hookIds_prev = () => hookIdsArr[hookIdsArr.length - 1];
  const hookIds = beatsSrc.map((b, i) => {
    const toks = tokenize(b.en, "en"); toks.forEach((k) => { k.role = k.key === ep.main ? "main" : null; });
    const silent = !!b.silent || b.size === "s";                   // small lines are display-only
    const id = line("char", "en", toks, CHAR, { silent, speed: silent ? 0.5 : PACE.hookSpeed });
    t = i === 0 ? 0 : t;
    if (silent && i > 0) {                                        // a small display-only line appears with the line before it
      const prev = lines[hookIds_prev()];
      t = prev.start; place([id], 0.6); t = Math.max(t, prev.end);
    } else { place([id], i === 0 ? PACE.hookLead : PACE.beatGap); t = lines[id].end; }
    beat(lines[id].start, `hook line ${i + 1}`);
    hookIdsArr.push(id);
    return id;
  });
  const hookEnd = t + PACE.hookTail;
  add({ type: "hook", id: "hook", bg: "paper", anchor: 400,
    beats: beatsSrc.map((b, i) => ({ size: b.size || "xl", zh: b.zh || null, big: !!b.big, caps: !!b.caps, emoji: b.emoji || null, tokens: lines[hookIds[i]].tokens, start: lines[hookIds[i]].start })) });

  // ---------------- chunks → parts (a part ends where a word card is due) ----------------
  const shown = ep.thread.show.map((i) => ep.thread.sentences[i]);
  const chunks = [];
  shown.forEach((s, si) => {
    const gap = si > 0 && ep.thread.show[si] - ep.thread.show[si - 1] > 1;     // skipped part of the post
    chunkSentence(s.en).forEach((raw, ci) => {
      const toks = tokenize(raw, "en").map((k) => ({ ...k, role: teachSet.has(k.key) ? "taught" : null, sent: si }));
      if (gap && ci === 0 && ep.thread.ellipsis) toks.unshift({ text: "…", key: null, role: null, w: 0, pause: 0, ell: true, sent: si });
      chunks.push({ sent: si, tokens: toks, cards: [] });
    });
  });
  ep.teach.forEach((key) => {                                       // each taught word belongs to the first chunk it appears in
    const ci = chunks.findIndex((c) => c.tokens.some((k) => k.key === key));
    if (ci >= 0) chunks[ci].cards.push({ key, at: chunks[ci].tokens.findIndex((k) => k.key === key) });
  });
  chunks.forEach((c) => c.cards.sort((a, b) => a.at - b.at));
  const missing = ep.teach.filter((k) => !chunks.some((c) => c.cards.some((x) => x.key === k)));
  if (missing.length) throw new Error(`taught word(s) never appear in the shown sentences: ${missing.join(", ")}`);
  const lastOfSentence = {}; chunks.forEach((c) => { lastOfSentence[c.sent] = c; });

  const parts = []; let cur = [];
  chunks.forEach((c) => { cur.push(c); if (c.cards.length) { parts.push({ chunks: cur, cards: c.cards }); cur = []; } });
  if (cur.length) parts.push({ chunks: cur, cards: [] });

  // ---------------- the feed: post part → card → post (continued) → card … ----------------
  t = hookEnd;
  const cards = [];
  parts.forEach((part, pi) => {
    const post = { type: "post", id: `post${pi}`, bg: "paper", anchor: 460, head: pi === 0 ? "full" : "continued", chunks: [] };
    const idx = add(post);
    swipeTo(idx, t);
    let rt = t + PACE.readLead;
    part.chunks.forEach((c) => {
      c.line = line("char", "en", c.tokens, CHAR);
      t = rt; place([c.line], 0); rt = lines[c.line].end + PACE.chunkGap;
      const zh = lastOfSentence[c.sent] === c ? shown[c.sent].zh : null;
      post.chunks.push({ line: c.line, zh, zhAt: zh ? lines[c.line].end + 0.15 : 0 });
      beat(lines[c.line].start, "reading");
      c.tokens.forEach((k) => { if (k.key && teachSet.has(k.key)) beat(k.s, `"${k.key}" highlighted`); });
    });
    t = lines[part.chunks[part.chunks.length - 1].line].end + PACE.readHold;

    part.cards.forEach((cc) => {
      const w = ep.words[cc.key], isMain = cc.key === ep.main, from = contextFor(ep, cc.key);
      const exTokens = tokenize(w.ex, "en").map((k) => ({ ...k, role: isKeyToken(k.text, cc.key) ? "main" : null }));
      const fromTokens = from ? tokenize(from.text, "en").map((k) => ({ text: k.text, role: isKeyToken(k.text, cc.key) ? "main" : null })) : null;
      const wl = line("host", "en", tokenize(disp(cc.key), "en"), { ...HOST_EN, rate: "-15%" });
      const ml = line("host", "zh", zhTokens(zhSpoken(w.zh)), HOST_ZH);
      const xl = line("host", "en", exTokens, HOST_EN);
      const t0 = t;
      const item = { type: "card", id: `card${cards.length}`, bg: "paper", anchor: 490, key: cc.key, main: isMain, word: disp(cc.key), pos: w.pos, zh: w.zh, kk: w.kk,
        level: LEVEL[w.level] || "", exZh: w.exZh || null, from: fromTokens, lines: { word: wl, mean: ml, ex: xl } };
      swipeTo(add(item), t0);
      t = t0 + PACE.cardLead; place([wl, ml, xl], 0, PACE.cardGap);
      item.end = lines[xl].end + (isMain ? PACE.mainHold : PACE.cardHold);
      cards.push(item);
      beat(lines[wl].start, `"${cc.key}" card`); beat(lines[ml].start, "meaning"); beat(lines[xl].start, "example");
      t = item.end;
    });
  });

  // ---------------- recap: back to the post, the learned words lit ----------------
  // hand-written `recap: ["I decided to [[allocate]] …", …]` or the shown sentences (lead-in label removed, long ones cut to the clause)
  const stripLead = (x) => x.replace(/^[^.!?:\[\]]{1,28}:\s+/, "");
  const recapSrc = ep.recap && ep.recap.length ? ep.recap : shown.flatMap((sn) => {
    const txt = stripLead(sn.en);
    return wordCount(txt) <= 18 ? [txt] : chunkSentence(sn.en).filter((c) => keysIn(c).some((k) => teachSet.has(k)));
  });
  const recapLines = recapSrc.map((x) => tokenize(x, "en").map((k) => ({ text: k.text, role: teachSet.has(k.key) ? "main" : null })));
  const recapIdx = add({ type: "recap", id: "recap", bg: "paper", anchor: 470, far: true, lines: [], note: ep.recapNote || "Now you can read the whole post." });
  const recap = items[recapIdx], rest = t + SW;
  swipeTo(recapIdx, t);
  recapLines.forEach((tokens, i) => recap.lines.push({ tokens, at: rest + 0.1 + i * PACE.recapRow }));
  recap.noteAt = rest + 0.1 + recapLines.length * PACE.recapRow;
  t = recap.noteAt + PACE.recapRead;
  beat(rest, "recap");

  // ---------------- quiz: a dark item ----------------
  const q = ep.quiz, askComment = ep.cta.type === "comment", ask = askComment ? ep.cta.text : "";
  const isCtx = q.type === "context";
  const prompt = line("host", "zh", zhTokens(q.promptZh || (isCtx ? "選哪一個？" : "這個字是什麼意思？") + ask), HOST_ZH);
  const quiz = { type: "quiz", id: "quiz", bg: "dark", anchor: 400, far: true, kind: isCtx ? "context" : "meaning", sentence: q.sentence || null,
    filled: isCtx ? q.sentence.replace("____", q.options[q.answer]) : null, word: disp(ep.main), options: q.options, answer: q.answer };
  const quizIdx = add(quiz), q0 = t;
  swipeTo(quizIdx, q0);
  t = q0; const promptEnd = place([prompt], PACE.quizLead);
  quiz.thinkStart = promptEnd + 0.2; quiz.revealAt = quiz.thinkStart + PACE.quizThink;
  const answer = line("host", "zh", zhTokens(`答案是 ${"ABC"[q.answer]}${isCtx ? "" : "，" + q.options[q.answer]}`), HOST_ZH);
  t = quiz.revealAt - 0.1; t = place([answer], 0.25, 0.1) + PACE.quizTail;
  quiz.lines = { prompt, answer: [answer] };
  cues.push({ start: lines[prompt].start, end: lines[prompt].end, variant: "mascot", line: lines[prompt], withMascot: true });
  beat(q0 + SW, "quiz"); beat(lines[prompt].start, "quiz question"); beat(quiz.thinkStart, "think"); beat(quiz.revealAt, "answer");

  // ---------------- ending: what was learned; the NEXT post is already showing below ----------------
  const learned = cards.map((c) => c.key);
  const e0 = t, nx = (ep.outro && ep.outro.next) || {};
  const next = { name: nx.name || ep.author.name, avatar: nx.avatar || ep.author.avatar, color: nx.color || ep.author.color,
    en: nx.en || ep.outro.teaserEn || "Another post is waiting for you…", zh: nx.zh || ep.outro.teaserZh || null };
  const tickAt = learned.map((_, i) => e0 + SW + 0.15 + i * 0.2);
  const ending = { type: "ending", id: "ending", bg: "paper", anchor: 500, count: learned.length, words: learned.map(disp),
    showUrl: ep.cta.type === "link", url: series && series.url, tickAt, next };
  const endIdx = add(ending);
  swipeTo(endIdx, e0);
  ending.end = tickAt[tickAt.length - 1] + 0.2 + PACE.endHold;
  const closing = ep.outro.closingZh || (ep.cta.type === "link" ? ep.cta.text : null);       // spoken only: the bottom belongs to the next post
  if (closing) { const cl = line("host", "zh", zhTokens(closing), HOST_ZH); t = e0; place([cl], PACE.endLead); ending.end = Math.max(ending.end, lines[cl].end + PACE.endTail); }
  moves.push({ t0: ending.end - 0.9, t1: ending.end, to: endIdx, extra: 70 });      // a last slow drift: the next post is right there
  beat(e0 + SW, "ending (next post visible)");

  const mascot = [{ start: q0 + 0.2, end: quiz.thinkStart - 0.1, pose: "talk" },
    { start: quiz.thinkStart - 0.1, end: quiz.revealAt, pose: "think" },
    { start: quiz.revealAt, end: e0 + 0.25, pose: "talk" }];

  beats.sort((a, b) => a.t - b.t);
  return {
    id: ep.id, episode: ep.episode, series, pack: ep.pack, duration: +ending.end.toFixed(2),
    char: ep.author, thread: { source: ep.thread.source },
    scenes: { feed: { items, moves } },
    lines: lines.map((l) => ({ ...l, dur: undefined })), cues, mascot, beats,
  };
}
