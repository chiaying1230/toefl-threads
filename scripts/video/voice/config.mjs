// Voice config + environment checks. Everything here runs BEFORE any ElevenLabs request.
//
// A voice role (story / example / meaning ...) maps to a named voice in voices.json. A role that
// an episode asks for but voices.json does not define is an error – there is no default voice and
// no fallback to another TTS engine. "quiz" is deliberately not a role: it may be silent.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");
export const DEFAULT_VOICES_FILE = path.resolve(HERE, "../voices.json");

export class ConfigError extends Error {
  constructor(problems) {
    const list = Array.isArray(problems) ? problems : [String(problems)];
    super(list.length === 1 ? list[0] : `${list.length} problems:\n- ${list.join("\n- ")}`);
    this.name = "ConfigError";
    this.problems = list;
  }
}

/** null / empty / "TODO_..." / "your-..." all mean "someone still has to fill this in". */
export function isPlaceholder(v) {
  if (v === null || v === undefined) return true;
  if (typeof v !== "string") return false;
  const s = v.trim();
  return s === "" || /^TODO_/i.test(s) || /^your[-_]/i.test(s) || /^changeme/i.test(s);
}

/** Load <repo>/.env with Node's built-in loader. Variables already in the environment win. Never prints values. */
export function loadDotEnv(file = path.join(REPO_ROOT, ".env")) {
  if (!fs.existsSync(file)) return false;
  process.loadEnvFile(file);
  return true;
}

/** The API key, or a ConfigError. The error never contains the key. */
export function getApiKey(env = process.env) {
  const key = env.ELEVENLABS_API_KEY;
  if (isPlaceholder(key)) {
    throw new ConfigError("ELEVENLABS_API_KEY is not set (put it in the repo-root .env or export it in your shell)");
  }
  if (/\s/.test(key.trim())) throw new ConfigError("ELEVENLABS_API_KEY contains whitespace; check the .env line");
  return key.trim();
}

export function loadVoiceConfig(file = DEFAULT_VOICES_FILE) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch { throw new ConfigError(`cannot read voice config: ${file}`); }
  try { return JSON.parse(raw); } catch (e) { throw new ConfigError(`voice config is not valid JSON (${file}): ${e.message}`); }
}

const UNIT_SETTINGS = ["stability", "similarity_boost", "style"];

function checkVoice(name, voice, problems) {
  const at = `voices.${name}`;
  if (!voice || typeof voice !== "object") { problems.push(`${at} is missing`); return; }
  if (isPlaceholder(voice.voiceId)) problems.push(`${at}.voiceId is not set`);
  if (isPlaceholder(voice.model)) problems.push(`${at}.model is not set`);
  const s = voice.settings;
  if (!s || typeof s !== "object" || Array.isArray(s)) { problems.push(`${at}.settings must be an object`); return; }
  for (const [k, v] of Object.entries(s)) {
    if (v === null || v === undefined) problems.push(`${at}.settings.${k} is not set (fill it in or delete the key)`);
    else if (typeof v !== "number" && typeof v !== "boolean") problems.push(`${at}.settings.${k} must be a number or boolean`);
    else if (UNIT_SETTINGS.includes(k) && (typeof v !== "number" || v < 0 || v > 1)) problems.push(`${at}.settings.${k} must be between 0 and 1`);
  }
}

/**
 * Resolve the requested roles to concrete voices and verify everything needed to make a request.
 * Throws one ConfigError listing every problem. Returns { role: { name, voiceId, model, settings, lang } }.
 */
export function assertReady(cfg, { roles, env = process.env, requireApiKey = true } = {}) {
  const problems = [];
  if (!cfg || typeof cfg !== "object") throw new ConfigError("voice config is empty");
  if (cfg.provider !== "elevenlabs") problems.push(`provider must be "elevenlabs" (got ${JSON.stringify(cfg.provider)})`);
  if (!cfg.voices || typeof cfg.voices !== "object") problems.push("voices is missing");
  if (!cfg.roles || typeof cfg.roles !== "object") problems.push("roles is missing");
  if (problems.length) throw new ConfigError(problems);

  const wanted = [...new Set(roles || [])];
  const resolved = {}, checked = new Set();
  for (const role of wanted) {
    const name = cfg.roles[role];
    if (!name) { problems.push(`voice role "${role}" is not defined (known roles: ${Object.keys(cfg.roles).join(", ") || "none"})`); continue; }
    if (!cfg.voices[name]) { problems.push(`role "${role}" points to voice "${name}", which is not defined in voices`); continue; }
    if (!checked.has(name)) { checkVoice(name, cfg.voices[name], problems); checked.add(name); }
    resolved[role] = { name, ...cfg.voices[name] };
  }
  if (requireApiKey) { try { getApiKey(env); } catch (e) { problems.push(e.message); } }
  if (problems.length) throw new ConfigError(problems);
  return resolved;
}
