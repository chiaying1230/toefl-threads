// All timing and easing for the series lives here. Components never hard-code a duration.
import { clamp } from "./core.js";

export const DUR = {
  fast: 0.18,       // small reveals (tags, hints)
  base: 0.3,        // most entrances
  slow: 0.5,        // hook marker sweep
  fade: 0.22,       // scene cross-fades
  swipe: 0.55,         // the feed moves up to the next item
};
export const RISE = 22;   // px an element slides up while entering

export const ease = {
  out: (p) => 1 - Math.pow(1 - p, 3),
  inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  linear: (p) => p,
};

// 0→1 progress of an animation that starts at t0 and lasts d seconds
export function prog(t, t0, d = DUR.base, fn = ease.out) { return fn(clamp((t - t0) / d, 0, 1)); }

// Opacity for something visible in [start, end] with fades at both ends
export function fadeWin(t, start, end, inD = DUR.fade, outD = DUR.fade) {
  return clamp(Math.min((t - start) / (inD || 1e-6), (end - t) / (outD || 1e-6)), 0, 1);
}

// Entrance: fade + small rise. Returns inline style values to apply.
export function enter(el, t, t0, d = DUR.base, rise = RISE) {
  const p = prog(t, t0, d);
  el.style.opacity = p;
  el.style.transform = `translateY(${(1 - p) * rise}px)`;
  return p;
}
