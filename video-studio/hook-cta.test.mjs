// No paid calls: nullable Hook integration, read-only real draft diagnosis, existing display-only story capability.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './fixtures.mjs';
import { compileDraft } from './compiler.mjs';
import { validateProduction } from './production-validation.mjs';
import { freeVoicePlan } from './free-voice-plan.mjs';
import { loadCatalog } from './catalog.mjs';
import { root } from './server.mjs';
import { loadVoiceConfig } from '../scripts/video/voice/config.mjs';
import { prepareNarration } from '../scripts/video/voice/segments.mjs';
import { validateEpisode, linesFromNarration, linesFromPlan } from '../scripts/video/voice/episode-refs.mjs';
const json = rel => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const cfg = loadVoiceConfig();
const compile = f => compileDraft(f.draft, f.record, { seriesConfig: json('scripts/video/series.json') });

test('nullable Hook compiler preserves explicit null and Chinese text; invalid type blocks without throwing', () => {
  for (const zh of [null, '課堂準備開始了。']) {
    const f = fixture('single', zh), result = compile(f);
    assert.equal(result.artifacts.episode.hook.zh, zh);
    assert.equal(validateProduction(result.artifacts, cfg, result).verdict, 'PASS');
  }
  const f = fixture(); f.draft.decisions.hook.zh = false;
  assert.ok(compile(f).blocked.some(b => b.code === 'HOOK_ZH_INVALID'));
});

test('existing translation story part displays Chinese CTA with no narration/TTS unit (capability probe, not Studio source classification)', () => {
  const f = fixture('single', null), before = JSON.stringify(f.record), result = compile(f);
  const cta = '週末你們都去哪了';
  const beforeCount = result.artifacts.narration.segments.length;
  result.artifacts.episode.story.at(-1).parts.push({ type: 'translation', text: cta });
  assert.equal(validateProduction(result.artifacts, cfg, result).verdict, 'PASS');
  const prepared = prepareNarration(result.artifacts.narration, cfg, { requireApiKey: false, env: {} });
  assert.ok(prepared.segments.every(s => !(s.speak || '').includes(cta)));
  assert.equal(result.artifacts.narration.segments.length, beforeCount);
  const plan = freeVoicePlan(result.artifacts.narration, cfg, { has: () => false });
  assert.equal(plan.generatedThisRun, 0);
  assert.ok(plan.segments.every(s => !(s.text || '').includes(cta)));
  assert.equal(JSON.stringify(f.record), before);
});

test('all frozen references still validate against their unchanged narration and assembled plan', () => {
  for (const id of ['p2', 'p348', 'toeic-079', 'ielts-068']) {
    const episode = json(`scripts/video/episodes/${id}-auto.json`);
    const prepared = prepareNarration(json(`scripts/video/narration/${id}.json`), cfg, { requireApiKey: false, env: {} });
    assert.deepEqual(validateEpisode(episode, linesFromNarration(prepared)), [], id);
    assert.deepEqual(validateEpisode(episode, linesFromPlan(json(episode.plan.slice(1)))), [], id);
  }
});

test('real isolated elem-02 without explicit display-only confirmation: Chinese CTA still blocks (read-only)', t => {
  const file = path.join(root, 'video-studio/state/drafts/20ee16ed-e72f-4b06-9b4c-0387fc82b0f8.json');
  if (!fs.existsSync(file)) return t.skip('local draft is optional');
  const original = fs.readFileSync(file), draft = JSON.parse(original);
  // This test is the unconfirmed control, even after the owner later selects a source range in the live UI.
  draft.decisions.sourceDisplayOnly = [];
  const record = loadCatalog(root).records.get(draft.contentId);
  const result = compileDraft(draft, record, { seriesConfig: json('scripts/video/series.json') });
  assert.equal(result.artifacts.episode.hook.zh, null);
  assert.ok(result.blocked.some(b => b.code === 'MIXED_STORY_LANGUAGE'));
  assert.ok(result.blocked.every(b => !b.code.startsWith('HOOK_ZH')));
  const validation = validateProduction(result.artifacts, cfg, result);
  assert.ok(validation.errors.every(e => !e.message.includes('hook.zh')));
  assert.equal(validation.verdict, 'FAIL');
  assert.deepEqual(fs.readFileSync(file), original);
});
