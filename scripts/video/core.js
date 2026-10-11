// Small shared helpers (no dependencies).
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, p) => a + (b - a) * p;
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };

// el("div", "class names", { top: "10px" }, "inner html")
export function el(tag, cls, style, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (style) Object.assign(e.style, style);
  if (html != null) e.innerHTML = html;
  return e;
}

// Largest font size from `sizes` (descending) whose content fits in maxH px.
// Call after fonts are loaded; returns the chosen size.
export function fitFont(e, maxH, sizes) {
  let chosen = sizes[sizes.length - 1];
  for (const s of sizes) { e.style.fontSize = s + "px"; if (e.scrollHeight <= maxH + 1) { chosen = s; break; } }
  e.style.fontSize = chosen + "px";
  return chosen;
}

// Same idea for a single line: shrink until it fits maxW.
export function fitWidth(e, maxW, sizes) {
  let chosen = sizes[sizes.length - 1];
  for (const s of sizes) { e.style.fontSize = s + "px"; if (e.scrollWidth <= maxW + 1) { chosen = s; break; } }
  e.style.fontSize = chosen + "px";
  return chosen;
}

// Largest size from `sizes` (descending) at which the text fits in `maxLines` lines (line-height `lh`).
// Falls back to the smallest size.
export function fitLines(e, sizes, maxLines, lh) {
  let chosen = sizes[sizes.length - 1];
  for (const s of sizes) { e.style.fontSize = s + "px"; if (e.scrollHeight <= s * lh * maxLines + 4) { chosen = s; break; } }
  e.style.fontSize = chosen + "px";
  return chosen;
}

export const rect = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
