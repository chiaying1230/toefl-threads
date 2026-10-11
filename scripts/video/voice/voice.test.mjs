// Offline tests: no network, no API key needed. Run: node --test scripts/video/voice/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { alignmentToWords, AlignmentError } from "./align.mjs";
import { assertReady, ConfigError, getApiKey, isPlaceholder, loadVoiceConfig } from "./config.mjs";
import { buildRequest, synthesizeWithTimestamps, ElevenLabsError, redact, estimateDurationSeconds } from "./elevenlabs.mjs";

// a synthetic alignment: every character 0.1s long
function fake(text, { step = 0.1 } = {}) {
  const characters = [...text];
  return { characters, character_start_times_seconds: characters.map((_, i) => i * step), character_end_times_seconds: characters.map((_, i) => (i + 1) * step) };
}
const KEY = "sk_0123456789abcdef0123456789abcdef";
const goodVoice = { name: "arthur", voiceId: "voice123", model: "model_x", settings: { stability: 0.5, speed: 1 } };

// ---------- align ----------
test("align: tokens, pos/count/text and until = next at", () => {
  const text = "Ninety percent, for boxes.";
  const { words, speechStart, speechEnd } = alignmentToWords(text, fake(text));
  assert.deepEqual(words.map((w) => [w.text, w.pos, w.count]), [["Ninety", 0, 6], ["percent", 7, 8], ["for", 16, 3], ["boxes", 20, 6]]);
  assert.equal(words[0].until, words[1].at);
  assert.equal(words[3].until, speechEnd);
  assert.equal(speechStart, 0);
  assert.ok(words.every((w, i) => i === 0 || w.at >= words[i - 1].at));
});

test("align: same pos/count/text contract as the approved V4.2 plan", (t) => {
  const file = new URL("../../../docs/p2-v4.2/p2-v4.2.plan.json", import.meta.url);
  if (!fs.existsSync(file)) return t.skip("docs/p2-v4.2 plan not present");
  const plan = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const line of plan.lines.filter((l) => l.words?.length)) {
    const { words } = alignmentToWords(line.text, fake(line.text));
    assert.deepEqual(words.map(({ pos, count, text }) => ({ pos, count, text })), line.words.map(({ pos, count, text }) => ({ pos, count, text })), line.id);
  }
});

test("align: Chinese, and phrase-level mode", () => {
  const text = "分配、撥出。";
  assert.deepEqual(alignmentToWords(text, fake(text), { tokens: "none" }).words, []);
  const { words } = alignmentToWords(text, fake(text));
  assert.equal(words.length, 1);
  assert.equal(words[0].count, text.length);
});

test("align: surrogate pairs keep pos in UTF-16 units", () => {
  const text = "go 🐾 now";
  const { words } = alignmentToWords(text, fake(text));
  assert.deepEqual(words.map((w) => w.pos), [...text.matchAll(/\S+/g)].map((m) => m.index));
});

test("align: rejects every inconsistency instead of repairing it", () => {
  const text = "one two";
  const ok = fake(text);
  const bad = (a, opts) => assert.throws(() => alignmentToWords(text, a, opts), AlignmentError);
  bad(null);
  bad({ ...ok, characters: [...ok.characters.slice(0, -1), "x"] });                     // text differs
  bad({ ...ok, character_end_times_seconds: ok.character_end_times_seconds.slice(1) }); // length mismatch
  bad({ ...ok, character_start_times_seconds: ok.character_start_times_seconds.map((v, i) => (i === 3 ? 0 : v)) }); // goes backwards
  bad({ ...ok, character_end_times_seconds: ok.character_end_times_seconds.map((v, i) => (i === 2 ? NaN : v)) });
  bad({ ...ok, character_end_times_seconds: ok.character_end_times_seconds.map((v, i) => (i === 2 ? -1 : v)) });
  bad(ok, { audioDuration: 0.2 });                                                       // ends far beyond audio
  assert.doesNotThrow(() => alignmentToWords(text, ok, { audioDuration: 0.7 }));         // 0.7s of audio, alignment ends 0.7s
  assert.throws(() => alignmentToWords("", ok), AlignmentError);
});

