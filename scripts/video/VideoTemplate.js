// VideoTemplate: assembles the feed for one episode.
//
//   hook ↑ post ↑ word card ↑ post (continued) ↑ word card ↑ recap ↑ quiz (dark) ↑ ending (+ next post peeking)
//
// One tall column of items, one camera (Feed.js). The page calls init(spec) once and renderFrame(t) per frame;
// everything is a pure function of t.
import { el, esc } from "./core.js";
import { createSpeech } from "./speech.js";
import { createFeed } from "./Feed.js";
import * as I from "./components/FeedItems.js";
import { createSubtitle } from "./components/Subtitle.js";
import { createMascot } from "./components/Mascot.js";

const FACES = ['500 20px "Noto Sans TC"', '700 20px "Noto Sans TC"', '900 20px "Noto Sans TC"', '400 20px "DM Serif Display"',
  '500 20px "DM Sans"', '600 20px "DM Sans"', '700 20px "DM Sans"', '800 20px "DM Sans"'];

export async function mount(spec) {
  const stage = document.getElementById("stage");
  stage.innerHTML = "";
  await Promise.all(FACES.map((f) => document.fonts.load(f, JSON.stringify(spec))));
  await document.fonts.ready;

  const speech = createSpeech(spec.lines);
  const hdr = el("div", "hdr", null,
    `<div class="series"><span class="dot"></span><span>${esc(spec.series.name)}</span></div>` +
    (spec.episode != null ? `<div class="ep">EP.${String(spec.episode).padStart(2, "0")}</div>` : ""));
  stage.appendChild(hdr);

  const make = { hook: I.createHook, post: I.createPost, card: I.createCard, recap: I.createRecap, quiz: I.createQuiz, ending: I.createEnding, teaser: I.createTeaser };
  const items = spec.scenes.feed.items.map((it) => ({ id: it.id, anchor: it.anchor, bg: it.bg, type: it.type, api: make[it.type](it, spec) }));
  const feed = createFeed(stage, hdr, items, spec.scenes.feed.moves);
  const sub = createSubtitle(stage, spec.cues);
  const mascot = createMascot(stage, speech, spec.mascot);
  stage.appendChild(hdr);

  return {
    state: null, focusEl: null,
    render(t) {
      this.state = feed.update(t);
      this.focusEl = items.find((x) => x.id === this.state.focus).api.el;
      sub.update(t); mascot.update(t);
    },
  };
}
