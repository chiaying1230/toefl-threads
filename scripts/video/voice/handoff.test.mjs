// Offline tests: the handoff boundary. A narration part may say `after: "<vocabulary's last word>"`; the sentence is then
// interrupted at the nearest natural punctuation boundary at or after that word instead of right after it. `through` (cut
// exactly here) keeps working unchanged: the accepted P2 / P3 narrations are written with it and must come out the same.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ConfigError, REPO_ROOT, loadVoiceConfig } from "./config.mjs";
import { loadNarration, prepareNarration } from "./segments.mjs";
import { linesFromPlan, validateEpisode } from "./episode-refs.mjs";

const env = { ELEVENLABS_API_KEY: "sk_0123456789abcdef0123456789abcdef" };
const cfg = { provider: "elevenlabs", output: { format: "mp3_44100_128" }, voices: { arthur: { voiceId: "A1", lang: "en", model: "m", settings: { stability: 0 } } }, roles: { story: "arthur" } };
const prep = (segments) => prepareNarration({ id: "t", segments }, cfg, { env });
const sentence = (text, first, extra = {}) => prep([{ id: "s", kind: "story", text, parts: [{ id: "lead", ...first }, { id: "rest", resumeAfter: "ins" }], ...extra }, { id: "ins", kind: "story", text: "Inserted." }]).segments[0];
const texts = (seg) => seg.parts.map((p) => p.text);
const bad = (text, first, re) => assert.throws(() => sentence(text, first), (e) => e instanceof ConfigError && re.test(e.message));

const WORSE = "Worse, I was consumed with spying on their queen, so I forgot to check my own honey sales.";

test("after: the note goes at the next comma after the vocabulary, not right after it", () => {
  const seg = sentence(WORSE, { after: "with" });
  assert.deepEqual(texts(seg), ["Worse, I was consumed with spying on their queen,", "so I forgot to check my own honey sales."]);
  assert.equal(seg.parts[0].boundary, "queen,");
  assert.equal(seg.parts[0].after, "with");
  // the same sentence cut right after "with" (through) is still possible and is not the same cut
  assert.deepEqual(texts(sentence(WORSE, { through: "with" })), ["Worse, I was consumed with", "spying on their queen, so I forgot to check my own honey sales."]);
});

test("after: a vocabulary that already carries punctuation is cut right there (no extra delay)", () => {
  assert.deepEqual(texts(sentence("But a witness, me, saw everything.", { after: "witness" })), ["But a witness,", "me, saw everything."]);
  assert.deepEqual(texts(sentence("Is it a game? No, it is a duel.", { after: "game" })), ["Is it a game?", "No, it is a duel."]);
  assert.deepEqual(texts(sentence("We met; we talked; we left.", { after: "met" })), ["We met;", "we talked; we left."]);
  assert.deepEqual(texts(sentence("He said: stop now.", { after: "said" })), ["He said:", "stop now."]);
});

test("after: closing quotes / brackets after the punctuation belong to the boundary", () => {
  assert.deepEqual(texts(sentence("She said “wait,” and then left quickly.", { after: "wait" })), ["She said “wait,”", "and then left quickly."]);
  assert.deepEqual(texts(sentence("It ended (finally.) Then we slept.", { after: "ended" })), ["It ended (finally.)", "Then we slept."]);
});

test("after: no punctuation before the end of the sentence → error that says the note goes after the whole sentence", () => {
  bad("It has become a game of cat and mouse that wastes time for both of us.", { after: "mouse" }, /no punctuation boundary after "mouse".*plain segment/);
  bad("He was found guilty.", { after: "guilty" }, /no punctuation boundary after "guilty"/);
  bad("I decided to allocate ninety percent of the budget.", { after: "allocate" }, /plain segment/);
});

test("after / through: exactly one of them; the word has to exist; the last part has neither", () => {
  bad(WORSE, { after: "with", through: "with" }, /not both/);
  bad(WORSE, { after: "zebra" }, /word "zebra" not found/);
  bad(WORSE, {}, /"through" .* or "after" .* is required/);
  assert.throws(() => prep([{ id: "s", kind: "story", text: WORSE, parts: [{ id: "a", after: "with" }, { id: "b", resumeAfter: "ins", after: "sales" }] }, { id: "ins", kind: "story", text: "x" }]), (e) => /last part must not have/.test(e.message));
});

test("after: the cut never changes the audio hash (the sentence is still one take)", () => {
  const a = sentence(WORSE, { after: "with" }), b = sentence(WORSE, { through: "with" });
  assert.equal(a.hash, b.hash);
  assert.equal(a.speak, WORSE);
});

test("P2 / P3 narrations (written with `through`) still come out as accepted: same parts as their manifests", (t) => {
  for (const id of ["p2", "p348"]) {
    const file = path.join(REPO_ROOT, `scripts/video/narration/${id}.json`), man = path.join(REPO_ROOT, `scripts/video/narration/${id}.manifest.json`);
    if (!fs.existsSync(file) || !fs.existsSync(man)) return t.skip(`${id} not present`);
    const prepared = prepareNarration(loadNarration(file), loadVoiceConfig(), { requireApiKey: false }), manifest = JSON.parse(fs.readFileSync(man, "utf8"));
    for (const seg of prepared.segments.filter((s) => s.parts)) {
      const saved = manifest.segments.find((s) => s.id === seg.id);
      assert.deepEqual(seg.parts.map((p) => [p.id, p.text, p.gap]), saved.parts.map((p) => [p.id, p.text, p.gap]), `${id}/${seg.id}`);
      assert.equal(seg.hash, saved.hash, `${id}/${seg.id} hash`);
      assert.ok(seg.parts.every((p) => p.boundary === undefined), "`through` parts carry no boundary");
    }
  }
});

// ---- the episode side: the note opens on the last word before the pause ----
const haveP4 = fs.existsSync(path.join(REPO_ROOT, "docs/toeic-079-auto/toeic-079-auto.plan.json")) && fs.existsSync(path.join(REPO_ROOT, "scripts/video/episodes/toeic-079-auto.json"));
const p4 = () => ({ episode: JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "scripts/video/episodes/toeic-079-auto.json"), "utf8")), lines: linesFromPlan(JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "docs/toeic-079-auto/toeic-079-auto.plan.json"), "utf8"))) });
const check = ({ episode, lines }) => { const warnings = []; return { problems: validateEpisode(episode, lines, { warnings }), warnings }; };
const has = (list, re) => assert.ok(list.some((p) => re.test(p)), `expected ${re}, got:\n${list.join("\n")}`);

test("toeic-079: phrase highlighted inside the line, note opens on the last word of the line (queen / us) – valid", (t) => {
  if (!haveP4) return t.skip("toeic-079 files not present");
  assert.deepEqual(check(p4()), { problems: [], warnings: [] });
});

test("validator: open.word may be inside the phrase or the last word of the line – not a word in between", (t) => {
  if (!haveP4) return t.skip();
  const consumed = (x) => x.episode.vocabulary.find((v) => v.id === "consumedNote");
  let x = p4(); consumed(x).open = { line: "consumedLead", word: "with" };       // inside the phrase: still valid
  assert.deepEqual(check(x).problems, []);
  x = p4(); consumed(x).open = { line: "consumedLead", word: "spying" };        // between the phrase and the pause
  has(check(x).problems, /open\.word: "spying".*neither inside the highlighted phrase nor the last word of the line/);
  x = p4(); consumed(x).open = { line: "consumedLead", word: "queen" };         // the handoff boundary
  assert.deepEqual(check(x).problems, []);
});
