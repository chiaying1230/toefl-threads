// Plan and run segment generation for one narration file. Only cache misses ever reach the API.
//
//   planNarration()      pure: classify every segment as hit / miss / silent and count the characters to buy
//   generateNarration()  sequential: synthesize each missing segment, validate its alignment, store it, write the manifest
//
// Failure policy: a non-retryable error stops the run at once; a retryable one (429, 5xx, network, missing
// alignment) is retried a few times with backoff; nothing falls back to another voice or another TTS engine.
// Segments that finished before a failure stay cached, so re-running resumes where it stopped.
import fs from "node:fs";
import path from "node:path";
import { AlignmentError, alignmentToWords } from "./align.mjs";
import { ConfigError } from "./config.mjs";
import { ElevenLabsError } from "./elevenlabs.mjs";

export const DEFAULT_MAX_CHARS = 2000;

export function planNarration(prepared, cache) {
  const seen = new Set();
  const segments = prepared.segments.map((s) => {
    if (s.silent) return { ...s, status: "silent" };
    const hit = cache.has(s.hash);
    // the same text twice in one episode is generated once
    const duplicate = !hit && seen.has(s.hash);
    seen.add(s.hash);
    return { ...s, status: hit ? "hit" : duplicate ? "duplicate" : "miss" };
  });
  const misses = segments.filter((s) => s.status === "miss");
  return {
    id: prepared.id, outputFormat: prepared.outputFormat, apiBase: prepared.apiBase, segments,
    counts: { hit: segments.filter((s) => s.status === "hit").length, miss: misses.length, silent: segments.filter((s) => s.status === "silent").length, duplicate: segments.filter((s) => s.status === "duplicate").length },
    charsToGenerate: misses.reduce((n, s) => n + s.chars, 0),
  };
}

export function formatPlan(plan) {
  const lines = [`episode ${plan.id}: ${plan.counts.hit} cached, ${plan.counts.miss} to generate, ${plan.counts.silent} silent${plan.counts.duplicate ? `, ${plan.counts.duplicate} duplicate` : ""} – ${plan.charsToGenerate} characters to generate`];
  for (const s of plan.segments) {
    const what = s.silent ? `silent ${s.duration}s` : `${s.voiceName} ${s.chars} chars ${s.hash.slice(0, 8)}${s.parts ? ` → parts ${s.parts.map((p) => p.id).join(" + ")}` : ""}`;
    lines.push(`  ${s.status.padEnd(9)} ${s.id.padEnd(18)} ${what}`);
  }
  return lines.join("\n");
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, { retries = 3, sleep = wait, log = () => {} } = {}) {
  let alignmentRetried = false;
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); }
    catch (e) {
      const alignmentProblem = e instanceof AlignmentError || e?.code === "NO_ALIGNMENT";
      const retryable = alignmentProblem ? !alignmentRetried : e instanceof ElevenLabsError && e.retryable;
      if (alignmentProblem) alignmentRetried = true;
      if (!retryable || attempt >= retries) throw e;
      const seconds = e.retryAfter ? Math.min(e.retryAfter, 30) : 2 ** (attempt + 1);
      log(`  retry ${attempt + 1}/${retries} in ${seconds}s (${e.code || e.name})`);
      await sleep(seconds * 1000);
    }
  }
}

/**
 * @param {object} plan  from planNarration
 * @param {object} deps  { cache, synthesize, manifestPath, sleep?, log?, maxChars? }
 * @returns {{ generated: number }}  throws on the first unrecoverable failure (after writing the manifest)
 */
export async function generateNarration(plan, { cache, synthesize, manifestPath, sleep, log = () => {}, maxChars = DEFAULT_MAX_CHARS }) {
  if (plan.charsToGenerate > maxChars) {
    throw new ConfigError(`this run would generate ${plan.charsToGenerate} characters, over the --max-chars limit of ${maxChars}; raise the limit deliberately`);
  }
  const done = new Map(); // hash -> meta of freshly generated segments
  let failure = null;
  try {
    for (const s of plan.segments) {
      if (s.status !== "miss") continue;
      log(`generate ${s.id} (${s.voiceName}, ${s.chars} chars)`);
      const result = await withRetry(async () => {
        const r = await synthesize({ voice: s.voice, text: s.speak, previousText: s.previousText ?? undefined, nextText: s.nextText ?? undefined, outputFormat: plan.outputFormat, apiBase: plan.apiBase });
        const { words, speechStart, speechEnd } = alignmentToWords(s.speak, r.alignment, { audioDuration: r.estimatedDuration, tokens: s.lang === "zh" ? "none" : "whitespace" });
        return { r, words, speechStart, speechEnd };
      }, { sleep, log });
      cache.write(s.hash, {
        audio: result.r.audio,
        alignment: result.r.alignment,
        meta: { segment: s.id, kind: s.kind, voice: s.voiceName, voiceId: s.voice.voiceId, model: s.voice.model, settings: s.voice.settings, text: s.speak, previousText: s.previousText, nextText: s.nextText, outputFormat: plan.outputFormat, characters: s.chars, estimatedDuration: result.r.estimatedDuration, speechStart: result.speechStart, speechEnd: result.speechEnd },
      });
      done.set(s.hash, true);
    }
  } catch (e) { failure = e; }
  writeManifest(plan, cache, manifestPath, failure);
  if (failure) throw failure;
  return { generated: done.size };
}

/** Per-episode manifest (tracked in git): which cache entry each segment uses. No audio bytes, no secrets. */
export function writeManifest(plan, cache, manifestPath, failure = null) {
  const segments = plan.segments.map((s) => {
    if (s.silent) return { id: s.id, kind: s.kind, silent: true, duration: s.duration, gap: s.gap };
    const ready = cache.has(s.hash);
    return { id: s.id, kind: s.kind, voice: s.voiceName, hash: s.hash, chars: s.chars, gap: s.gap, ...(s.parts ? { parts: s.parts.map((p) => ({ id: p.id, text: p.text, gap: p.gap })) } : {}), status: ready ? "ready" : "missing", audio: ready ? path.basename(cache.audioPath(s.hash)) : null };
  });
  const manifest = { id: plan.id, outputFormat: plan.outputFormat, complete: segments.every((s) => s.silent || s.status === "ready"), ...(failure ? { lastError: String(failure.message).slice(0, 300) } : {}), segments };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const tmp = `${manifestPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + "\n");
  fs.renameSync(tmp, manifestPath);
  return manifest;
}
