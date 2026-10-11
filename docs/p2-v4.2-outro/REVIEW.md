# P2 V4.2 — Outro / reference template

最新配樂版：[p2-v4.2-outro-music.mp4](../../outputs/p2-v4.2-outro-music.mp4)。依後續要求新增原創 94 BPM 無人聲配樂：柔和鍵盤撥奏、低音與輕刷節奏。旁白期間維持低音量，24.7 秒旁白結束後平滑抬升，最後 0.8 秒收尾；保留答案揭曉音效。音樂設定與資產路徑放在 episode JSON。`music-verification.json` 確認畫面資料完全一致、原始旁白檔未更改、旁白混音增益為 1、全片解碼通過且無數位削波（混音峰值約 −2.88 dBFS）。混音後音軌包含配樂，因此不再與無配樂版 PCM 相等。

測試影片：[p2-v4.2-outro.mp4](../../outputs/p2-v4.2-outro.mp4)。31.333 秒，1080 × 1920，30 fps。新增片尾 2.4 秒，原 V4.2 保留。

最新有答對音效版：[p2-v4.2-outro-sfx.mp4](../../outputs/p2-v4.2-outro-sfx.mp4)。依後續要求，27.650 秒答案揭曉時加入 0.48 秒柔和的上行雙音提示；沒有更改旁白、畫面或時間。音效資產及 gain／時間參照放在 episode JSON。`sfx-verification.json` 確認畫面 H.264 資料完全一致、前 24.7 秒旁白解碼 PCM 完全一致、全片可完整解碼；提示音峰值約 −21 dBFS。下方「沒有新增音效」敘述指原 Outro 版本，新的提示音只在 Quiz 答案揭曉出現。

Review sheet：[review-sheet.png](review-sheet.png)。手機尺寸：[phone-outro.png](phone-outro.png)。

## Outro

Quiz 答案先完整保留到原片結尾（28.933 秒），再將同一個白色串文視窗向下捲到 toEfu 回覆。深藍回覆導引線延續閱讀語言；allocate / arbitrary 使用黃色記憶重點；CTA 是「收藏這篇，記住這兩個字。」

既有豆腐 SVG 在收藏提示期間朝 CTA 看，書籤由深藍輪廓轉為黃色；完成引導後吉祥物離場，不持續佔用觀眾注意力。沒有新增片尾語音或音效，沿用原聲音與靜音尾段後延長 2.4 秒。

## 程式結構

- `scripts/video/episodes/p2-v42-outro.json`：episode 文案、故事段落、單字清單、詞義、例句中文、Quiz 選項／答案、Outro、音檔／alignment 路徑與時間參照。
- `scripts/video/reference/ReadingCue.js`：依原 alignment 的字元位置與時間顯示深藍朗讀底線。
- `scripts/video/reference/Components.js`：Hook、Vocabulary、Quiz／Answer reveal、Outro。
- `scripts/video/reference/PostTemplate.js`：白色串文 surface、段落組裝、yellow handoff、單字展開／收回、閱讀恢復與鏡頭導引。
- `scripts/video/reference/post.css`：原版樣式；`outro.css` 僅新增片尾樣式。
- `scripts/video/post-reference.html`：載入 JSON 與既有聲音／alignment 的入口。

故事英文、英文例句與中文朗讀詞義直接讀取原 alignment plan 的文字；沒有再在 component 寫一份 P2 文案。下一篇可換 episode JSON、audio 與同格式 alignment；仍需編輯段落順序、時間參照與鏡頭 offset，並做一次版面及節奏驗證。這是已驗證語言的 reference template，尚未承諾任意篇幅或題型可自動排好。

## 驗證

16 個原片代表時間點對照原 HTML；13 個畫面 PNG 完全一致，Hook 的 3 個畫面僅有 21 像素、每色頻最大 1/255 的 raster rounding 差異。940 個影格檢查文字水平溢出、active cue 邊界與穩定片尾邊界。

