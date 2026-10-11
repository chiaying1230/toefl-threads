// Compare the files of a frozen reference with the hashes recorded in its freeze file. Read-only.
//
//   node scripts/video/check-freeze.mjs [docs/p2-auto/FROZEN.json]
// A drift in the video / narration / plan / manifest / alignment / audio assets means the reference itself changed – that must never happen.
// A drift in a shared template or pipeline file (group "templateAndPipeline") is allowed to happen when the template evolves, but it
// means the reference must be re-verified before the change is accepted: render p2 again and compare (see FREEZE.md "Changing shared code").
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./voice/config.mjs";

const file = path.resolve(process.argv[2] || path.join(REPO_ROOT, "docs/p2-auto/FROZEN.json"));
const frozen = JSON.parse(fs.readFileSync(file, "utf8"));
const sha = (f) => { const p = path.join(REPO_ROOT, f); return fs.existsSync(p) ? crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") : null; };
// shared code may evolve: a recorded revision (made after the P2 regression passed) replaces the templateAndPipeline hashes to compare with
const revision = (frozen.revisions ?? []).at(-1);
const groups = revision ? { ...frozen.hashes, templateAndPipeline: revision.templateAndPipeline } : frozen.hashes;
if (revision) console.log(`(shared code compared with revision "${revision.id}", ${revision.at})`);
let bad = 0;
for (const [group, files] of Object.entries(groups)) {
  const drift = Object.entries(files).filter(([f, h]) => sha(f) !== h).map(([f]) => f);
  console.log(`${drift.length ? "DRIFT" : "ok   "}  ${group}: ${Object.keys(files).length} files${drift.length ? " – changed: " + drift.join(", ") : ""}`);
  if (drift.length) bad += group === "templateAndPipeline" ? 0.001 : 1;
}
console.log(bad >= 1 ? "\nthe frozen reference itself changed" : bad > 0 ? "\nshared template/pipeline code changed since the freeze: re-verify P2 before accepting" : "\nP2 reference intact");
process.exit(bad >= 1 ? 2 : bad > 0 ? 1 : 0);
