// Cross-validation: every reference an episode JSON makes to narration lines, checked BEFORE any TTS / assembly / render.
//
// The episode refers to narration line ids (story parts, vocabulary open / close / meaningLine / exampleLine, hook reveal, camera,
// visibility, reaction, quiz, sound effects ...). A wrong id used to surface only inside the renderer ("Missing alignment line");
// here every problem is collected at once with the path of the offending field.
//
// "Lines" are the playable units of a narration: a segment, or each part of a split sentence. They can come from the narration
// itself (before generation) or from the assembled plan (before rendering) – both give the same ids in the same order.
import fs from "node:fs";
import path from "node:path";
import { ConfigError, REPO_ROOT } from "./config.mjs";

/** What the renderer (reference/PostTemplate.js + Components.js) can draw today. Anything else fails here, not mid-render. */
export const RENDERER_CONTRACT = {
  storyParts: ["reading", "translation", "vocabulary", "reaction", "illustration"],
  illustrationKinds: ["pen"],
  reactionKinds: ["pen"],
};

const stripWord = (t) => t.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "").toLowerCase();
const tokensOf = (text) => [...String(text).matchAll(/\S+/g)].map((m) => stripWord(m[0])).filter(Boolean);

/** Map id → { id, silent, text, tokens } in playback order, from a prepared narration. */
export function linesFromNarration(prepared) {
  const bySeg = new Map(prepared.segments.map((s) => [s.id, s])), lines = new Map();
  for (const item of prepared.order) {
    const seg = bySeg.get(item.segment);
    if (seg.silent) { lines.set(seg.id, { id: seg.id, silent: true, text: "", tokens: [] }); continue; }
    const part = item.part ? seg.parts.find((p) => p.id === item.part) : null, text = part ? part.text : seg.text;
    lines.set(part ? part.id : seg.id, { id: part ? part.id : seg.id, silent: false, text, tokens: tokensOf(text) });
  }
  return lines;
}

/** Same, from an assembled plan.json. */
export function linesFromPlan(plan) {
  return new Map(plan.lines.map((l) => [l.id, { id: l.id, silent: Boolean(l.silent), text: l.text ?? "", tokens: l.silent ? [] : (l.words?.length ? l.words.map((w) => stripWord(w.text)) : tokensOf(l.text ?? "")) }]));
}

/** The episode whose `plan` is the one assemble.mjs writes for this narration id, or null. */
export function findEpisodeFor(narrationId, episodesDir = path.join(REPO_ROOT, "scripts", "video", "episodes")) {
  const wanted = `/docs/${narrationId}-auto/${narrationId}-auto.plan.json`;
  for (const f of fs.existsSync(episodesDir) ? fs.readdirSync(episodesDir).filter((n) => n.endsWith(".json")) : []) {
    try { if (JSON.parse(fs.readFileSync(path.join(episodesDir, f), "utf8")).plan === wanted) return path.join(episodesDir, f); } catch { /* not an episode */ }
  }
  return null;
}

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const isStr = (v) => typeof v === "string" && v.trim() !== "";

/**
 * @param {object} episode  parsed episode JSON
 * @param {Map} lines       from linesFromNarration / linesFromPlan
 * @returns {string[]}      problems (empty = valid)
 */
