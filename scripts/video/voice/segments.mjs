// Narration file → validated segments with a deterministic cache hash each.
//
// A narration file lists the segments of one episode in order:
//   { id, kind, text, speak?, gap?, continuesFrom?, silent?, duration? }
// `kind` selects the voice through voices.json `roles` (story/example → arthur, meaning → ling).
// `speak` (optional) is what is sent to the TTS when it must differ from the displayed `text`
// (e.g. "90%" shown, "ninety percent" spoken). Alignment word positions refer to the SPOKEN text.
// `continuesFrom: "<earlier id>"` marks a sentence split around a vocabulary note: the two halves are
// sent with each other's text as previous_text / next_text so the intonation carries across.
// `parts` (optional, spoken segments only) marks a sentence that a vocabulary note interrupts. The WHOLE sentence is
// one TTS unit (one API call, one hash); `parts: [{ id, through: "<last word>", gap }, { id, resumeAfter, gap }]` only says where the
// audio is cut afterwards (see split.mjs), so the halves keep the intonation of one continuing sentence. Every part after
// the first says where the story resumes: `resumeAfter: "<id of the last inserted segment>"` (the meaning / example in
// between are ordinary segments listed after it). Part ids
// are the ids the episode refers to (open.line / close.line ...). Changing `through` or a part gap never regenerates audio.
// A `silent` segment (e.g. a quiz prompt shown on screen only) is never sent to the API; it needs a duration.
//
// Everything here is validated before any network request; all problems are reported together.
import crypto from "node:crypto";
import fs from "node:fs";
import { ConfigError, assertReady } from "./config.mjs";

export const HASH_VERSION = 1; // bump to invalidate every cached segment on purpose

export function loadNarration(file) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch { throw new ConfigError(`cannot read narration file: ${file}`); }
  try { return JSON.parse(raw); } catch (e) { throw new ConfigError(`narration file is not valid JSON (${file}): ${e.message}`); }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]));
  return value;
}

const stripWord = (t) => t.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "").toLowerCase();

/** Split `text` into the parts a narration segment declares. Returns { parts, problems }. */
export function layoutParts(seg) {
  const problems = [], at = `${seg.id}.parts`;
  const tokens = [...seg.text.matchAll(/\S+/g)].map((m) => ({ from: m.index, to: m.index + m[0].length, word: stripWord(m[0]) }));
  const list = seg.parts;
  if (!Array.isArray(list) || list.length < 2) return { parts: [], problems: [`${at} must be an array of at least 2 parts`] };
  let cursor = 0;
  const parts = [];
  list.forEach((p, i) => {
    const last = i === list.length - 1;
    if (!p || typeof p.id !== "string" || !p.id) { problems.push(`${at}[${i}]: id is missing`); return; }
    if (p.gap !== undefined && !(typeof p.gap === "number" && p.gap >= 0)) problems.push(`${at}[${i}] (${p.id}): gap must be a number >= 0`);
    if (p.cut !== undefined && (i === 0 || p.cut !== "late")) problems.push(`${at}[${i}] (${p.id}): "cut" is only valid as "late" on a resuming part (the cut before it is made after the previous word's release, see split.mjs)`);
    if (i > 0 && (typeof p.resumeAfter !== "string" || !p.resumeAfter)) problems.push(`${at}[${i}] (${p.id}): "resumeAfter" (the segment this part plays after) is required`);
    if (i === 0 && p.resumeAfter !== undefined) problems.push(`${at}[${i}] (${p.id}): the first part plays at the segment's own position; remove "resumeAfter"`);
    let endToken = tokens.length - 1;
    if (last) { if (p.through !== undefined) problems.push(`${at}[${i}] (${p.id}): the last part must not have "through"`); }
    else if (typeof p.through !== "string" || !p.through.trim()) { problems.push(`${at}[${i}] (${p.id}): "through" (the part's last word) is required`); return; }
    else {
      const want = stripWord(p.through);
      endToken = tokens.findIndex((t, k) => k >= cursor && t.word === want);
      if (endToken < 0) { problems.push(`${at}[${i}] (${p.id}): word "${p.through}" not found after the previous part`); return; }
      if (endToken >= tokens.length - 1) { problems.push(`${at}[${i}] (${p.id}): "${p.through}" is the last word of the sentence, so nothing interrupts it`); return; }
    }
    if (cursor > endToken) { problems.push(`${at}[${i}] (${p.id}): empty part`); return; }
    parts.push({ id: p.id, resumeAfter: p.resumeAfter ?? null, gap: p.gap ?? 0, ...(p.cut ? { cut: p.cut } : {}), tokenFrom: cursor, tokenTo: endToken, charFrom: tokens[cursor].from, charTo: tokens[endToken].to, text: seg.text.slice(tokens[cursor].from, tokens[endToken].to) });
    cursor = endToken + 1;
  });
  return { parts, problems };
}