MP4 完整解碼、規格與音軌長度檢查，以及原版／新版前 24.7 秒可聽段 AAC 解碼 PCM 比對記錄在 `verification.json`。原版 Whisper 觀察時間與部分邊界修正的限制仍然成立；本輪沒有重新對齊或生成 TTS。

## Template Status

2026-10-11：使用者確認 [p2-v4.2-outro-music.mp4](../../outputs/p2-v4.2-outro-music.mp4) 為目前 short-video template 的 reference implementation。保留此可播放檔案，不覆寫；本輪只更新文件。

| 項目 | 狀態 | 範圍 |
|---|---|---|
| P2 visual language | validated | 目前 P2 視覺方向已由使用者確認 |
| Voice quality | validated | 目前 Arthur／Ling 聲音品質；不代表自動生成流程已驗證 |
| Template architecture | partially validated | P2 共通結構與資料已抽離；尚待全新 episode 驗證 |
| ElevenLabs automated voice pipeline | not yet validated | 待 Claude Code 完成 automation，再由 Codex review |
| Cross-episode reuse | not yet validated | 待上述 review 後，以一個全新 episode 做 template stress test |

Reference SHA256：`09b4cc3739ea15d251914f00b78fbf9416c713a7154f8fe9bbcf24d32fc55bd6`。舊版的測試／待聆聽敘述保留歷史意義，目前狀態以本表為準；voice quality 的確認不擴大解讀為逐字 alignment 或自動 voice pipeline 已完成驗證。

### A. 已經可以固定成模板的部分

白色 social post surface、暖中性環境、深藍閱讀／導引、黃色記憶 focus；按 alignment 的閱讀 cue；reading → target yellow handoff → 中文詞義 → English example → 收回 → reading resumes 的結構；資料化段落、單字清單、選項與答案；同視窗 Quiz → answer → 回覆式 Outro。既有音檔獨立於 layout。

固定聲音角色：Arthur = English story + English examples；Ling = Chinese vocabulary meaning。完整 viewing flow：Hook → Post reading → vocabulary yellow handoff → Chinese meaning → English example → return to story → Quiz → answer reveal → short Outro。深藍表示「現在看這裡」，黃色表示「這個要記住」。

### B. 目前仍應保持可調的部分

Vocabulary 數量、各自的展開／停留／收回時間；故事長度、段落順序、鏡頭 offset；Hook 動畫與形式（目前提供已驗證的數字揭曉結構）；Quiz 題型（目前實作文字選擇題）；Outro 文案／長度／CTA。筆與貓掌是本篇可選的情境反應，不是每篇必備。其他 Hook／Quiz 形式未假装已經支援，應在實際需求出現時小幅擴充。

P2 的所有具體 timing、Quiz duration 與 Outro duration 僅屬本篇設定；不得成為所有 episode 的固定規則。配樂 BPM／gain／收尾與答對提示音時間亦是目前 reference 的選擇，不鎖定為全域參數。

### C. 下一篇 episode 要驗證的部分

不同長度串文是否只換資料與音檔即可保持可讀性；超過兩個單字及較長 target 的換行／handoff；不同詞性、詞義與例句長度的 vocabulary 高度；鏡頭 offset 是否需要較少人工調整；不同 Hook／Quiz 題型的必要變體；CTA 是否符合該篇記憶目標。每篇仍以清楚與自己的語音節奏為優先，不能把固定停留時間套到所有 episode。

後續順序：Claude Code 完成 ElevenLabs voice automation → Codex review → 一個全新 episode 的 template stress test。此處只記錄待辦，本輪不開始新 episode、不修改 voice pipeline、不建立 Director／Skill，也不做視覺 polish。

## 重現

從 repo root 執行（需要現有 Playwright／Edge／ffmpeg／Pillow，無新增依賴）：

```text
node scripts/render-p2-v42-outro.mjs
python scripts/video/verify-p2-v42-outro.py
python scripts/video/add-p2-answer-sfx.py
python scripts/video/add-p2-music.py
```

沒有執行原 prepare 腳本；沒有改 App 或其他 episodes；沒有建立 V5、Director、Skill 或批次 pipeline。
