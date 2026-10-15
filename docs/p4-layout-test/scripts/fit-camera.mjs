// scratch: give the fake layout episode a camera that follows its reading lines (what tuning against a real plan would do)
import fs from "node:fs";
const { startServer, launchBrowser, openEpisode } = await import("file:///C:/Users/123/toefl-threads/scripts/video/render-lib.mjs");
const epFile = "C:/Users/123/toefl-threads/docs/p4-layout-test/episode.json";
const ep = JSON.parse(fs.readFileSync(epFile, "utf8"));
const server = startServer(8184), browser = await launchBrowser();
const page = await openEpisode(browser, 8184, "/docs/p4-layout-test/episode.json");
await page.evaluate(() => window.renderFrame(0));
// top of every reading line / note relative to its block, with the note fully open (heights at their natural size)
const pos = await page.evaluate(() => {
  const out = {};
  for (const sec of document.querySelectorAll("section.source")) {
    for (const el of sec.querySelectorAll("[data-line]")) out[el.dataset.line] = { block: sec.id, rel: el.getBoundingClientRect().top - sec.getBoundingClientRect().top };
  }
  return out;
});
const keep = (ep.camera).filter((c) => c.id === "hook" || c.id === "quiz");
const cam = [keep[0]];
const at = (line, word) => (word ? { line, word } : { line });
// the line being read sits ~120 px below the top of the window; a line that opens a note sits higher so the note stays in view
for (const [line, top, word] of [["s1", 95], ["s2", 130], ["mouseLead", 90], ["mouseLead", 40, "mouse"], ["mouseRest", 110], ["withLead", 90], ["withLead", 40, "with"], ["withRest", 110], ["napping", 120]]) {
  const p = pos[line]; if (!p) continue;
  cam.push({ at: at(line, word), id: p.block, offset: top - p.rel });
}
cam.push(keep[1]);
ep.camera = cam;
fs.writeFileSync(epFile, JSON.stringify(ep, null, 1));
console.log(cam.map((c) => JSON.stringify(c)).join("\n"));
await browser.close(); server.close();
