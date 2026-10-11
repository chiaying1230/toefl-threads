// Content-addressed store for generated segments. A hash names its files forever and is never overwritten.
//
//   <audioDir>/<hash>.mp3                 generated audio – local only (voice-cache/, git-ignored)
//   <alignmentDir>/<hash>.json            the API's raw alignment + inputs – small, tracked in git
//
// A segment is a cache hit only when BOTH files exist. Writes go to a temp file and are renamed, so an
// interrupted run never leaves a half-written entry that later looks valid.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./config.mjs";

export const DEFAULT_AUDIO_DIR = path.join(REPO_ROOT, "voice-cache");
export const DEFAULT_ALIGNMENT_DIR = path.join(REPO_ROOT, "scripts", "video", "narration", "alignment");

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function createCache({ audioDir = DEFAULT_AUDIO_DIR, alignmentDir = DEFAULT_ALIGNMENT_DIR } = {}) {
  const audioPath = (hash) => path.join(audioDir, `${hash}.mp3`);
  const alignmentPath = (hash) => path.join(alignmentDir, `${hash}.json`);
  return {
    audioDir, alignmentDir, audioPath, alignmentPath,
    has: (hash) => fs.existsSync(audioPath(hash)) && fs.existsSync(alignmentPath(hash)),
    readAlignment: (hash) => JSON.parse(fs.readFileSync(alignmentPath(hash), "utf8")),
    /** audio first, alignment last: the entry only counts as present once both are complete. */
    write(hash, { audio, alignment, meta }) {
      atomicWrite(audioPath(hash), audio);
      atomicWrite(alignmentPath(hash), JSON.stringify({ hash, ...meta, alignment }, null, 2) + "\n");
    },
  };
}
