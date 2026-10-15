import { prepareNarration } from '../scripts/video/voice/segments.mjs';
import { linesFromNarration, validateEpisode } from '../scripts/video/voice/episode-refs.mjs';
import { issue } from './compiler.mjs';

export function validateProduction({ narration, episode }, voiceConfig, compileReport) {
  const warnings = [], errors = [...compileReport.blocked];
  let prepared;
  try { prepared = prepareNarration(narration, voiceConfig, { requireApiKey: false, env: {} }); }
  catch (e) { for (const message of e.problems || [e.message]) errors.push(issue('NARRATION_VALIDATION_FAILED', 'narration', message)); }
  if (prepared) {
    for (const message of validateEpisode(episode, linesFromNarration(prepared), { warnings })) errors.push(issue('EPISODE_VALIDATION_FAILED', 'episode', message));
  }
  return {
    status: errors.length ? 'failed' : 'succeeded', verdict: errors.length ? 'FAIL' : 'PASS', scope: 'narration-schema-and-episode-references',
    errors, warnings: warnings.map(message => issue('SHARED_VALIDATOR_WARNING', 'episode', message)),
    unresolved: compileReport.unresolved, productionReady: false,
    checks: { narration: Boolean(prepared), episode: Boolean(prepared) && !errors.some(e => e.code === 'EPISODE_VALIDATION_FAILED'), compilerDecisions: !compileReport.blocked.length },
  };
}
