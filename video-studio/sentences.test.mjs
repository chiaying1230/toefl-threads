import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { splitSourceSentences } from './sentences.mjs';
import { compileDraft } from './compiler.mjs';
import { fixture } from './fixtures.mjs';
import { validateProduction } from './production-validation.mjs';
import { loadVoiceConfig } from '../scripts/video/voice/config.mjs';
import { root } from './server.mjs';
const seriesConfig = JSON.parse(fs.readFileSync(path.join(root, 'scripts/video/series.json'), 'utf8'));
for (const abbreviation of ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.']) test(`title ${abbreviation} preserves the complete sentence and one interrupted TTS`, () => {
  const f = fixture(), text = `I asked ${abbreviation} Smith to [[allocate]] supplies, and the class starts.`;
  f.record.post.text = text;
  const compiled = compileDraft(f.draft, f.record, { seriesConfig });
  assert.equal(validateProduction(compiled.artifacts, loadVoiceConfig(), compiled).verdict, 'PASS');
  const story = compiled.artifacts.narration.segments.filter(s => s.id.startsWith('story'));
  assert.equal(story.length, 1); assert.equal(story[0].parts.length, 2);
  assert.ok(story[0].text.includes(`${abbreviation} Smith`));
});
for (const abbreviation of ['e.g.', 'i.e.']) test(`explanatory ${abbreviation} stays in one sentence / one TTS`, () => {
  const f = fixture(); f.record.post.text = `We [[allocate]] supplies, ${abbreviation} books and pens.`;
  const compiled = compileDraft(f.draft, f.record, { seriesConfig });
  assert.equal(validateProduction(compiled.artifacts, loadVoiceConfig(), compiled).verdict, 'PASS');
  assert.equal(compiled.artifacts.narration.segments.filter(s => s.id.startsWith('story')).length, 1);
});
test('U.S. internal continuation is intact; handoff never cuts at an abbreviation period', () => {
  const f = fixture(); f.record.post.text = 'We [[allocate]] supplies for the U.S. office.';
  const compiled = compileDraft(f.draft, f.record, { seriesConfig });
  assert.equal(validateProduction(compiled.artifacts, loadVoiceConfig(), compiled).verdict, 'PASS');
  const story = compiled.artifacts.narration.segments.filter(s => s.id.startsWith('story'));
  assert.equal(story.length, 1); assert.equal(story[0].parts, undefined);
  assert.equal(compiled.mapping[0].boundary, 'office.');
});
test('ambiguous dotted abbreviations, orphan titles / explanations and unknown initials BLOCK', () => {
  for (const text of ['We live in the U.S. We go home.', 'Visit the U.S. Army.', 'I asked Dr. I went home.', 'I asked Dr.', 'For example, e.g.', 'I met J. Smith.']) {
    const result = splitSourceSentences(text);
    assert.ok(result.blocked.some(e => e.code === 'SENTENCE_BOUNDARY_UNRESOLVED'), text);
  }
  const f = fixture(); f.record.post.text = 'We [[allocate]] supplies in the U.S. We go home.';
  const compiled = compileDraft(f.draft, f.record, { seriesConfig });
  assert.equal(validateProduction(compiled.artifacts, loadVoiceConfig(), compiled).verdict, 'FAIL');
});
test('numeric clock times, time zones, quotes and natural following sentences retain source ranges', () => {
  for (const text of ['Dr. Smith arrived at 3 p.m. We went home.', 'Mrs. Smith arrived at 9 a.m. They left.', 'Dr. Smith arrived at 3 p.m. EST, then left.', '“Mr. Holmes is here.” We left.']) {
    const result = splitSourceSentences(text);
    assert.deepEqual(result.blocked, [], text);
    assert.equal(result.sentences.map(s => s.segment).join(''), text);
    for (const s of result.sentences) assert.equal(text.slice(s.index, s.index + s.segment.length), s.segment);
  }
  assert.equal(splitSourceSentences('Dr. Smith arrived at 3 p.m. We went home.').sentences.length, 2);
});
