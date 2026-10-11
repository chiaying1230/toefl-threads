// Episode data: read a thread from the app, turn it into an editable episode JSON, validate it.
//
// An episode file is self-contained (copy, word data, quiz) – rendering does not need the app.
// `init` only drafts it; every field can be edited by hand afterwards.
import fs from "node:fs";
import { MARK, keysIn, wordCount, splitEn, splitZh, zhParts, hash, plain } from "./text.mjs";

// ---------- read from the running app (Playwright page on the repo's index.html) ----------
export async function readApp(page, postId) {
  await page.addScriptTag({ url: "/js/data/quiz-questions.js" });
  return page.evaluate(async (id) => {
    let post = window.POSTS.find((p) => p.id === id), pack = null;
    if (!post) { // threads of the other word lists load on demand from js/data/packs/<id>.js
      const ids = (window.PACK_META || []).map((p) => p.id);
      await new Promise((res) => window.Core.loadPacks(ids, res));
      for (const k of ids) { post = ((window.PACK_POSTS || {})[k] || []).find((p) => p.id === id); if (post) { pack = k; break; } }
    }
    if (!post) return null;
    const vocab = {}, kk = {}, bank = {};
    const banked = {}; (window.QUIZ_QUESTIONS || []).forEach((q) => { banked[q[0]] = q; });
    post.text.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, (m, k) => { vocab[k] = window.VOCAB[k]; kk[k] = (window.KK || {})[k] || ""; if (banked[k]) bank[k] = banked[k]; });
    const meta = (window.PACK_META || []).find((p) => p.id === (pack || "toefl"));
    const pool = Object.entries(window.VOCAB).map(([k, v]) => [k, v.pos, v.level, v.zh]);
    return { post, vocab, kk, bank, pool, pack, packLabel: meta ? meta.zh : "托福", char: window.CHARACTERS[post.author] };
  }, postId);
}