/** Everything that changes the audio is in here; nothing visual or timing-related (gap, duration, display text) is. */
export function segmentHash({ voice, speak, previousText, nextText, outputFormat }) {
  const input = stable({
    v: HASH_VERSION,
    provider: "elevenlabs",
    voiceId: voice.voiceId,
    model: voice.model,
    settings: voice.settings || {},
    languageCode: voice.languageCode ?? null,
    outputFormat,
    text: speak,
    previousText: previousText ?? null,
    nextText: nextText ?? null,
  });
  return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32);
}

/**
 * @returns {{ id: string, outputFormat: string, apiBase: string, segments: object[] }}
 *   each spoken segment: { id, kind, role, voiceName, voice, lang, text, speak, previousText, nextText, gap, hash, chars }
 *   each silent segment: { id, kind, silent: true, duration, gap }
 */
export function prepareNarration(narration, cfg, { env = process.env, requireApiKey = true } = {}) {
  const problems = [];
  if (!narration || typeof narration !== "object") throw new ConfigError("narration file is empty");
  if (typeof narration.id !== "string" || !narration.id) problems.push("narration.id is missing");
  const list = Array.isArray(narration.segments) ? narration.segments : null;
  if (!list || !list.length) problems.push("narration.segments must be a non-empty array");
  if (problems.length) throw new ConfigError(problems);

  const ids = new Set(), byId = new Map();
  list.forEach((s, i) => {
    const at = `segments[${i}]${s && s.id ? ` (${s.id})` : ""}`;
    if (!s || typeof s !== "object") { problems.push(`${at} is not an object`); return; }
    if (typeof s.id !== "string" || !s.id) problems.push(`${at}: id is missing`);
    else if (ids.has(s.id)) problems.push(`${at}: duplicate id`);
    else { ids.add(s.id); byId.set(s.id, { s, i }); }
    if (typeof s.kind !== "string" || !s.kind) problems.push(`${at}: kind is missing`);
    if (s.gap !== undefined && !(typeof s.gap === "number" && s.gap >= 0)) problems.push(`${at}: gap must be a number >= 0`);
    if (s.silent) {
      if (!(typeof s.duration === "number" && s.duration > 0)) problems.push(`${at}: a silent segment needs duration > 0`);
    } else {
      if (typeof s.text !== "string" || !s.text.trim()) problems.push(`${at}: text is missing`);
      if (s.speak !== undefined && (typeof s.speak !== "string" || !s.speak.trim())) problems.push(`${at}: speak must be a non-empty string`);
      if (s.parts !== undefined) {
        if (s.speak !== undefined) problems.push(`${at}: a segment with parts cannot use speak (part text is cut from text)`);
        else if (typeof s.text === "string" && s.text.trim()) {
          const { parts, problems: pp } = layoutParts({ ...s, text: s.text.trim() });
          problems.push(...pp);
          if (s.continuesFrom !== undefined) problems.push(`${at}: use parts or continuesFrom, not both`);
          for (const p of parts) { if (ids.has(p.id) || byId.has(p.id)) problems.push(`${at}: part id "${p.id}" collides with another id`); ids.add(p.id); }
        }
      }
    }
  });
  const spoken = list.filter((s) => s && !s.silent && typeof s.kind === "string");
  for (const s of list) {
    if (!s || s.continuesFrom === undefined) continue;
    const prev = byId.get(s.continuesFrom);
    if (!prev) problems.push(`${s.id}: continuesFrom "${s.continuesFrom}" does not exist`);
    else if (prev.i >= byId.get(s.id).i) problems.push(`${s.id}: continuesFrom "${s.continuesFrom}" must come earlier`);
    else if (prev.s.silent || s.silent) problems.push(`${s.id}: a silent segment cannot take part in continuesFrom`);
    else if (prev.s.kind !== s.kind) problems.push(`${s.id}: continuesFrom "${s.continuesFrom}" has a different kind (${prev.s.kind} vs ${s.kind})`);
  }

  for (const s of list) {
    if (!s || !s.parts || s.speak !== undefined) continue;
    let lastIndex = byId.get(s.id).i;
    for (const p of layoutParts({ ...s, text: String(s.text ?? "").trim() || "x y" }).parts) {
      if (!p.resumeAfter) continue;
      const target = byId.get(p.resumeAfter);
      if (!target) problems.push(`${s.id}.parts: "${p.id}" resumeAfter "${p.resumeAfter}" does not exist`);
      else if (target.i <= byId.get(s.id).i) problems.push(`${s.id}.parts: "${p.id}" resumeAfter "${p.resumeAfter}" must be listed after "${s.id}"`);
      else if (target.i < lastIndex) problems.push(`${s.id}.parts: "${p.id}" resumes before the previous part does`);
      else lastIndex = target.i;
    }
  }

  let resolved = {};
  try { resolved = assertReady(cfg, { roles: spoken.map((s) => s.kind), env, requireApiKey }); }
  catch (e) { if (e instanceof ConfigError) problems.push(...e.problems); else throw e; }
  if (problems.length) throw new ConfigError(problems);

  const outputFormat = cfg.output?.format || "mp3_44100_128";
  const speakOf = (s) => (s.speak ?? s.text).trim();
  const segments = list.map((s) => {
    if (s.silent) return { id: s.id, kind: s.kind, silent: true, duration: s.duration, gap: s.gap ?? 0 };
    const voice = resolved[s.kind];
    const speak = speakOf(s);
    let previousText = null, nextText = null;
    if (s.continuesFrom !== undefined) previousText = speakOf(byId.get(s.continuesFrom).s);
    const follower = list.find((o) => o && o.continuesFrom === s.id);
    if (follower) nextText = speakOf(follower);
    const parts = s.parts ? layoutParts({ ...s, text: s.text.trim() }).parts : null;
    return {
      id: s.id, kind: s.kind, role: s.kind, voiceName: voice.name, voice, lang: voice.lang,
      text: s.text.trim(), speak, parts, previousText, nextText, gap: s.gap ?? 0, chars: speak.length,
      hash: segmentHash({ voice, speak, previousText, nextText, outputFormat }),
    };
  });
  // playback order: a split sentence's first part plays in place; each later part plays right after its `resumeAfter` segment
  const pending = new Map();
  for (const seg of segments) if (seg.parts) for (const p of seg.parts.slice(1)) pending.set(p.resumeAfter, [...(pending.get(p.resumeAfter) || []), { segment: seg.id, part: p.id }]);
  const order = [];
  for (const seg of segments) {
    order.push(seg.parts ? { segment: seg.id, part: seg.parts[0].id } : { segment: seg.id });
    for (const item of pending.get(seg.id) || []) order.push(item);
  }
  return { id: narration.id, outputFormat, apiBase: cfg.apiBase, segments, order };
}
