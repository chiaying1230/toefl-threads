// Plan: episode JSON → timeline for the render page.
//
// Every spoken line gets text, language, a voice and (estimated, or measured from audio) timing.
// Scenes are laid out one after another:
//   hook → thread (read aloud, then the handoff) → word card → also-words → quiz (think time, answer) → outro
// All pacing numbers are here, in one place.
import { tokenize, hash, zhSpoken, zhParts, plain } from "./text.mjs";

const LEVEL = { 1: "Soy Milk 豆漿", 2: "Tofu 豆腐", 3: "Natto 納豆" };
const CHAR_VOICES = ["en-US-GuyNeural", "en-US-AriaNeural", "en-GB-RyanNeural", "en-AU-NatashaNeural", "en-US-ChristopherNeural", "en-GB-SoniaNeural"];
const pickVoice = (author) => ({ voice: CHAR_VOICES[hash(author) % CHAR_VOICES.length], rate: "+0%", pitch: ["-6Hz", "+0Hz", "+8Hz"][hash(author) % 3] });

export const PACE = {
  hookLead: 0.15, hookTail: 0.45,
  threadLead: 0.45, threadHold: 0.25,        // pause after the last word before the handoff
  handoff: 0.9,                              // = DUR.handoffZoom + DUR.handoffMove (motion.js)
  wordLead: 0.35, wordGap: 0.2, wordTail: 0.7,
  alsoLead: 0.3, alsoGap: 0.12, alsoItemGap: 0.28, alsoTail: 0.5,
  quizLead: 0.35, quizThink: 2.2, quizTail: 0.7,
  outroLead: 0.3, outroTail: 0.9,
};

