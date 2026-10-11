// Offline tests for the audio-mix layer's settings logic. buildGraph needs ffmpeg (to measure the music asset); nothing else does.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, REPO_ROOT } from "./voice/config.mjs";
import { buildGraph, mixAudio, needsMix, timeOf, validateMix } from "./audio-mix.mjs";

const plan = { duration: 28, audioEnd: 24.7, lines: [
  { id: "a", start: 1, end: 3, words: [{ text: "Hello,", at: 0.5, until: 1 }] },
  { id: "answer", start: 26.75, end: 28, words: [] },
] };
const music = { asset: "/scripts/video/assets/social-soft-groove.wav", narrationGain: 0.16, endingGain: 0.3, riseDuration: 0.6, fadeIn: 0.35, fadeOut: 0.8 };
const sfx = { asset: "/scripts/video/assets/answer-correct.wav", at: { line: "answer" }, gain: 0.75 };

test("episodes without music / soundEffects need no mix, and mixAudio does nothing", () => {
  assert.equal(needsMix({}), false);
  assert.equal(needsMix({ soundEffects: [] }), false);
  assert.equal(needsMix({ music }), true);
  assert.equal(needsMix({ soundEffects: [sfx] }), true);
  assert.equal(mixAudio({ episode: {}, plan, video: "x.mp4", narration: "x.wav", out: "y.mp4" }), null);
});

test("time refs: seconds, planEnd, line start/end, word with delay", () => {
  assert.equal(timeOf(5, plan), 5);
  assert.equal(timeOf("planEnd", plan), 28);
  assert.equal(timeOf({ line: "answer" }, plan), 26.75);
  assert.equal(timeOf({ line: "a", edge: "end", delay: -0.5 }, plan), 2.5);
  assert.equal(timeOf({ line: "a", word: "hello", delay: 0.1 }, plan), 1.6);
  assert.throws(() => timeOf({ line: "nope" }, plan), ConfigError);
  assert.throws(() => timeOf({ line: "a", word: "nope" }, plan), ConfigError);
});

test("validateMix reports every bad setting before ffmpeg runs", () => {
  assert.doesNotThrow(() => validateMix({ music, soundEffects: [sfx] }, plan, 30.4));
  const bad = (episode, re) => assert.throws(() => validateMix(episode, plan, 30.4), (e) => e instanceof ConfigError && re.test(e.message));
  bad({ music: { ...music, asset: "/scripts/video/assets/missing.wav" } }, /music\.asset not found/);
  bad({ music: { ...music, narrationGain: 0.9 } }, /compete with the narration/);
  bad({ music: { ...music, fadeOut: 99 } }, /fadeOut/);
  bad({ soundEffects: [{ ...sfx, at: 99 }] }, /outside the video/);
  bad({ soundEffects: [{ ...sfx, at: { line: "ghost" } }] }, /unknown line/);
  bad({ soundEffects: [{ ...sfx, gain: 5 }] }, /gain/);
  bad({ music: { ...music, asset: "/nope.wav" }, soundEffects: [{ ...sfx, asset: "/nope2.wav" }] }, /music\.asset[\s\S]*soundEffects\[0\]\.asset/);
});

test("filter graph is exactly the one the approved P2 music mix used", (t) => {
  const approvedPlan = path.join(REPO_ROOT, "docs/p2-v4.2/p2-v4.2.plan.json");
  if (!fs.existsSync(approvedPlan)) return t.skip("approved P2 plan not present");
  const p = JSON.parse(fs.readFileSync(approvedPlan, "utf8")), duration = 31.333333333333332;
  const { args, filter } = buildGraph({ music, soundEffects: [sfx] }, p, { duration, narration: "n.wav", video: "v.mp4" });
  // the approved add-p2-music.py filter, character for character, except the effect label is numbered ([cue] → [cue0])
  assert.equal(filter, "[1:a]apad=whole_dur=31.333333333333332[voice];[2:a]volume=0.75,adelay=27650:all=1[cue0];"
    + "[3:a]volume='0.16+(0.3-0.16)*min(1,max(0,(t-24.700068027210886)/0.6))':eval=frame,afade=t=in:d=0.35,afade=t=out:st=30.53333333333333:d=0.8[music];"
    + "[voice][cue0][music]amix=inputs=3:duration=first:normalize=0[a]");
  assert.deepEqual(args.filter((a) => a.endsWith(".wav") || a === "v.mp4").map((a) => path.basename(a)), ["v.mp4", "n.wav", "answer-correct.wav", "social-soft-groove.wav"]);
  assert.ok(!args.includes("-stream_loop"), "the asset is long enough, no loop");
});

test("music shorter than the video loops; verification buses replace missing parts with silence", () => {
  const { args } = buildGraph({ music }, plan, { duration: 40, narration: "n.wav" });
  assert.ok(args.includes("-stream_loop"));
  const musicOnly = buildGraph({ music, soundEffects: [sfx] }, plan, { duration: 30, narration: "n.wav", include: { voice: false, cues: false, music: true } });
  assert.ok(musicOnly.args.join(" ").includes("anullsrc"));
  assert.match(musicOnly.filter, /amix=inputs=2/);
  const voiceOnly = buildGraph({ music, soundEffects: [sfx] }, plan, { duration: 30, narration: "n.wav", include: { voice: true, cues: false, music: false } });
  assert.match(voiceOnly.filter, /\[voice\]acopy\[a\]/);
});
