// Browser-side copy of zhParts (text.mjs is Node-side). "任意的；武斷的（形容詞）" → { main, note }
export function zhParts(zh) {
  const m = zh.match(/^(.*?)\s*[（(]([^）)]*)[）)]\s*$/);
  return m ? { main: m[1], note: m[2] } : { main: zh, note: "" };
}