export function buildPlan(ep, { series, voiceFile = () => null, probe = null } = {}) {
  const lines = [], cues = [];
  const HOST_ZH = { voice: "zh-TW-HsiaoChenNeural", rate: "+5%", pitch: "+0Hz" };
  const HOST_EN = { voice: "en-US-AnaNeural", rate: "-5%", pitch: "+0Hz" };
  const CHAR = pickVoice(ep.author.handle);

  const line = (speaker, lang, tokens, voice) => {
    const l = { id: lines.length, speaker, lang, text: tokens.filter((k) => !k.ell).map((k) => k.text).join(lang === "zh" ? "" : " "), tokens, voice, start: 0, end: 0 };
    const f = voiceFile(l.id);
    l.dur = f && probe ? probe(f) + 0.05 : tokens.reduce((s, k) => s + k.w + k.pause, 0) + 0.1;
    lines.push(l);
    return l.id;
  };
  let t = 0;
  const place = (ids, lead, gap = 0.15) => {
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
  const role = (k) => (k === ep.main ? "main" : ep.teach.includes(k) ? "also" : null);

  // ---- hook ----
  const guide = line("host", "zh", zhTokens(ep.hook.guideZh), HOST_ZH);
  const hookStart = t;
  const gEnd = place([guide], PACE.hookLead);
  t = gEnd + PACE.hookTail;
  const hookTokens = tokenize(ep.hook.text, "en").map((k) => ({ text: k.text, key: k.key, role: k.key === ep.main ? "main" : null }));
  const hook = { start: hookStart, end: t, tokens: hookTokens, lines: [guide] };
  cues.push({ start: lines[guide].start, end: lines[guide].end, variant: "guide", line: lines[guide], withMascot: false });

  // ---- thread (excerpt read aloud by the author) ----
  const sents = ep.thread.show.map((i) => ep.thread.sentences[i]);
  const tTokens = [];
  sents.forEach((s, si) => {
    // a skipped stretch of the post is shown as "…" (displayed, not spoken)
    if (si > 0 && ep.thread.show[si] - ep.thread.show[si - 1] > 1) tTokens.push({ text: "…", key: null, role: null, w: 0, pause: 0, ell: true, sent: si });
    tokenize(s.en, "en").forEach((k) => tTokens.push({ ...k, role: role(k.key), sent: si }));
  });
  const thLine = line("char", "en", tTokens, CHAR);
  const thStart = t;
  const thEnd = place([thLine], PACE.threadLead);
  const handoffStart = thEnd + PACE.threadHold;
  t = handoffStart + PACE.handoff;
  const thread = { start: thStart, end: t, line: thLine, handoffStart, main: ep.main };
  // Chinese for the sentence being read
  sents.forEach((s, si) => {
    if (!s.zh) return;
    const toks = lines[thLine].tokens.filter((k) => k.sent === si);
    const next = lines[thLine].tokens.find((k) => k.sent === si + 1);
    cues.push({ start: toks[0].s, end: next ? next.s : handoffStart, variant: "translation", text: s.zh, withMascot: false });
  });

  // ---- main word card ----
  const mw = ep.words[ep.main], wStart = t;
  const wIds = [line("host", "en", tokenize(ep.main.replace(/_/g, " "), "en"), { ...HOST_EN, rate: "-15%" }),
    line("host", "zh", zhTokens(zhSpoken(mw.zh)), HOST_ZH),
    line("host", "en", tokenize(mw.ex, "en"), HOST_EN)];
  t = place(wIds, PACE.wordLead, PACE.wordGap) + PACE.wordTail;
  const word = { start: wStart, end: t, key: ep.main, word: ep.main.replace(/_/g, " "), pos: mw.pos, zh: mw.zh, kk: mw.kk, level: LEVEL[mw.level] || "", exZh: mw.exZh,
    lines: { word: wIds[0], mean: wIds[1], ex: wIds[2] } };

  // ---- other words of the same post ----
  const others = ep.teach.filter((k) => k !== ep.main);
  let also = null;
  if (others.length) {
    const aStart = t; let c = t + PACE.alsoLead; const items = [];
    others.forEach((k) => {
      const w = ep.words[k];
      const a = line("host", "en", tokenize(k.replace(/_/g, " "), "en"), { ...HOST_EN, rate: "-10%" });
      const b = line("host", "zh", zhTokens(zhSpoken(w.zh)), HOST_ZH);
      t = c;                                   // place() starts at t + lead
      c = place([a, b], 0, PACE.alsoGap) + PACE.alsoItemGap;
      items.push({ key: k, word: k.replace(/_/g, " "), pos: w.pos, zh: w.zh, lines: { word: a, mean: b } });
    });
    t = c - PACE.alsoItemGap + PACE.alsoTail;
    also = { start: aStart, end: t, items };
  }

  // ---- quiz ----
  const q = ep.quiz, qStart = t;
  const askComment = ep.cta.type === "comment";
  const prompt = line("host", "zh", zhTokens(q.promptZh || ("這個字是什麼意思？" + (askComment ? ep.cta.text : ""))), HOST_ZH);
  const promptEnd = place([prompt], PACE.quizLead);
  const thinkStart = promptEnd + 0.25, revealAt = thinkStart + PACE.quizThink;
  const answer = line("host", "zh", zhTokens(`答案是 ${"ABC"[q.answer]}，${q.options[q.answer]}`), HOST_ZH);
  t = revealAt - 0.15;                         // so the answer starts 0.15 s after the reveal
  t = place([answer], 0.3) + PACE.quizTail;
  const quiz = { start: qStart, end: t, word: ep.main.replace(/_/g, " "), options: q.options, answer: q.answer, thinkStart, revealAt, lines: { prompt, answer } };
  cues.push({ start: lines[prompt].start, end: lines[prompt].end, variant: "mascot", line: lines[prompt], withMascot: true });
  cues.push({ start: lines[answer].start, end: lines[answer].end, variant: "mascot", line: lines[answer], withMascot: true });

  // ---- outro ----
  const oStart = t;
  const closing = ep.outro.closingZh || ep.outro.teaserZh || (ep.cta.type === "link" ? ep.cta.text : "明天見！");
  const clId = line("host", "zh", zhTokens(closing), HOST_ZH);
  t = place([clId], PACE.outroLead) + PACE.outroTail;
  const outro = { start: oStart, end: t, showUrl: ep.cta.type === "link", line: clId };
  cues.push({ start: lines[clId].start, end: lines[clId].end, variant: "mascot", line: lines[clId], withMascot: true });

  // mascot: on from the word card to the end; "think" while the viewer decides
  const mascot = [{ start: word.start, end: quiz.thinkStart - 0.1, pose: "talk" },
    { start: quiz.thinkStart - 0.1, end: quiz.revealAt, pose: "think" },
    { start: quiz.revealAt, end: outro.end + 2, pose: "talk" }];

  return {
    id: ep.id, episode: ep.episode, series, pack: ep.pack, duration: +outro.end.toFixed(2),
    char: ep.author, thread: { source: ep.thread.source },
    scenes: { hook, thread, word, also, quiz, outro },
    lines: lines.map((l) => ({ ...l, dur: undefined })), cues, mascot,
  };
}
