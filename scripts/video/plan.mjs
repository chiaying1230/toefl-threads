// Plan: episode JSON → timeline for the render page.
//
// The video is one continuous read, not a set of pages:
//
//   HOOK → read chunk → (word card) → read chunk → (word card) → … → recap → quiz → ending
//
// The post is cut into chunks (a sentence, or a clause of a long sentence, ≤ ~3 lines of large text).
// A chunk is read aloud; if it contains a taught word, that word is pulled out into its card right after
// the chunk, then the same post carries on. Every taught word gets the same card.
//
// Every spoken line has text, language, a voice and (estimated, or measured from audio) timing.
// All pacing numbers are in PACE, in one place.
import { tokenize, hash, zhSpoken, chunkSentence, isKeyToken, contextFor } from "./text.mjs";
import { DUR } from "./motion.js";

const LEVEL = { 1: "Soy Milk 豆漿", 2: "Tofu 豆腐", 3: "Natto 納豆" };
const CHAR_VOICES = ["en-US-GuyNeural", "en-US-AriaNeural", "en-GB-RyanNeural", "en-AU-NatashaNeural", "en-US-ChristopherNeural", "en-GB-SoniaNeural"];
const pickVoice = (author) => ({ voice: CHAR_VOICES[hash(author) % CHAR_VOICES.length], rate: "+0%", pitch: ["-6Hz", "+0Hz", "+8Hz"][hash(author) % 3] });

export const PACE = {
  hookLead: 0.12, hookTail: 0.4,
  flowLead: 0.2, chunkGap: 0.05,
  cardBeat: 0.06,           // pause between the end of a chunk and its word leaving the text
  wordLead: 0.05,           // the word is spoken while it is still flying to its card
  cardGap: 0.06,            // between word / meaning / context
  cardHold: 0.1, mainHold: 0.4,   // main word's card stays a little longer
  nextOverlap: 0.2,         // the next chunk starts as the stream settles
  recapLead: 0.2, recapRow: 0.5, recapTail: 0.25,
  quizLead: 0.25, quizThink: 1.5, quizTail: 0.4,
  endLead: 0.15, endTail: 0.55,
};

