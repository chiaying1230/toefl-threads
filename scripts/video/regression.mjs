// Regression baseline for a rendered episode's DOM and frames (no video encoding, no audio, no API).
//
//   node scripts/video/regression.mjs record  scripts/video/episodes/p2-auto.json  [--out docs/regression/p2-auto.baseline.json]
//   node scripts/video/regression.mjs compare  scripts/video/episodes/p2-auto.json  [--baseline docs/regression/p2-auto.baseline.json] [--no-frames]
//
// A baseline holds
//   * domKeys   – for every reading line, the token count and the indices of the tokens that carry the `key` / `event`
//                 class (who is yellow). Deterministic and independent of the browser: comparable across machines.
//   * frames    – a hash of the screenshot of every frame, rendered the way render-episode.mjs does (renderFrame + JPEG q93).
//                 Only comparable on the same machine / browser: the browser build is recorded next to it.
// A few frames (the animated outro mascot) are not bit-stable between two renders of the *same* code. A frame rendered on its
// own does not give the same pixels as the same frame rendered inside the sequence, so every re-check runs a window of
// consecutive frames, as render-episode.mjs does. `record` renders every frame twice and re-renders the window around the
// unstable ones; the hashes seen are that frame's `alternates`. `compare` re-renders the window around a differing frame
// and accepts it only if one of the hashes seen is the baseline's (or one of its alternates).
// `compare` exits 1 on any difference. It is how a change to the shared template is shown not to move a frozen episode.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./voice/config.mjs";
import { launchBrowser, openEpisode, startServer } from "./render-lib.mjs";

