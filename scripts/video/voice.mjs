// Voice step for one episode: validate its narration file, show what is cached, generate what is missing.
//
//   node scripts/video/voice.mjs p2                 plan only: nothing is sent, nothing is billed
//   node scripts/video/voice.mjs p2 --yes           generate the missing segments (costs ElevenLabs credits)
//   node scripts/video/voice.mjs p2 --frozen        fail if anything is missing; never calls the API (for renders)
//   options: --max-chars N (per-run safety limit, default 2000)   --narration <file>   --voices <file>   --episode <file>
// Before anything is sent, the episode that uses this narration (found through its `plan` path, or --episode) is checked against it:
// every line id / word it references must exist. A mismatch stops the run here instead of in the renderer.
//
// The argument is an episode id (scripts/video/narration/<id>.json) or a path to a narration file.
// No fallback voice: every problem stops the run with a message.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, DEFAULT_VOICES_FILE, loadDotEnv, loadVoiceConfig } from "./voice/config.mjs";
import { ElevenLabsError, synthesizeWithTimestamps } from "./voice/elevenlabs.mjs";
import { AlignmentError } from "./voice/align.mjs";
import { createCache } from "./voice/cache.mjs";
import { DEFAULT_MAX_CHARS, formatPlan, generateNarration, planNarration } from "./voice/generate.mjs";
import { loadNarration, prepareNarration } from "./voice/segments.mjs";
import { assertEpisode, findEpisodeFor, linesFromNarration } from "./voice/episode-refs.mjs";
import fs from "node:fs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const value = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : d; };
const target = args.find((a, i) => !a.startsWith("--") && !["--max-chars", "--narration", "--voices", "--episode"].includes(args[i - 1]));

try {
  if (!target && !value("narration")) throw new ConfigError("usage: node scripts/video/voice.mjs <episode-id | narration.json> [--yes | --frozen] [--max-chars N]");
  const file = value("narration") || (/[\\/]|\.json$/.test(target) ? path.resolve(target) : path.join(HERE, "narration", `${target}.json`));
  const generating = flag("yes") && !flag("frozen");
  if (generating) loadDotEnv();
  const cfg = loadVoiceConfig(value("voices", DEFAULT_VOICES_FILE));
  const prepared = prepareNarration(loadNarration(file), cfg, { requireApiKey: generating });
  const episodeFile = value("episode") ? path.resolve(value("episode")) : findEpisodeFor(prepared.id);
  if (episodeFile) { assertEpisode(JSON.parse(fs.readFileSync(episodeFile, "utf8")), linesFromNarration(prepared), path.basename(episodeFile)); console.log(`episode check: ${path.basename(episodeFile)} matches the narration`); }
  else console.log(`episode check: no episode file refers to ${prepared.id} yet (skipped)`);
  const cache = createCache();
  const plan = planNarration(prepared, cache);
  const manifestPath = path.join(path.dirname(file), `${prepared.id}.manifest.json`);
  console.log(formatPlan(plan));

  if (flag("frozen")) {
    if (plan.counts.miss) throw new ConfigError(`--frozen: ${plan.counts.miss} segment(s) are not generated yet; run with --yes first`);
    console.log("frozen check passed: every segment is cached");
  } else if (!generating) {
    console.log(plan.counts.miss ? "\nplan only (nothing sent). Add --yes to generate the missing segments." : "\nnothing to generate.");
  } else if (!plan.counts.miss) {
    console.log("\nnothing to generate.");
  } else {
    const { generated } = await generateNarration(plan, {
      cache, manifestPath, log: console.log,
      maxChars: Number(value("max-chars", DEFAULT_MAX_CHARS)),
      synthesize: (p) => synthesizeWithTimestamps({ ...p }),
    });
    console.log(`\ngenerated ${generated} segment(s); manifest: ${path.relative(process.cwd(), manifestPath)}`);
  }
} catch (e) {
  if (e instanceof ConfigError || e instanceof ElevenLabsError || e instanceof AlignmentError) { console.error(`\n${e.name}: ${e.message}`); process.exit(1); }
  throw e;
}