// ---------- config ----------
const cfg = (patch = {}) => ({
  provider: "elevenlabs",
  voices: { arthur: { voiceId: "v1", lang: "en", model: "m1", settings: { stability: 0.5 } }, ling: { voiceId: "v2", lang: "zh", model: "m1", settings: {} } },
  roles: { story: "arthur", example: "arthur", meaning: "ling" },
  ...patch,
});
const env = { ELEVENLABS_API_KEY: KEY };

test("config: ready config resolves roles", () => {
  const r = assertReady(cfg(), { roles: ["story", "meaning"], env });
  assert.equal(r.story.voiceId, "v1");
  assert.equal(r.meaning.name, "ling");
});

test("config: committed voices.json is complete for story / example / meaning", () => {
  const r = assertReady(loadVoiceConfig(), { roles: ["story", "example", "meaning"], env });
  assert.equal(r.story.name, "arthur");
  assert.equal(r.example.name, "arthur");
  assert.equal(r.meaning.name, "ling");
  assert.ok(Object.values(r).every((v) => v.model && v.voiceId && v.settings.stability === 0 && v.settings.similarity_boost === 0));
});

test("config: missing voice id / model / settings value / role / key all fail up front", () => {
  const fail = (c, e = env, roles = ["story"]) => assert.throws(() => assertReady(c, { roles, env: e }), ConfigError);
  fail(cfg({ voices: { ...cfg().voices, arthur: { ...cfg().voices.arthur, voiceId: "TODO_X" } } }));
  fail(cfg({ voices: { ...cfg().voices, arthur: { ...cfg().voices.arthur, model: null } } }));
  fail(cfg({ voices: { ...cfg().voices, arthur: { ...cfg().voices.arthur, settings: { stability: null } } } }));
  fail(cfg({ voices: { ...cfg().voices, arthur: { ...cfg().voices.arthur, settings: { stability: 1.5 } } } }));
  fail(cfg(), env, ["quiz"]);                       // role not defined
  fail(cfg({ roles: { story: "nobody" } }));       // role -> unknown voice
  fail(cfg(), {});                                  // no key
  fail(cfg(), { ELEVENLABS_API_KEY: "your-elevenlabs-api-key" }); // .env.example placeholder
});

test("config: all problems are reported together and never contain the key", () => {
  try { assertReady(cfg({ voices: { arthur: { voiceId: null, model: null, settings: {} } } }), { roles: ["story", "meaning"], env }); assert.fail("should throw"); }
  catch (e) { assert.ok(e.problems.length >= 3); assert.ok(!e.message.includes(KEY)); }
  assert.throws(() => getApiKey({}), (e) => !e.message.includes("sk_"));
  assert.ok(isPlaceholder("TODO_FOO") && isPlaceholder("") && !isPlaceholder("abc"));
});

// ---------- client ----------
const okBody = (text) => JSON.stringify({ audio_base64: Buffer.from("fake-mp3-bytes").toString("base64"), alignment: fake(text), normalized_alignment: fake(text) });
const reply = (status, body, headers = {}) => async () => new Response(body, { status, headers });

test("client: request shape (url, header, body) – and the key is not in the URL or body", async () => {
  const text = "Hello world.";
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return new Response(okBody(text), { status: 200 }); };
  const r = await synthesizeWithTimestamps({ voice: goodVoice, text, previousText: "before", nextText: "after", apiKey: KEY, fetchImpl });
  assert.equal(seen.url, "https://api.elevenlabs.io/v1/text-to-speech/voice123/with-timestamps?output_format=mp3_44100_128");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers["xi-api-key"], KEY);
  assert.deepEqual(JSON.parse(seen.init.body), { text, model_id: "model_x", voice_settings: { stability: 0.5, speed: 1 }, previous_text: "before", next_text: "after" });
  assert.ok(!seen.url.includes(KEY) && !seen.init.body.includes(KEY));
  assert.equal(r.audio.toString(), "fake-mp3-bytes");
  assert.equal(r.characters, text.length);
  assert.deepEqual(alignmentToWords(text, r.alignment).words.map((w) => w.text), ["Hello", "world"]);
});