const args = process.argv.slice(2);
const mode = args[0], episodeArg = args[1];
const value = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : d; };
if (!["record", "compare"].includes(mode) || !episodeArg) { console.error("usage: regression.mjs record|compare <episode.json> [--out|--baseline file] [--no-frames]"); process.exit(2); }
const episodeFile = path.resolve(episodeArg);
const episode = JSON.parse(fs.readFileSync(episodeFile, "utf8"));
const episodeUrl = "/" + path.relative(REPO_ROOT, episodeFile).split(path.sep).join("/");
const defaultFile = path.join(REPO_ROOT, "docs", "regression", `${episode.id}.baseline.json`);
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const fileSha = (rel) => sha(fs.readFileSync(path.join(REPO_ROOT, rel.replace(/^\//, ""))));

const server = startServer(8133);
let browser;
try {
  browser = await launchBrowser();
  const page = await openEpisode(browser, 8133, episodeUrl);
  const duration = await page.evaluate(() => window.template.duration);
  const frames = Math.ceil(duration * 30 - 1e-9);

  const domKeys = await page.evaluate(() => {
    window.renderFrame(0);
    const out = {};
    for (const el of document.querySelectorAll("[data-line]")) {
      if (!el.classList.contains("paragraph") && !el.classList.contains("example")) continue;
      const tokens = [...el.querySelectorAll(".cue")];
      out[el.dataset.line] = {
        tokens: tokens.length,
        key: tokens.flatMap((t, i) => (t.classList.contains("key") ? [i] : [])),
        event: tokens.flatMap((t, i) => (t.classList.contains("event") ? [i] : [])),
        text: tokens.map((t) => t.textContent.trim()).join(" "),
      };
    }
    return out;
  });

  const shoot = async (i) => { await page.evaluate((t) => window.renderFrame(t), i / 30); return sha(await page.screenshot({ type: "jpeg", quality: 93 })).slice(0, 16); };
  // render frames lo..hi in order `passes` times; frame → set of hashes seen
  const window_ = async (lo, hi, passes) => {
    const sets = new Map();
    for (let p = 0; p < passes; p++) for (let i = lo; i <= hi; i++) { const h = await shoot(i); (sets.get(i) ?? sets.set(i, new Set()).get(i)).add(h); }
    return sets;
  };
  let frameHashes = null, alternates = {};
  if (!args.includes("--no-frames") || mode === "record") {
    frameHashes = [];
    for (let i = 0; i < frames; i++) frameHashes.push(await shoot(i));
    if (mode === "record") {
      const second = [];
      for (let i = 0; i < frames; i++) second.push(await shoot(i));
      const unstable = frameHashes.flatMap((h, i) => (h !== second[i] ? [i] : []));
      if (unstable.length) {
        const sets = await window_(Math.max(0, Math.min(...unstable) - 12), Math.min(frames - 1, Math.max(...unstable) + 3), 6);
        for (const [i, seen] of sets) { seen.add(frameHashes[i]); seen.add(second[i]); if (seen.size > 1) alternates[i] = [...seen]; }
      }
    }
  }

  const meta = {
    recordedAt: new Date().toISOString(),
    episode: episode.id,
    episodeSha256: sha(fs.readFileSync(episodeFile)),
    planSha256: fileSha(episode.plan),
    browser: browser.version(),
    userAgent: await page.evaluate(() => navigator.userAgent),
    viewport: "1080x1920",
    node: process.version,
    platform: process.platform,
    frameHash: "sha256(JPEG q93 screenshot of renderFrame(i/30)).slice(0,16), as render-episode.mjs",
  };

  if (mode === "record") {
    const out = path.resolve(value("out", defaultFile));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ meta, domKeys, frames: { count: frames, hashes: frameHashes, unstable: Object.keys(alternates).length, alternates } }, null, 1) + "\n");
    console.log(`recorded ${episode.id}: ${Object.keys(domKeys).length} reading lines, ${frames} frames (${Object.keys(alternates).length} not bit-stable: ${Object.keys(alternates).join(", ") || "none"}), browser ${meta.browser} → ${path.relative(REPO_ROOT, out)}`);
  } else {
    const base = JSON.parse(fs.readFileSync(path.resolve(value("baseline", defaultFile)), "utf8"));
    const problems = [];
    for (const k of new Set([...Object.keys(base.domKeys), ...Object.keys(domKeys)])) {
      if (JSON.stringify(base.domKeys[k]) !== JSON.stringify(domKeys[k])) problems.push(`dom: line "${k}" differs – baseline ${JSON.stringify(base.domKeys[k])} vs now ${JSON.stringify(domKeys[k])}`);
    }
    if (base.meta.planSha256 !== meta.planSha256) problems.push("the plan file is not the one the baseline was recorded with");
    let frameNote = "frames not compared (--no-frames)";
    if (frameHashes) {
      if (base.meta.browser !== meta.browser) console.warn(`note: baseline browser ${base.meta.browser}, now ${meta.browser} – frame hashes may differ for that reason alone`);
      if (base.frames.count !== frames) problems.push(`frame count ${base.frames.count} → ${frames}`);
      const differing = [], tolerated = [];
      const mismatched = frameHashes.flatMap((h, i) => (h !== base.frames.hashes[i] ? [i] : []));
      if (mismatched.length) {
        // a bit-unstable frame shows each of its variants only now and then: re-render the window until every mismatched frame has
        // produced a known hash, at most 20 passes (a real change never produces one, so it still ends as a difference)
        const lo = Math.max(0, Math.min(...mismatched) - 12), hi = Math.min(frames - 1, Math.max(...mismatched) + 3);
        const knownOf = (i) => new Set([base.frames.hashes[i], ...(base.frames.alternates?.[i] ?? [])]);
        const seen = new Map(mismatched.map((i) => [i, new Set([frameHashes[i]])]));
        for (let pass = 0; pass < 20 && mismatched.some((i) => ![...seen.get(i)].some((h) => knownOf(i).has(h))); pass++) {
          const sets = await window_(lo, hi, 1);
          for (const i of mismatched) for (const h of sets.get(i) ?? []) seen.get(i).add(h);
        }
        for (const i of mismatched) ([...seen.get(i)].some((h) => knownOf(i).has(h)) ? tolerated : differing).push(i);
      }
      if (differing.length) problems.push(`${differing.length} of ${frames} frames differ (first: ${differing.slice(0, 5).join(", ")})`);
      frameNote = `${frames} frames compared, ${differing.length} differ` + (tolerated.length ? ` (${tolerated.length} known bit-unstable frame(s) matched an alternate: ${tolerated.join(", ")})` : "");
    }
    console.log(`${episode.id}: ${Object.keys(domKeys).length} reading lines compared, ${frameNote}`);
    if (problems.length) { for (const p of problems) console.error("DIFF  " + p); process.exitCode = 1; } else console.log("REGRESSION OK – identical to the baseline");
  }
} finally {
  await browser?.close();
  server.close();
}
