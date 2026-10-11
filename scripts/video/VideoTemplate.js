// VideoTemplate: assembles the components for one episode.
//   hook → thread → word card → (also words) → quiz → outro
// The page calls init(spec) once and renderFrame(t) per frame; everything is a pure function of t.
import { L } from "./layout.js";
import { el, esc } from "./core.js";
import { createSpeech } from "./speech.js";
import { createIntroHook } from "./components/IntroHook.js";
import { createThreadScene } from "./components/ThreadScene.js";
import { createVocabularyCard } from "./components/VocabularyCard.js";
import { createAlsoWords } from "./components/AlsoWords.js";
import { createQuizScene } from "./components/QuizScene.js";
import { createOutro } from "./components/Outro.js";
import { createSubtitle } from "./components/Subtitle.js";
import { createMascot } from "./components/Mascot.js";
import { fadeWin, DUR } from "./motion.js";

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
  const S = spec.scenes;

  // header: series chip + episode number (hidden in the outro)
  const hdr = el("div", "hdr", null,
    `<div class="series"><span class="dot"></span><span>${esc(spec.series.name)}</span></div>` +
    (spec.episode != null ? `<div class="ep">EP.${String(spec.episode).padStart(2, "0")}</div>` : ""));
  stage.appendChild(hdr);

  const hook = createIntroHook(stage, spec);
  const vocab = createVocabularyCard(stage, spec);       // built before the thread: the thread needs its word slot
  const thread = createThreadScene(stage, spec, vocab);
  const also = createAlsoWords(stage, spec);
  const quiz = createQuizScene(stage, spec);
  const outro = createOutro(stage, spec);
  const sub = createSubtitle(stage, spec.cues);
  const mascot = createMascot(stage, speech, spec.mascot);

  return {
    render(t) {
      hdr.style.opacity = fadeWin(t, -1, S.outro.start, 0, DUR.fade);
      hook.update(t); thread.update(t); vocab.update(t); also.update(t); quiz.update(t); outro.update(t);
      sub.update(t); mascot.update(t);
    },
  };
}
