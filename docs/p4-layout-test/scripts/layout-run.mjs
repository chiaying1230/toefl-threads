// scratch: validate + audit + screenshot the fake-timing toeic-079 layout test
import fs from "node:fs";
const R = "file:///C:/Users/123/toefl-threads/scripts/video/";
const { startServer, launchBrowser, openEpisode } = await import(R + "render-lib.mjs");
const { validateEpisode, linesFromPlan } = await import(R + "voice/episode-refs.mjs");
const SP = process.argv[2];
const epFile = "C:/Users/123/toefl-threads/docs/p4-layout-test/episode.json";
const ep = JSON.parse(fs.readFileSync(epFile, "utf8")), plan = JSON.parse(fs.readFileSync("C:/Users/123/toefl-threads/docs/p4-layout-test/plan.json", "utf8"));
const warnings = [];
const problems = validateEpisode(ep, linesFromPlan(plan), { warnings });
console.log("validator problems:", problems.length, problems, "warnings:", warnings);

fs.mkdirSync(SP + "/p4", { recursive: true });
const server = startServer(8183), browser = await launchBrowser();
const page = await openEpisode(browser, 8183, "/docs/p4-layout-test/episode.json");
const L = Object.fromEntries(plan.lines.map((l) => [l.id, l]));
const word = (id, w) => { const l = L[id]; const x = l.words.find((q) => q.text.replace(/[.,]/g, "").toLowerCase() === w); return l.start + x.at + (x.until - x.at) / 2; };
// DOM: who is yellow, per reading line
await page.evaluate(() => window.renderFrame(0));
const dom = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-line]")].filter((e) => e.classList.contains("paragraph") || e.classList.contains("example")).map((e) => [e.dataset.line, { key: [...e.querySelectorAll(".cue.key")].map((c) => c.textContent.trim()), all: e.querySelectorAll(".cue").length }])));
console.log("yellow tokens per line:"); for (const [k, v] of Object.entries(dom)) console.log("  " + k.padEnd(10), v.key.length ? v.key.join(" ") : "(none)");
// audit all frames
const dur = await page.evaluate(() => window.template.duration); const issues = new Map();
for (let t = 0; t < dur; t += 1 / 30) for (const i of await page.evaluate((t) => window.audit(t), t)) if (!issues.has(i)) issues.set(i, t.toFixed(2));
console.log("layout audit:", Math.ceil(dur * 30), "frames,", issues.size ? [...issues] : "no issues");
// screenshots
const shots = {
  "01_hook": 0.5,
  "02_s1_plain_a": L.s1.start + 1.2,
  "03_s2_plain_and": L.s2.start + 1.5,
  "04_phrase_mid_cat": word("mouseLead", "cat"),
  "05_phrase_mouse_open": word("mouseLead", "mouse") + 0.4,
  "06_detail1_meaning": L.gMeaning.start + 0.9,
  "07_detail1_example_phrase": word("gExample", "cat"),
  "08_back_mouseRest": L.mouseRest.start + 0.6,
  "09_withLead_was": word("withLead", "consumed"),
  "10_detail2_meaning": L.cMeaning.start + 0.9,
  "11_detail2_example": word("cExample", "consumed"),
  "12_withRest": L.withRest.start + 1.2,
  "13_napping_was": L.napping.start + 1.0,
  "14_quiz": L.question.start + 0.4,
  "15_answer": L.answer.start + 0.6,
  "16_outro": plan.duration + 1.7,
};
for (const [n, t] of Object.entries(shots)) { await page.evaluate((t) => window.renderFrame(t), t); await page.screenshot({ path: `${SP}/p4/${n}.png` }); }
// measured widths for the long titles / outro rows
await page.evaluate((t) => window.renderFrame(t), shots["06_detail1_meaning"]);
const m = await page.evaluate(() => { const q = (s) => [...document.querySelectorAll(s)].map((e) => { const r = e.getBoundingClientRect(); return { text: e.textContent.slice(0, 40), w: Math.round(r.width), h: Math.round(r.height), lines: Math.round(r.height / parseFloat(getComputedStyle(e).lineHeight || 1)), scrollW: e.scrollWidth, clientW: e.clientWidth }; }); return { meaning: q(".meaning"), outroWord: q(".outro-word"), outroB: q(".outro-word b") }; });
console.log(JSON.stringify(m));
await browser.close(); server.close();
