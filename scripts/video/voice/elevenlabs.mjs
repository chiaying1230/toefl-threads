// ElevenLabs text-to-speech client: POST /v1/text-to-speech/{voice_id}/with-timestamps.
//
// One call = one segment: returns the audio bytes plus the API's character alignment.
// No retry, no cache, no fallback here – a failure throws ElevenLabsError (with `retryable` and
// `retryAfter` hints for the caller). It never falls back to SAPI / edge-tts.
// The API key goes only into the xi-api-key header and is scrubbed from every error message.
import { getApiKey, isPlaceholder, ConfigError } from "./config.mjs";

export class ElevenLabsError extends Error {
  constructor(message, { code, status = null, retryAfter = null, retryable = false } = {}) {
    super(message);
    this.name = "ElevenLabsError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
    this.retryable = retryable;
  }
}

/** Remove the key (and anything shaped like one) from text before it can reach a log or an error. */
export function redact(text, ...secrets) {
  let out = String(text);
  for (const s of secrets) if (s) out = out.split(s).join("[redacted]");
  return out.replace(/\b(?:sk_|xi-)[A-Za-z0-9_-]{16,}/g, "[redacted]");
}

/** Rough duration for CBR mp3_<rate>_<kbps> / pcm_<rate>; null for anything else. Real probing happens at assembly. */
export function estimateDurationSeconds(audio, outputFormat) {
  const mp3 = /^mp3_\d+_(\d+)$/.exec(outputFormat), pcm = /^pcm_(\d+)$/.exec(outputFormat);
  if (mp3) return (audio.length * 8) / (Number(mp3[1]) * 1000);
  if (pcm) return audio.length / (Number(pcm[1]) * 2);
  return null;
}

/** The request without credentials – pure, so it can be inspected and tested without any network. */
export function buildRequest({ voice, text, previousText, nextText, outputFormat = "mp3_44100_128", apiBase = "https://api.elevenlabs.io", maxChars = 1000 }) {
  if (!voice || isPlaceholder(voice.voiceId)) throw new ConfigError("voice.voiceId is not set");
  if (isPlaceholder(voice.model)) throw new ConfigError("voice.model is not set");
  if (typeof text !== "string" || !text.trim()) throw new ElevenLabsError("text is empty", { code: "BAD_INPUT" });
  if (text.length > maxChars) throw new ElevenLabsError(`text is ${text.length} characters; the per-request guard is ${maxChars} (raise maxChars deliberately)`, { code: "TEXT_TOO_LONG" });
  if (!/^[a-z0-9_]+$/.test(outputFormat)) throw new ElevenLabsError(`bad output format: ${outputFormat}`, { code: "BAD_INPUT" });

  const body = { text, model_id: voice.model };
  if (voice.settings && Object.keys(voice.settings).length) body.voice_settings = voice.settings;
  if (!isPlaceholder(voice.languageCode)) body.language_code = voice.languageCode;
  if (previousText) body.previous_text = previousText;
  if (nextText) body.next_text = nextText;
  const url = `${apiBase.replace(/\/+$/, "")}/v1/text-to-speech/${encodeURIComponent(voice.voiceId)}/with-timestamps?output_format=${outputFormat}`;
  return { url, body };
}

function serverDetail(raw) {
  try {
    const d = JSON.parse(raw).detail;
    if (typeof d === "string") return { message: d };
    if (Array.isArray(d)) return { message: d.map((x) => x?.msg).filter(Boolean).join("; ") };
    if (d && typeof d === "object") return { status: d.status, message: d.message };
  } catch { /* not JSON */ }
  return { message: raw.slice(0, 200) };
}

function classify(status, serverStatus) {
  if (/quota|credit/i.test(serverStatus || "") || status === 402) return ["QUOTA", false];
  if (status === 401 || status === 403) return ["AUTH", false];
  if (status === 422 || status === 400) return ["INVALID_REQUEST", false];
  if (status === 429) return ["RATE_LIMIT", true];
  if (status >= 500) return ["SERVER", true];
  return ["HTTP", false];
}

/**
 * @param {object} p
 * @param {object} p.voice  one resolved voice from voices.json ({ voiceId, model, settings, ... })
 * @param {string} p.text
 * @param {string} [p.previousText] / [p.nextText]  neighbouring text, for prosody continuity (not request ids)
 * @returns {Promise<{ audio: Buffer, alignment: object, normalizedAlignment: object|null, outputFormat: string, estimatedDuration: number|null, characters: number }>}
 */
export async function synthesizeWithTimestamps({ voice, text, previousText, nextText, outputFormat = "mp3_44100_128", apiBase, apiKey, fetchImpl = globalThis.fetch, timeoutMs = 60000, maxChars }) {
  const { url, body } = buildRequest({ voice, text, previousText, nextText, outputFormat, apiBase, maxChars });
  const key = apiKey ?? getApiKey();

  let res, raw;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    raw = await res.text();
  } catch (e) {
    const timeout = e?.name === "TimeoutError" || e?.name === "AbortError";
    throw new ElevenLabsError(redact(`ElevenLabs request ${timeout ? "timed out" : "failed"}: ${e?.cause?.code || e?.message || e}`, key), { code: timeout ? "TIMEOUT" : "NETWORK", retryable: true });
  }

  if (!res.ok) {
    const { status: serverStatus, message } = serverDetail(raw);
    const [code, retryable] = classify(res.status, serverStatus);
    const ra = Number(res.headers.get("retry-after"));
    throw new ElevenLabsError(redact(`ElevenLabs ${res.status} ${code}${serverStatus ? ` (${serverStatus})` : ""}: ${String(message || "").slice(0, 300)}`, key), { code, status: res.status, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : null, retryable });
  }

  let json;
  try { json = JSON.parse(raw); } catch { throw new ElevenLabsError("ElevenLabs returned a non-JSON body", { code: "BAD_RESPONSE", status: res.status }); }
  if (typeof json.audio_base64 !== "string" || !json.audio_base64) throw new ElevenLabsError("ElevenLabs response has no audio_base64", { code: "BAD_RESPONSE", status: res.status });
  const audio = Buffer.from(json.audio_base64, "base64");
  if (!audio.length) throw new ElevenLabsError("ElevenLabs returned empty audio", { code: "BAD_RESPONSE", status: res.status });
  if (!json.alignment || typeof json.alignment !== "object") throw new ElevenLabsError("ElevenLabs response has no alignment (timing cannot be built; nothing is interpolated)", { code: "NO_ALIGNMENT", status: res.status, retryable: true });

  return { audio, alignment: json.alignment, normalizedAlignment: json.normalized_alignment ?? null, outputFormat, estimatedDuration: estimateDurationSeconds(audio, outputFormat), characters: text.length };
}
