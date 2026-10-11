// Shared plumbing for the episode render / verify scripts: a tiny static server and the headless browser.
// Machine-specific paths keep the same environment-variable convention as make-video.mjs
// (PLAYWRIGHT_MODULE, CHROMIUM_PATH, FFMPEG_PATH) and fall back to the ones the V4.2 render scripts already use.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT } from "./voice/config.mjs";
import { findFfmpeg } from "./voice/audio.mjs";

export const FFMPEG = findFfmpeg();
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".wav": "audio/wav", ".png": "image/png", ".svg": "image/svg+xml" };

/** Serves files under scripts/video/ and docs/ only (the page and its assets), read-only. */
export function startServer(port) {
  const allowedRoots = ["scripts/video", "docs"].map((d) => path.join(REPO_ROOT, d) + path.sep);
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
    const file = path.resolve(REPO_ROOT, rel);
    if (!allowedRoots.some((r) => file.startsWith(r)) || !MIME[path.extname(file)] || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", MIME[path.extname(file)]);
    res.end(fs.readFileSync(file));
  }).listen(port, "127.0.0.1");
  return server;
}

export async function launchBrowser() {
  const mod = process.env.PLAYWRIGHT_MODULE || "C:/Users/123/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
  const { chromium } = await import(mod.startsWith("playwright") ? mod : pathToFileURL(mod).href);
  const exe = process.env.CHROMIUM_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  return chromium.launch({ executablePath: exe });
}

export async function openEpisode(browser, port, episodePath) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.goto(`http://127.0.0.1:${port}/scripts/video/post-reference.html?episode=${encodeURIComponent(episodePath)}`);
  await page.waitForFunction(() => window.ready, null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  return page;
}