const first = (zh) => zhParts(zh).main.split(/[；;]/)[0].trim();
const shuffle = (arr, seed) => arr.map((x) => [hash(seed + x), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);

function makeQuiz(app, main, seed) {
  const v = app.vocab[main], e = app.bank[main];
  let correct, wrong;
  if (e) { correct = e[5]; wrong = [e[6], e[7]]; }
  else {
    correct = first(v.zh);
    const inPost = new Set(Object.keys(app.vocab));
    const cands = app.pool.filter(([k, pos, lv, zh]) => k !== main && !inPost.has(k) && pos === v.pos && zh && first(zh) !== correct && first(zh).length <= 8)
      .sort((a, b) => (Math.abs(a[2] - v.level) - Math.abs(b[2] - v.level)) || (hash(seed + a[0]) - hash(seed + b[0])));
    wrong = []; for (const c of cands) { const z = first(c[3]); if (!wrong.includes(z)) wrong.push(z); if (wrong.length === 2) break; }
  }
  const options = shuffle([correct, ...wrong], seed);
  return { options, answer: options.indexOf(correct), promptZh: null };
}

// ---------- draft an episode from a thread ----------
export function draftEpisode(app, { episode = null, main = null } = {}) {
  const { post, vocab, kk, char } = app;
  const en = splitEn(post.text), zhS = splitZh(post.zh), aligned = en.length === zhS.length;
  const sentences = en.map((s, i) => ({ en: s, zh: aligned ? zhS[i] : null }));
  const order = keysIn(post.text);
  const hardest = order.reduce((b, k) => (vocab[k].level > vocab[b].level ? k : b), order[0]);
  const mainKey = main || hardest;

  // excerpt: the main word's sentence; other words only if their sentence still fits; skipped sentences become "…"
  const wc = en.map(wordCount), sk = en.map(keysIn);
  const total = (set) => [...set].reduce((a, i) => a + wc[i], 0);
  const mi = sk.findIndex((ks) => ks.includes(mainKey));
  const need = new Set([mi]);
  for (const k of order) {
    if (k === mainKey) continue;
    const si = sk.findIndex((ks) => ks.includes(k));
    if (si >= 0 && total(new Set([...need, si])) <= 34) need.add(si);
  }
  while (total(need) < 14) {            // too short to be a situation: add a neighbour of the main sentence
    const lo = Math.min(...need), hi = Math.max(...need);
    if (lo > 0 && total(new Set([...need, lo - 1])) <= 34) need.add(lo - 1);
    else if (hi < en.length - 1 && total(new Set([...need, hi + 1])) <= 34) need.add(hi + 1);
    else break;
  }
  const show = [...need].sort((x, y) => x - y);
  const visible = keysIn(show.map((i) => en[i]).join(" "));
  const teach = [mainKey, ...visible.filter((k) => k !== mainKey)].slice(0, 4);

  // hook: the sentence with the main word; a long one is cut to the clause around it
  let hookText = show.map((i) => en[i]).find((s) => keysIn(s).includes(mainKey));
  if (wordCount(hookText) > 16) {
    const clause = hookText.split(/(?<=[,;:])\s+|\s+[—–]\s+/).find((c) => keysIn(c).includes(mainKey) && wordCount(c) >= 3);
    if (clause) hookText = "… " + clause.replace(/^[,;:\s]+|[,;:\s]+$/g, "");
  }

  const words = {};
  teach.forEach((k) => { const v = vocab[k]; words[k] = { pos: v.pos || "", zh: v.zh, level: v.level, ex: v.ex, exZh: v.exZh, kk: kk[k] || "" }; });

  return {
    id: post.id, episode, pack: app.pack || "toefl", packLabel: app.packLabel,
    author: { name: char.name, handle: char.handle, avatar: char.avatar, color: char.color, topic: post.topic },
    thread: { postId: post.id, sentences, show, source: null },
    main: mainKey, teach, words,
    hook: { text: hookText, guideZh: "這句英文你看得懂嗎？" },
    quiz: makeQuiz(app, mainKey, post.id + mainKey),
    cta: { type: "comment", text: "留言你的答案" },
    outro: { closingZh: null, teaserZh: null },
  };
}

export function loadEpisode(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }

// Returns { errors, warnings } – errors stop the render.
export function validateEpisode(ep) {
  const errors = [], warnings = [];
  const ex = ep.thread.show.map((i) => ep.thread.sentences[i]);
  if (!ex.length || ex.some((x) => !x)) errors.push("thread.show must list valid sentence numbers, e.g. [0, 2]");
  const shown = keysIn(ex.map((s) => s.en).join(" "));
  if (!ep.words[ep.main]) errors.push(`main word "${ep.main}" has no entry in words`);
  for (const k of ep.teach) {
    if (!ep.words[k]) errors.push(`teach word "${k}" has no entry in words`);
    else if (!shown.includes(k)) errors.push(`"${k}" is taught but not visible in the excerpt (add its sentence number to thread.show, or remove it from teach)`);
  }
  if (ep.teach[0] !== ep.main) errors.push("teach[0] must be the main word");
  if (ep.quiz.options.length !== 3) errors.push("quiz needs exactly 3 options");
  if (!(ep.quiz.answer >= 0 && ep.quiz.answer < ep.quiz.options.length)) errors.push("quiz.answer must be 0, 1 or 2");
  if (!keysIn(ep.hook.text).includes(ep.main) && !plain(ep.hook.text).toLowerCase().includes(ep.main.toLowerCase().replace(/_/g, " "))) warnings.push("hook.text does not contain the main word (wrap it as [[word]])");
  if (ex.some((s) => !s.zh)) warnings.push("some excerpt sentences have no Chinese (zh): translation subtitles will be skipped");
  for (const k of ep.teach) { const w = ep.words[k]; if (w && !w.kk) warnings.push(`"${k}" has no kk phonetic: it will not be shown`); if (w && !w.ex) errors.push(`"${k}" has no example sentence`); }
  const hasLink = ep.cta.type === "link";
  if (ep.cta.type !== "comment" && !hasLink) warnings.push(`cta.type "${ep.cta.type}" is unknown (use "comment" or "link")`);
  return { errors, warnings };
}