export function validateEpisode(episode, lines) {
  const P = [], order = [...lines.keys()], index = (id) => order.indexOf(id);
  const err = (where, msg) => P.push(`${where}: ${msg}`);
  if (!isObj(episode)) return ["episode is not an object"];

  // ---- required shape: everything the renderer dereferences without a guard ----
  const need = (obj, keys, where) => { for (const k of keys) if (obj?.[k] === undefined || obj[k] === null || obj[k] === "") err(`${where}.${k}`, "is required"); };
  need(episode, ["id", "plan", "audio", "brand", "episodeLabel", "author", "social", "outside", "vocabulary", "hook", "story", "camera", "scrollDuration", "visibility", "quiz", "status"], "episode");
  if (!isObj(episode.hook) || !isObj(episode.quiz) || !isObj(episode.status) || !isObj(episode.author) || !Array.isArray(episode.story) || !Array.isArray(episode.vocabulary)) return P;
  need(episode.author, ["avatar", "name", "meta", "level"], "author");
  need(episode.hook, ["id", "label", "number", "caption", "ratio", "payoff", "emoji", "zh", "reveal", "revealDuration"], "hook");
  need(episode.quiz, ["id", "meta", "quote", "question", "options", "answer", "questionLine", "answerLine", "feedback", "feedbackDetail"], "quiz");
  need(episode.status, ["reading", "question", "answer", "readingPhase", "thinkingPhase", "answerPhase"], "status");
  if (!Array.isArray(episode.hook.payoff)) err("hook.payoff", "must be an array of text lines");
  if (!Array.isArray(episode.quiz.options) || episode.quiz.options.length < 2) err("quiz.options", "needs at least 2 options");
  else if (!Number.isInteger(episode.quiz.answer) || episode.quiz.answer < 0 || episode.quiz.answer >= episode.quiz.options.length) err("quiz.answer", `must be an index into quiz.options (0–${episode.quiz.options.length - 1})`);
  if (!Array.isArray(episode.quiz.quote)) err("quiz.quote", "must be an array of text lines");
  if (!Array.isArray(episode.camera) || !episode.camera.length) err("camera", "needs at least one entry");
  if (!Array.isArray(episode.visibility)) err("visibility", "must be an array");

  // ---- references to narration lines ----
  const line = (id, where, { spoken = false } = {}) => {
    if (!isStr(id)) { err(where, "line id is missing"); return null; }
    const l = lines.get(id);
    if (!l) { err(where, `unknown narration line "${id}" (known: ${order.join(", ")})`); return null; }
    if (spoken && l.silent) { err(where, `line "${id}" is silent, but this reference needs spoken narration`); return null; }
    return l;
  };
  const word = (l, w, where) => { if (l && !l.silent && isStr(w) && !l.tokens.includes(stripWord(w))) err(where, `word "${w}" is not in line "${l.id}" ("${l.text}")`); };
  const ref = (r, where) => {
    if (typeof r === "number") { if (!(r >= 0)) err(where, "time must be >= 0"); return; }
    if (r === "planEnd") return;
    if (!isObj(r)) { err(where, `time reference must be a number, "planEnd" or { line, word?, edge?, delay? } (got ${JSON.stringify(r)})`); return; }
    const l = line(r.line, `${where}.line`);
    if (r.word !== undefined) word(l, r.word, `${where}.word`);
    if (r.edge !== undefined && !["start", "end"].includes(r.edge)) err(`${where}.edge`, 'must be "start" or "end"');
    if (r.delay !== undefined && typeof r.delay !== "number") err(`${where}.delay`, "must be a number of seconds");
  };

  const shown = new Map(); // line id -> where it is displayed (a line may be shown once)
  const show = (id, where) => { if (shown.has(id)) err(where, `line "${id}" is already displayed at ${shown.get(id)}`); else shown.set(id, where); };
  const domIds = new Map();
  const dom = (id, where) => { if (!isStr(id)) { err(where, "id is missing"); return; } if (domIds.has(id)) err(where, `id "${id}" is already used at ${domIds.get(id)} (ids become DOM ids and must be unique)`); else domIds.set(id, where); };

  dom(episode.hook.id, "hook.id"); dom(episode.quiz.id, "quiz.id"); if (episode.outro) dom(episode.outro.id, "outro.id");

  // vocabulary entries
  const vocab = new Map();
  episode.vocabulary.forEach((v, i) => {
    const at = `vocabulary[${i}]${v?.id ? ` (${v.id})` : ""}`;
    if (!isObj(v)) { err(at, "is not an object"); return; }
    need(v, ["id", "word", "zh", "pos", "meaningLine", "exampleLine", "exampleZh", "open", "close", "openDuration", "closeDuration"], at);
    if (isStr(v.id)) { dom(v.id, `${at}.id`); vocab.set(v.id, v); }
    if (v.forms !== undefined && !(Array.isArray(v.forms) && v.forms.every(isStr))) err(`${at}.forms`, "must be an array of strings");
    const open = isObj(v.open) ? line(v.open.line, `${at}.open.line`, { spoken: true }) : null;
    if (open) word(open, v.open.word, `${at}.open.word`); else if (!isObj(v.open)) err(`${at}.open`, "must be { line, word }");
    if (isObj(v.open) && !isStr(v.open.word)) err(`${at}.open.word`, "is required");
    const meaning = line(v.meaningLine, `${at}.meaningLine`, { spoken: true }), example = line(v.exampleLine, `${at}.exampleLine`, { spoken: true });
    const close = isObj(v.close) ? line(v.close.line, `${at}.close.line`) : null;
    if (isStr(v.meaningLine) && meaning) show(v.meaningLine, `${at}.meaningLine`);
    if (isStr(v.exampleLine) && example) show(v.exampleLine, `${at}.exampleLine`);
    if (open && meaning && example && close && !(index(open.id) <= index(meaning.id) && index(meaning.id) < index(example.id) && index(example.id) < index(close.id))) {
      err(at, `narration order must be open → meaning → example → close, but it is ${[open, meaning, example, close].map((l) => `${l.id}@${index(l.id)}`).join(", ")}`);
    }
  });

  // story
  const blocks = new Set(), usedVocab = new Set();
  episode.story.forEach((b, i) => {
    const at = `story[${i}]${b?.id ? ` (${b.id})` : ""}`;
    if (!isObj(b) || !Array.isArray(b.parts)) { err(at, "needs an id and a parts array"); return; }
    if (isStr(b.id)) { dom(b.id, `${at}.id`); blocks.add(b.id); } else err(`${at}.id`, "is missing");
    b.parts.forEach((p, k) => {
      const w = `${at}.parts[${k}]`;
      if (!isObj(p) || !RENDERER_CONTRACT.storyParts.includes(p.type)) { err(w, `unsupported part type "${p?.type}" (renderer supports: ${RENDERER_CONTRACT.storyParts.join(", ")})`); return; }
      if (p.type === "reading") { if (line(p.line, `${w}.line`, { spoken: true })) show(p.line, `${w}.line`); }
      else if (p.type === "translation") { if (!isStr(p.text)) err(`${w}.text`, "is missing"); }
      else if (p.type === "vocabulary") { if (!vocab.has(p.id)) err(`${w}.id`, `unknown vocabulary "${p.id}"`); else if (usedVocab.has(p.id)) err(`${w}.id`, `vocabulary "${p.id}" is placed twice`); else usedVocab.add(p.id); }
      else if (p.type === "illustration") { if (!RENDERER_CONTRACT.illustrationKinds.includes(p.kind)) err(`${w}.kind`, `unsupported illustration "${p.kind}" (renderer supports: ${RENDERER_CONTRACT.illustrationKinds.join(", ")})`); dom(p.id, `${w}.id`); }
      else if (p.type === "reaction") { if (!isStr(p.text)) err(`${w}.text`, "is missing"); dom(p.id, `${w}.id`); }
    });
  });
  for (const id of vocab.keys()) if (!usedVocab.has(id)) err("story", `vocabulary "${id}" is defined but never placed in the story`);

  // hook, quiz, reaction, outro
  const hookLine = isObj(episode.hook.reveal) ? line(episode.hook.reveal.line, "hook.reveal.line", { spoken: true }) : null;
  if (hookLine) { word(hookLine, episode.hook.reveal.word, "hook.reveal.word"); if (!shown.has(hookLine.id)) shown.set(hookLine.id, "hook.reveal.line"); }
  else if (!isObj(episode.hook.reveal)) err("hook.reveal", "must be { line, word }");
  const q = line(episode.quiz.questionLine, "quiz.questionLine"), a = line(episode.quiz.answerLine, "quiz.answerLine");
  if (q) show(q.id, "quiz.questionLine"); if (a) show(a.id, "quiz.answerLine");
  if (q && a && index(q.id) >= index(a.id)) err("quiz", `questionLine "${q.id}" must come before answerLine "${a.id}"`);
  if (episode.reaction) {
    const r = episode.reaction;
    if (!RENDERER_CONTRACT.reactionKinds.includes(r.kind)) err("reaction.kind", `unsupported reaction "${r.kind}" (renderer supports: ${RENDERER_CONTRACT.reactionKinds.join(", ")})`);
    word(line(r.line, "reaction.line", { spoken: true }), r.word, "reaction.word");
    for (const k of ["id", "captionId"]) if (!domIds.has(r[k])) err(`reaction.${k}`, `"${r[k]}" is not the id of an illustration / reaction part in the story`);
    if (r.captionAt !== undefined) ref(r.captionAt, "reaction.captionAt");
  }
  if (episode.outro) {
    ref(episode.outro.start, "outro.start");
    if (!Array.isArray(episode.outro.words) || !episode.outro.words.length || !episode.outro.words.every((w) => isStr(w?.en) && isStr(w?.zh))) err("outro.words", "needs at least one { en, zh }");
    need(episode.outro, ["duration", "scrollDuration", "offset", "author", "lead", "cta", "brandLine", "status", "phase"], "outro");
  }

  // camera / visibility / effects
  const scrollTargets = new Set([...blocks, episode.hook.id, episode.quiz.id, ...(episode.outro ? [episode.outro.id] : [])]);
  (episode.camera ?? []).forEach((c, i) => { ref(c.at, `camera[${i}].at`); if (!scrollTargets.has(c.id)) err(`camera[${i}].id`, `"${c.id}" is not a block, hook, quiz or outro id`); if (typeof c.offset !== "number") err(`camera[${i}].offset`, "must be a number"); });
  (episode.visibility ?? []).forEach((v, i) => { ref(v.at, `visibility[${i}].at`); if (!scrollTargets.has(v.id)) err(`visibility[${i}].id`, `"${v.id}" is not a block, hook, quiz or outro id`); });
  (episode.soundEffects ?? []).forEach((e, i) => ref(e.at, `soundEffects[${i}].at`));
  if (episode.music?.riseAt !== undefined) ref(episode.music.riseAt, "music.riseAt");

  for (const reserved of ["stage", "thread", "view", "status", "phase", "window", "brand"]) if (domIds.has(reserved)) err(domIds.get(reserved), `"${reserved}" is reserved by the template`);

  // narrated but never shown: audio with nothing on screen
  for (const l of lines.values()) if (!l.silent && !shown.has(l.id)) err(`narration line "${l.id}"`, "is spoken but the episode never displays or uses it (story reading, vocabulary meaning / example, hook reveal or quiz)");
  return P;
}

export function assertEpisode(episode, lines, label = "episode") {
  const problems = validateEpisode(episode, lines);
  if (problems.length) throw new ConfigError(problems.map((p) => `${label}: ${p}`));
}
