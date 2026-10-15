// Free/read-only regression. Outputs only local QA/TEMP; frozen media/baselines are never written.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r10-frozen-verify-')), rows = [];
const env = { ...process.env }; delete env.ELEVENLABS_API_KEY;
const jobs = [
  ['p4-frames', ['scripts/video/regression.mjs', 'compare', 'scripts/video/episodes/toeic-079-auto.json', '--baseline', path.join(os.tmpdir(), 'toefu-null-hook-p4-control.baseline.json')]],
  ['p5-frames', ['scripts/video/regression.mjs', 'compare', 'scripts/video/episodes/ielts-068-auto.json', '--baseline', path.join(os.tmpdir(), 'toefu-null-hook-p5-before.baseline.json')]],
  ...[['p2','outputs/p2-auto-pipeline.mp4'],['p348','outputs/p348-first-render.mp4'],['toeic-079','outputs/toeic-079-third-render.mp4'],['ielts-068','outputs/ielts-068-first-render.mp4']].map(([id,video]) => [`verify-${id}`, ['scripts/video/verify-episode.mjs', `scripts/video/episodes/${id}-auto.json`, '--video', video, '--docs', path.join(tmp,id)]]),
];
fs.mkdirSync('video-studio/state/qa',{recursive:true});
for (const [name,args] of jobs) {
  const r = spawnSync(process.execPath,args,{env,encoding:'utf8',maxBuffer:1<<25});
  fs.writeFileSync(`video-studio/state/qa/r10-${name}.log`,r.stdout+r.stderr);
  rows.push({name,exitCode:r.status,log:`video-studio/state/qa/r10-${name}.log`});
  fs.writeFileSync('video-studio/state/qa/r10-frozen-checks.json',JSON.stringify({tempWorkspace:tmp,rows},null,2));
  console.log(`${name}: exit ${r.status}\n${r.stdout}`);
  assert.equal(r.status,0,`${name}: STOP; no P6 downstream until regressions pass (${r.stderr})`);
}
