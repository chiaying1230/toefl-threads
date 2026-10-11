// VideoTemplate: assembles the components for one episode.
//
//   hook → stream (read chunk → word card → read chunk → word card …) → recap → quiz → ending
//
// The stream and its word cards are one scene: cards open over the dimmed stream and the taught word travels
// out of the sentence and back (WordHandoff), so the viewer never leaves the post.
// The page calls init(spec) once and renderFrame(t) per frame; everything is a pure function of t.
import { el, esc } from "./core.js";
import { createSpeech } from "./speech.js";
import { createIntroHook } from "./components/IntroHook.js";
import { createThreadScene } from "./components/ThreadScene.js";
import { createVocabularyCard } from "./components/VocabularyCard.js";
import { createHandoff } from "./components/WordHandoff.js";
import { createRecap } from "./components/Recap.js";
import { createQuizScene } from "./components/QuizScene.js";
import { createEnding } from "./components/Ending.js";
import { createSubtitle } from "./components/Subtitle.js";
import { createMascot } from "./components/Mascot.js";

const FACES = ['500 20px "Noto Sans TC"', '700 20px "Noto Sans TC"', '900 20px "Noto Sans TC"', '400 20px "DM Serif Display"',
  '500 20px "DM Sans"', '600 20px "DM Sans"', '700 20px "DM Sans"', '800 20px "DM Sans"'];

export async function mount(spec) {
  const stage = document.getElementById("stage");
  stage.innerHTML = "";
  // fonts first: every fit() below measures real glyphs
  const all = JSON.stringify(spec);
  await Promise.all(FACES.map((f) => document.fonts.load(f, all)));
  await document.fonts.ready;

  const speech = createSpeech(spec.lines);

  // header: series chip + episode number, for the whole video (the brand is this chip, not a logo page)
  const hdr = el("div", "hdr", null,
    `<div class="series"><span class="dot"></span><span>${esc(spec.series.name)}</span></div>` +
    (spec.episode != null ? `<div class="ep">EP.${String(spec.episode).padStart(2, "0")}</div>` : ""));
  stage.appendChild(hdr);

  const hook = createIntroHook(stage, spec);
  const stream = createThreadScene(stage, spec);
  const cards = spec.scenes.flow.cards.map((c) => {
    const vc = createVocabularyCard(stage, spec, c);       // one card for every taught word
    return { vc, handoff: createHandoff(stage, stream, vc, c) };
  });
  const recap = createRecap(stage, spec);
  const quiz = createQuizScene(stage, spec);
  const ending = createEnding(stage, spec);
  const sub = createSubtitle(stage, spec.cues);
  const mascot = createMascot(stage, speech, spec.mascot);

  return {
    render(t) {
      hook.update(t); stream.update(t);
      cards.forEach((x) => { x.vc.update(t); x.handoff.update(t); });
      recap.update(t); quiz.update(t); ending.update(t);
      sub.update(t); mascot.update(t);
    },
  };
}