export function buildPlan(ep, { series, voiceFile = () => null, probe = null } = {}) {
  const lines = [], cues = [], beats = [];
  const beat = (t, what) => beats.push({ t: +t.toFixed(2), what });
  const HOST_ZH = { voice: "zh-TW-HsiaoChenNeural", rate: "+5%", pitch: "+0Hz" };
  const HOST_EN = { voice: "en-US-AnaNeural", rate: "-5%", pitch: "+0Hz" };
  const CHAR = pickVoice(ep.author.handle);

  // opts.silent: shown (and lit word by word, fast) but not spoken – no audio, no mouth movement
  const line = (speaker, lang, tokens, voice, opts = {}) => {
    const l = { id: lines.length, speaker: opts.silent ? "silent" : speaker, silent: !!opts.silent, lang, text: tokens.filter((k) => !k.ell).map((k) => k.text).join(lang === "zh" ? "" : " "), tokens, voice, start: 0, end: 0 };
    const f = opts.silent ? null : voiceFile(l.id);
    l.dur = f && probe ? probe(f) + 0.05 : tokens.reduce((s, k) => s + k.w + k.pause, 0) * (opts.silent ? 0.55 : 1) + 0.1;
    lines.push(l);
    return l.id;
  };
  let t = 0;
  // lay lines out one after another starting at t + lead; also gives each word its time
  const place = (ids, lead, gap = 0.12) => {
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
  const role = (k) => (teachSet.has(k) ? "taught" : null);
  const disp = (k) => k.replace(/_/g, " ");

  // ---------------- hook ----------------
  const guide = line("host", "zh", zhTokens(ep.hook.guideZh), HOST_ZH);
  const hookStart = t;
  t = place([guide], PACE.hookLead) + PACE.hookTail;
  const hookTokens = tokenize(ep.hook.text, "en").map((k) => ({ text: k.text, key: k.key, role: k.key === ep.main ? "main" : null }));
  const hook = { start: hookStart, end: t, tokens: hookTokens, lines: [guide] };
  cues.push({ start: lines[guide].start, end: lines[guide].end, variant: "guide", line: lines[guide], withMascot: false });
  beat(0, "hook"); beat(0.35, "hook highlight");

  // ---------------- flow: chunks and cards ----------------
  // 1. chunks of the shown sentences
  const shown = ep.thread.show.map((i) => ep.thread.sentences[i]);
  const chunks = [];
  shown.forEach((s, si) => {
    const gap = si > 0 && ep.thread.show[si] - ep.thread.show[si - 1] > 1;     // skipped part of the post
    chunkSentence(s.en).forEach((raw, ci) => {
      const toks = tokenize(raw, "en").map((k) => ({ ...k, role: role(k.key), sent: si }));
      if (gap && ci === 0) toks.unshift({ text: "…", key: null, role: null, w: 0, pause: 0, ell: true, sent: si });
      chunks.push({ sent: si, tokens: toks, cards: [] });
    });
  });

  // 2. every taught word belongs to the first chunk it appears in (in reading order)
  ep.teach.forEach((key) => {
    const ci = chunks.findIndex((c) => c.tokens.some((k) => k.key === key));
    if (ci >= 0) chunks[ci].cards.push({ key, at: chunks[ci].tokens.findIndex((k) => k.key === key) });
  });
  chunks.forEach((c) => c.cards.sort((a, b) => a.at - b.at));
  const missing = ep.teach.filter((k) => !chunks.some((c) => c.cards.some((x) => x.key === k)));
  if (missing.length) throw new Error(`taught word(s) never appear in the shown sentences: ${missing.join(", ")}`);

  // 3. timeline: read a chunk, then its cards, then the next chunk
  const flowStart = t;
  let cursor = t + PACE.flowLead;
  const cards = [];
  chunks.forEach((c, ci) => {
    c.line = line("char", "en", c.tokens, CHAR);
    t = cursor; place([c.line], 0);
    c.start = +(lines[c.line].start - 0.1).toFixed(3);
    beat(c.start, `chunk ${ci + 1}`);
    c.tokens.forEach((k) => { if (k.key && teachSet.has(k.key)) beat(k.s, `"${k.key}" highlighted`); });
    cursor = lines[c.line].end + PACE.chunkGap;

    c.cards.forEach((cc) => {
      const w = ep.words[cc.key], isMain = cc.key === ep.main, ctx = contextFor(ep, cc.key);
      const wl = line("host", "en", tokenize(disp(cc.key), "en"), { ...HOST_EN, rate: "-15%" });
      const ml = line("host", "zh", zhTokens(zhSpoken(w.zh)), HOST_ZH);
      const ctxTokens = tokenize(ctx.text, "en").map((k) => ({ ...k, role: isKeyToken(k.text, cc.key) ? "main" : null }));
      // the main word's context is read aloud (one extra layer); the others are read by eye – that keeps every card ≈ 3.5 s
      const xl = line("host", "en", ctxTokens, HOST_EN, { silent: !isMain });
      const start = cursor + PACE.cardBeat;
      t = start; place([wl, ml, xl], PACE.wordLead, PACE.cardGap);
      const infoEnd = lines[xl].end + (isMain ? PACE.mainHold : PACE.cardHold);
      const card = {
        key: cc.key, main: isMain, chunk: ci, tokenIndex: cc.at, word: disp(cc.key), pos: w.pos, zh: w.zh, kk: w.kk,
        level: LEVEL[w.level] || "", ctx: ctx.text, ctxZh: ctx.zh, lines: { word: wl, mean: ml, ctx: xl },
        start, landing: start + DUR.lift, infoEnd, end: infoEnd + 0.05 + DUR.settle,
      };
      cards.push(card);
      beat(start, `"${cc.key}" leaves the text`); beat(lines[ml].start, "meaning"); beat(lines[xl].start, "context"); beat(infoEnd, "back to the post");
      cursor = card.end - PACE.nextOverlap;
    });
  });
  const flowEnd = cursor;
  chunks.forEach((c, i) => { c.end = i + 1 < chunks.length ? chunks[i + 1].start : flowEnd; });
  // Chinese for the sentence being read (until its last chunk has been read)
  shown.forEach((s, si) => {
    if (!s.zh) return;
    const mine = chunks.filter((c) => c.sent === si), last = mine[mine.length - 1];
    cues.push({ start: mine[0].start + 0.1, end: lines[last.line].end + 0.1, variant: "translation", text: s.zh, withMascot: false });
  });
  const flow = { start: flowStart, end: flowEnd, chunks, cards };

  // ---------------- recap (silent, ≤ 2 s) ----------------
  // in the order the viewer met the words
  const learned = cards.map((c) => c.key);
  const recapStart = flowEnd;
  const rowGap = learned.length >= 4 ? 0.42 : PACE.recapRow;
  const recap = {
    start: recapStart, end: recapStart + PACE.recapLead + learned.length * rowGap + PACE.recapTail, rowGap,
    items: learned.map((k, i) => ({ word: disp(k), zh: ep.words[k].zh.replace(/\s*[（(].*?[）)]/g, ""), at: recapStart + PACE.recapLead + i * rowGap })),
  };
  t = recap.end;
  beat(recapStart, "recap");

  // ---------------- quiz ----------------
  const q = ep.quiz, qStart = t, askComment = ep.cta.type === "comment", ask = askComment ? ep.cta.text : "";
  const isCtx = q.type === "context";
  const promptText = q.promptZh || (isCtx ? "選哪一個？" : "這個字是什麼意思？") + ask;
  const prompt = line("host", "zh", zhTokens(promptText), HOST_ZH);
  const promptEnd = place([prompt], PACE.quizLead);
  const thinkStart = promptEnd + 0.2, revealAt = thinkStart + PACE.quizThink;
  const letter = "ABC"[q.answer];
  const answerIds = [line("host", "zh", zhTokens(`答案是 ${letter}${isCtx ? "" : "，" + q.options[q.answer]}`), HOST_ZH)];
  t = revealAt - 0.1;
  t = place(answerIds, 0.25, 0.1) + PACE.quizTail;
  const quiz = { start: qStart, end: t, type: isCtx ? "context" : "meaning", sentence: q.sentence || null,
    filled: isCtx ? q.sentence.replace("____", q.options[q.answer]) : null,
    word: disp(ep.main), options: q.options, answer: q.answer, thinkStart, revealAt, lines: { prompt, answer: answerIds } };
  cues.push({ start: lines[prompt].start, end: lines[prompt].end, variant: "mascot", line: lines[prompt], withMascot: true });
  beat(qStart + 0.2, "quiz options"); beat(lines[prompt].start, "quiz question"); beat(thinkStart, "think"); beat(revealAt, "answer");

  // ---------------- ending (content-style, no logo page) ----------------
  const endStart = t;
  const closing = ep.outro.closingZh || ep.outro.teaserZh || (ep.cta.type === "link" ? ep.cta.text : "明天見！");
  const cl = line("host", "zh", zhTokens(closing), HOST_ZH);
  t = place([cl], PACE.endLead) + PACE.endTail;
  const ending = { start: endStart, end: t, words: learned.map(disp), teaserZh: ep.outro.teaserZh || null, showUrl: ep.cta.type === "link", line: cl };
  cues.push({ start: lines[cl].start, end: lines[cl].end, variant: "mascot", line: lines[cl], withMascot: true });
  beat(endStart, "ending");

  // mascot: only from the second half of the last card (its context line) to the end ("think" while the viewer decides)
  // (if the post keeps being read after the last card, it waits until the reading is over: it never shares the screen with the stream)
  const last = cards[cards.length - 1];
  const mascotStart = last.chunk === chunks.length - 1 ? lines[last.lines.ctx].start - 0.2 : recap.start + 0.3;
  const mascot = [{ start: mascotStart, end: thinkStart - 0.1, pose: "talk" },
    { start: thinkStart - 0.1, end: revealAt, pose: "think" },
    { start: revealAt, end: ending.end + 2, pose: "talk" }];

  beats.sort((a, b) => a.t - b.t);
  return {
    id: ep.id, episode: ep.episode, series, pack: ep.pack, duration: +ending.end.toFixed(2),
    char: ep.author, thread: { source: ep.thread.source },
    scenes: { hook, flow, recap, quiz, ending },
    lines: lines.map((l) => ({ ...l, dur: undefined })), cues, mascot, beats,
  };
}
