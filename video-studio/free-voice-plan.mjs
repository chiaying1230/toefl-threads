import { prepareNarration } from '../scripts/video/voice/segments.mjs';
import { planNarration } from '../scripts/video/voice/generate.mjs';
import { createCache } from '../scripts/video/voice/cache.mjs';

export function freeVoicePlan(narration, voiceConfig, cache = createCache()) {
  const prepared = prepareNarration(narration, voiceConfig, { requireApiKey: false, env: {} });
  // Give the existing pure planner only a read capability. No synthesize/generate function is called.
  const plan = planNarration(prepared, { has: hash => cache.has(hash) });
  return {
    status: 'succeeded', mode: 'plan-only', generatedThisRun: 0, networkRequests: 0, productionReady: false,
    segmentCount: plan.segments.length, counts: plan.counts, charsToGenerate: plan.charsToGenerate,
    cacheMeaning: 'hit = MP3 與 alignment 檔都存在（既有 planner 的 has 語意）；未驗證音訊完整性。duplicate 不重複計費。',
    segments: plan.segments.map(s => ({ id: s.id, kind: s.kind, status: s.status, silent: Boolean(s.silent), chars: s.chars || 0, hash: s.hash || null, speaker: s.voiceName || null, voiceId: s.voice?.voiceId || null, model: s.voice?.model || null, language: s.lang || null, languageCode: s.voice?.languageCode ?? null, takeId: s.voice?.takeId ?? null, text: s.text || '', duration: s.duration || null, partIds: s.parts?.map(p => p.id) || [] })),
    playbackOrder: prepared.order,
  };
}
