// IntroHook (0–3 s): the funniest sentence of the post, big, on plain paper.
// No app chrome, no logo screen. The key word gets a yellow marker that sweeps in.
// The guide line ("這句英文你看得懂嗎？") is a Subtitle cue, not part of this component.
import { L } from "../layout.js";
import { el, esc, fitFont } from "../core.js";
import { DUR, fadeWin, prog } from "../motion.js";
import { marker } from "./KaraokeText.js";

export function createIntroHook(root, spec) {
  const s = spec.scenes.hook, a = spec.char;
  const layer = el("div", "scene");
  const group = el("div", "hook-group");
  const who = el("div", "hook-who", null,
    `<div class="hook-av" style="background:${esc(a.color)}">${a.avatar}</div><div class="hook-handle">${esc(a.name)} · @${esc(a.handle)}</div>`);
  const body = el("div", "hook-s");
  body.innerHTML = s.tokens.map((k) => `<span class="tk${k.role === "main" ? " main" : ""}">${esc(k.text)}</span>`).join(" ");
  group.append(who, body);
  layer.appendChild(group);
  root.appendChild(layer);
  fitFont(body, 650, [108, 100, 92, 84, 76, 68, 60]);
  const main = body.querySelector(".main");

  function update(t) {
    layer.style.opacity = fadeWin(t, -1, s.end, 0, DUR.fade);   // visible from the very first frame
    if (main) { Object.assign(main.style, marker(prog(t, 0.35, DUR.slow))); main.style.color = "var(--c-text)"; }
  }
  return { update };
}
