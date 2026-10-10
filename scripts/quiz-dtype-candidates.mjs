// Finds distractors that look like l1 / morph / ctx types and writes data-src/dtype-candidates.csv for a human to confirm.
// Run with: node scripts/quiz-dtype-candidates.mjs
// It never edits the question bank. Rules are crude on purpose: expect false positives, start with the rows marked 高.
//   l1    the distractor shares 2+ meaningful characters with the answer, or is another sense of the target word (高);
//         shares 2+ characters with the word's other senses only (低).
//   morph the target minus a prefix/suffix is a known word whose meaning matches the distractor (高);
//         the distractor contains a keyword for what the prefix/suffix usually means (低).
//   ctx   the distractor is the meaning of another word of the same part of speech whose example sentence uses the same word
//         before AND after the blank (高), or on one side only (低). This is the weakest rule.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

// ---- full word list (same load order as build-quiz-data.mjs) ----
const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);
const run = (f) => vm.runInContext(read(f), ctx, { filename: f });
run("js/data/characters.js");
fs.readdirSync(path.join(root, "js/data")).filter((f) => /^batch-\d+\.js$/.test(f))
  .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0])).forEach((f) => run("js/data/" + f));
run("js/data/levels.js");
const VOCAB = ctx.VOCAB;
const bank = JSON.parse(read("data-src/quiz_questions_703.json").replace(/^﻿/, ""));

// ---- helpers ----
// Characters that carry no meaning of their own (grammar, nominalisers, generic suffixes). Sharing only these is not l1.
const FUNCTION_CHARS = new Set([..."的使地得了被性化之著過们們者上下不無很有在為與和及或把將並而其這那個一者員型式度力感狀界家程態令人主義"]);
const senses = (zh) => String(zh || "").split(/[；;、，,\/]/).map((s) => s.replace(/[（(].*?[）)]/g, "").trim()).filter(Boolean);
const content = (s) => [...new Set([...s].filter((c) => /[一-鿿]/.test(c) && !FUNCTION_CHARS.has(c)))];
const shared = (a, b) => { const B = new Set(content(b)); return content(a).filter((c) => B.has(c)); };

// one zh sense -> words that have it as a sense (for the ctx rule)
const bySense = new Map();
for (const [k, v] of Object.entries(VOCAB)) for (const s of senses(v.zh)) { if (!bySense.has(s)) bySense.set(s, []); bySense.get(s).push(k); }

const PREFIX = [
  ["de", ["減", "少", "短", "低", "去", "除", "離", "降", "下", "小"]],
  ["dis", ["不", "無", "非", "反", "離", "分", "拆"]], ["un", ["不", "無", "非", "未", "反", "解"]], ["in", ["不", "無", "非", "內", "入", "進"]],
  ["im", ["不", "無", "非", "內", "入"]], ["il", ["不", "無", "非"]], ["ir", ["不", "無", "非"]], ["non", ["不", "無", "非"]],
  ["re", ["再", "重", "回", "返", "複", "又"]], ["pre", ["先", "前", "預", "提前"]], ["fore", ["先", "前", "預"]],
  ["post", ["後", "之後"]], ["sub", ["下", "次", "副", "低", "潛"]], ["under", ["下", "低", "不足", "底"]],
  ["super", ["超", "過", "上", "高"]], ["over", ["超", "過", "上", "高", "越"]], ["mis", ["錯", "誤", "壞"]], ["mal", ["錯", "壞", "惡", "不良"]],
  ["anti", ["反", "對抗", "抗"]], ["counter", ["反", "對抗", "抗"]], ["co", ["共", "一起", "合", "同"]], ["con", ["共", "一起", "合", "同"]],
  ["com", ["共", "一起", "合", "同"]], ["inter", ["之間", "相互", "互", "交"]], ["ex", ["出", "外", "前任", "離"]], ["trans", ["轉", "跨", "穿", "移"]],
  ["ab", ["離", "away", "偏", "脫"]], ["ad", ["向", "加", "增"]], ["mono", ["單", "一"]], ["bi", ["雙", "二", "兩"]], ["tri", ["三"]], ["semi", ["半"]]
];
const SUFFIX = [
  ["less", ["無", "沒", "不", "缺"]], ["ful", ["充滿", "有", "豐"]], ["able", ["可", "能"]], ["ible", ["可", "能"]],
  ["er", ["者", "人", "器", "更"]], ["or", ["者", "人", "器"]], ["ness", ["性", "狀態"]], ["ment", ["行為", "結果"]], ["ize", ["化", "使"]], ["ify", ["化", "使"]]
];

