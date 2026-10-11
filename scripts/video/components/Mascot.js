// The tofu mascot (drawn from icon.svg, plus a mortarboard).
//
// Rules (docs/video-design-system.md):
//  - one slot, bottom-left, 240 px; it never wanders
//  - it shows up only when it has a job: explaining a word, asking the quiz, signing off
//  - it speaks with its mouth; when talking it nods slightly with the (smoothed) loudness
//  - poses: "talk" (default) and "think" (quiz: pupils up-right, head tilted)
import { L } from "../layout.js";
import { clamp } from "../core.js";
import { prog, DUR } from "../motion.js";

const SVG = `
<svg id="mascot-svg" viewBox="0 0 64 64" width="240" height="240" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="32" cy="58" rx="22" ry="3.5" fill="#000" opacity=".12"/>
  <rect x="8" y="18" width="48" height="38" rx="12" fill="#E9D3A3"/>
  <rect x="8" y="12" width="48" height="38" rx="12" fill="#FFF6E0" stroke="#E7CF9C" stroke-width="1.5"/>
  <path d="M17 19h12" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
  <g id="m-eyes">
    <g class="eye"><circle class="pupil" cx="23.5" cy="31" r="3" fill="#3B2F2F"/><circle class="shine" cx="24.5" cy="30" r="1" fill="#fff"/></g>
    <g class="eye"><circle class="pupil" cx="40.5" cy="31" r="3" fill="#3B2F2F"/><circle class="shine" cx="41.5" cy="30" r="1" fill="#fff"/></g>
  </g>
  <ellipse cx="17.5" cy="37" rx="4" ry="2.4" fill="#FFB4A8"/><ellipse cx="46.5" cy="37" rx="4" ry="2.4" fill="#FFB4A8"/>
  <path id="m-smile" d="M28.5 37.5q3.5 3.5 7 0" stroke="#3B2F2F" stroke-width="2" fill="none" stroke-linecap="round"/>
  <g id="m-mouth" transform="translate(32 38.5)" style="display:none"><ellipse id="m-mo" rx="3.6" ry="2" fill="#7a2e2e"/><ellipse id="m-tg" cy="1" rx="2.2" ry="1" fill="#ff8f8f"/></g>
  <g transform="translate(32 12)">
    <polygon points="-17,0 0,-7.5 17,0 0,7.5" fill="#2f3b52"/><path d="M-8 3.5v5.5q8 4 16 0v-5.5" fill="#3b4a68"/>
    <path d="M14 0.5v8" stroke="#FFD66B" stroke-width="1.4" stroke-linecap="round"/><circle cx="14" cy="9.5" r="1.6" fill="#FFD66B"/>
  </g>
</svg>`;

// show: [{ start, end, pose }]  – intervals when the mascot is on screen
export function createMascot(root, speech, show) {
  const m = document.createElement("div");
  m.id = "mascot"; m.innerHTML = SVG;
  Object.assign(m.style, { left: L.mascot.x + "px", top: L.mascot.y + "px" });
  root.appendChild(m);
  const $ = (id) => m.querySelector("#" + id);

  function update(t) {
    const w = show.find((s) => t >= s.start - 0.01 && t <= s.end + 0.01);
    // visible across consecutive intervals without re-entering
    const first = show[0].start, last = show[show.length - 1].end;
    const within = t >= first && t <= last;
    if (!within) { m.style.opacity = 0; return; }
    const inP = prog(t, first, DUR.base), outP = 1 - prog(t, last - DUR.fade, DUR.fade);
    m.style.opacity = Math.min(inP, outP);
    const pose = (w && w.pose) || "talk";
    const raw = speech.raw(t, "host"), lv = speech.level(t, "host", 0.2), up = clamp(lv * 1.8, 0, 1);
    const tilt = pose === "think" ? -5 : 0;
    m.style.transform = `translateY(${(1 - inP) * 30 - up * 6}px) rotate(${tilt + Math.sin(t * 3) * up * 1.5}deg)`;
    // mouth
    const mouth = $("m-mouth"), smile = $("m-smile");
    if (raw > 0.08) {
      const o = clamp(raw * 1.25, 0, 1);
      smile.style.display = "none"; mouth.style.display = "";
      $("m-mo").setAttribute("ry", (0.7 + o * 3.4).toFixed(2));
      $("m-mo").setAttribute("rx", (3.2 + o * 0.8).toFixed(2));
      $("m-tg").setAttribute("cy", (0.6 + o * 1.1).toFixed(2));
      $("m-tg").setAttribute("ry", (0.3 + o * 1.1).toFixed(2));
    } else { smile.style.display = ""; mouth.style.display = "none"; }
    // blink every ~3.1 s; "think" glances up-right
    const b = t % 3.1, blink = b < 0.12 ? Math.sin((b / 0.12) * Math.PI) : 0;
    [...$("m-eyes").children].forEach((e) => e.setAttribute("transform", `translate(0 ${31 * blink}) scale(1 ${1 - 0.9 * blink})`));
    const gx = pose === "think" ? 1.1 : 0, gy = pose === "think" ? -1.1 : 0;
    m.querySelectorAll(".pupil").forEach((p) => { p.style.transform = `translate(${gx}px,${gy}px)`; });
    m.querySelectorAll(".shine").forEach((p) => { p.style.transform = `translate(${gx}px,${gy}px)`; });
  }
  return { update };
}
