// Word-by-word highlighted text, used for the thread card, example sentences and subtitles.
//
// Look (one rule set for the whole series):
//   spoken words   ink
//   current word   soft yellow marker
//   upcoming words muted
//   key words      yellow marker, always on  (role "main" = solid, role "also" = underline only)
import { esc } from "../core.js";

export function marker(p = 1, color = "var(--c-accent)", thick = ".55em") {
  return {
    backgroundImage: `linear-gradient(${color},${color})`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "0 92%",
    backgroundSize: `${(p * 100).toFixed(1)}% ${thick}`,
  };
}

export function karaoke(host, tokens, { zh = false } = {}) {
  host.innerHTML = tokens.map((k, i) =>
    `<span class="tk" data-i="${i}">${esc(k.text)}</span>${!zh && i < tokens.length - 1 ? " " : ""}`).join("");
  const spans = [...host.querySelectorAll(".tk")];
  if (zh) spans.forEach((sp) => { sp.style.whiteSpace = "nowrap"; });     // Chinese words never break in the middle
  function update(t) {
    spans.forEach((sp, i) => {
      const k = tokens[i], on = t >= k.s, cur = t >= k.s && t < k.e + 0.06;
      const st = sp.style;
      if (k.ell) {                       // "…" marks a skipped stretch: shown, never highlighted
        st.backgroundImage = "none"; st.color = "var(--c-text-3)"; st.fontWeight = ""; st.opacity = 1;
      } else if (k.role === "main" || k.role === "taught") {   // every taught word looks the same
        Object.assign(st, marker(1));
        st.fontWeight = 800; st.color = "var(--c-text)"; st.opacity = 1;
      } else {
        st.backgroundImage = cur ? "linear-gradient(var(--c-accent-soft),var(--c-accent-soft))" : "none";
        st.backgroundSize = "100% 100%"; st.backgroundPosition = "0 0";
        st.fontWeight = ""; st.color = on ? "var(--c-text)" : "var(--c-text-3)"; st.opacity = 1;
      }
    });
  }
  return { spans, update };
}