// Short grammar words say nothing about whether a meaning fits the sentence, so they don't count as matching context.
const STOP = new Set("a an the to of in at on for with by from and or but is are was were be am it its my me you your he his she her we our us they them their this that i as so not no up out".split(" "));
const rows = [];
const push = (q, i, type, conf, reason) => rows.push([q.word, q.stem, q.distractors[i], type, conf, reason]);

for (const q of bank) {
  const v = VOCAB[q.word];
  const own = senses(v && v.zh);
  q.distractors.forEach((d, i) => {
    // ---- l1 ----
    const sh = shared(d, q.answer);
    const containment = d.length >= 2 && (q.answer.includes(d) || d.includes(q.answer));
    if (own.some((s) => s && (s === d || s.replace(/的$/, "") === d.replace(/的$/, "")))) push(q, i, "l1", "高", `「${d}」是 ${q.word} 的另一個意思（詞庫：${v.zh}）`);
    else if (sh.length >= 2 || containment) push(q, i, "l1", "高", `與正解「${q.answer}」共用「${sh.join("")}」`);
    else {
      const sh2 = shared(d, (v && v.zh) || "");
      if (sh2.length >= 2) push(q, i, "l1", "低", `與詞庫釋義「${v.zh}」共用「${sh2.join("")}」`);
    }

    // ---- morph ----
    const w = q.word;
    let hit = false;
    for (const [p, kws] of PREFIX) {
      if (w.length < p.length + 3 || !w.startsWith(p)) continue;
      const root = w.slice(p.length);
      const rv = VOCAB[root] || VOCAB[root + "e"];
      const rsh = rv ? shared(d, rv.zh) : [];
      if (rv && rsh.length >= 1 && content(d).length <= 3 && sh.length === 0) { push(q, i, "morph", "高", `去掉字首 ${p}- 得到 ${root}（${rv.zh}），與「${d}」共用「${rsh.join("")}」`); hit = true; break; }
      const kw = kws.find((x) => d.includes(x));
      if (kw) { push(q, i, "morph", "低", `${w} 字首 ${p}- 常被誤讀為「${kw}」，干擾項「${d}」含「${kw}」`); hit = true; break; }
    }
    if (!hit) for (const [s, kws] of SUFFIX) {
      if (w.length < s.length + 3 || !w.endsWith(s)) continue;
      const kw = kws.find((x) => d.includes(x));
      if (kw) { push(q, i, "morph", "低", `${w} 字尾 -${s} 常被誤讀為「${kw}」，干擾項「${d}」含「${kw}」`); break; }
    }

    // ---- ctx ----
    const m = q.stem.match(/^(.*?)\{([^}]+)\}(.*)$/);
    const toks = (t) => (t.toLowerCase().match(/[a-z']+/g) || []);
    const before = toks(m[1]).slice(-1)[0], after = toks(m[3])[0];
    const dsenses = bySense.get(d) || bySense.get(d.replace(/的$/, "")) || [];
    for (const k of dsenses) {
      const o = VOCAB[k];
      if (k === q.word || !o || !o.ex || (o.pos || "").replace(/\./g, "") !== q.pos.replace(/\./g, "")) continue;
      const et = toks(o.ex), at = et.findIndex((t) => t.startsWith(k.slice(0, Math.max(3, k.length - 2))));
      if (at < 0) continue;
      const okB = before && !STOP.has(before) && et[at - 1] === before, okA = after && !STOP.has(after) && et[at + 1] === after;
      if (okB || okA) { push(q, i, "ctx", okB && okA ? "高" : "低", `「${d}」= ${k}；${k} 的例句「${o.ex}」中，它前後的字與題目句相同（${okB ? "前：" + before : ""}${okB && okA ? "、" : ""}${okA ? "後：" + after : ""}）`); break; }
    }
  });
}

const esc = (s) => /[",\n]/.test(s) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s);
const order = { 高: 0, 低: 1 };
rows.sort((a, b) => order[a[4]] - order[b[4]] || a[3].localeCompare(b[3]) || a[0].localeCompare(b[0]));
fs.writeFileSync(path.join(root, "data-src/dtype-candidates.csv"),
  "﻿" + [["word", "stem", "distractor", "建議類型", "信心", "理由"], ...rows].map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n");
const tally = {};
rows.forEach((r) => { const k = r[3] + "/" + r[4]; tally[k] = (tally[k] || 0) + 1; });
console.log(`${rows.length} candidate rows -> data-src/dtype-candidates.csv`, tally);