test("client: refuses before any request when voice/key/text is unusable", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return new Response("{}"); };
  const run = (over) => synthesizeWithTimestamps({ voice: goodVoice, text: "hi", apiKey: KEY, fetchImpl, ...over });
  await assert.rejects(run({ voice: { ...goodVoice, voiceId: "TODO_ARTHUR_VOICE_ID" } }), ConfigError);
  await assert.rejects(run({ voice: { ...goodVoice, model: null } }), ConfigError);
  await assert.rejects(run({ text: "  " }), { code: "BAD_INPUT" });
  await assert.rejects(run({ text: "x".repeat(1001) }), { code: "TEXT_TOO_LONG" });
  await assert.rejects(run({ outputFormat: "mp3&x=1" }), { code: "BAD_INPUT" });
  const saved = process.env.ELEVENLABS_API_KEY; delete process.env.ELEVENLABS_API_KEY;
  try { await assert.rejects(run({ apiKey: undefined }), ConfigError); } finally { if (saved !== undefined) process.env.ELEVENLABS_API_KEY = saved; }
  assert.equal(called, false);
});

test("client: HTTP errors are classified, and the key is scrubbed even if the server echoes it", async () => {
  const run = (fetchImpl) => synthesizeWithTimestamps({ voice: goodVoice, text: "hi", apiKey: KEY, fetchImpl });
  await assert.rejects(run(reply(401, JSON.stringify({ detail: { status: "invalid_api_key", message: `bad key ${KEY}` } }))), (e) => e.code === "AUTH" && !e.retryable && !e.message.includes(KEY) && e.message.includes("[redacted]"));
  await assert.rejects(run(reply(401, JSON.stringify({ detail: { status: "quota_exceeded", message: "no credits" } }))), (e) => e.code === "QUOTA" && !e.retryable);
  await assert.rejects(run(reply(429, JSON.stringify({ detail: { status: "too_many_concurrent_requests", message: "slow down" } }), { "retry-after": "7" })), (e) => e.code === "RATE_LIMIT" && e.retryable && e.retryAfter === 7);
  await assert.rejects(run(reply(422, JSON.stringify({ detail: [{ msg: "model_id invalid" }] }))), (e) => e.code === "INVALID_REQUEST" && /model_id invalid/.test(e.message));
  await assert.rejects(run(reply(503, "upstream down")), (e) => e.code === "SERVER" && e.retryable);
  await assert.rejects(run(async () => { throw Object.assign(new TypeError(`fetch failed for ${KEY}`), { cause: { code: "ECONNRESET" } }); }), (e) => e.code === "NETWORK" && e.retryable && !e.message.includes(KEY));
});

test("client: bad success bodies fail loudly (no alignment is never papered over)", async () => {
  const run = (body) => synthesizeWithTimestamps({ voice: goodVoice, text: "hi", apiKey: KEY, fetchImpl: reply(200, body) });
  await assert.rejects(run("not json"), { code: "BAD_RESPONSE" });
  await assert.rejects(run(JSON.stringify({ alignment: fake("hi") })), { code: "BAD_RESPONSE" });
  await assert.rejects(run(JSON.stringify({ audio_base64: Buffer.from("x").toString("base64"), alignment: null })), (e) => e instanceof ElevenLabsError && e.code === "NO_ALIGNMENT");
});

test("client helpers", () => {
  assert.equal(redact(`a ${KEY} b`, KEY), "a [redacted] b");
  assert.equal(redact("sk_abcdefghijklmnop1234"), "[redacted]");
  assert.equal(estimateDurationSeconds(Buffer.alloc(16000), "mp3_44100_128"), 1);
  assert.equal(estimateDurationSeconds(Buffer.alloc(88200), "pcm_44100"), 1);
  assert.equal(estimateDurationSeconds(Buffer.alloc(10), "ulaw_8000"), null);
  assert.equal(buildRequest({ voice: goodVoice, text: "hi" }).body.previous_text, undefined);
});
