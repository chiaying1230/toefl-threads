# p2 V4.2 — ElevenLabs 整合測試

**狀態：整合成品與自動驗證完成；實際聆聽的音畫同步驗收尚未完成。**

## 成品與範圍

`p2-v4.2.mp4`：28.933 秒、1080×1920、30fps、868 格、H.264 / AAC。
僅新增 scripts/ 與 docs/p2-v4.2/，未改 App、其他 episodes 或故事文案。專案只找到 p2-v4，未找到獨立 V4.1；以現有 V4 視覺作基底建立 V4.2，保留原版。

保留白色串文視窗、固定作者與 metadata、inline 單字展開、例句／中文翻譯、撥筆與貓掌動畫、arbitrary 情節提示、同視窗 Quiz。
一般英文 active cue 使用深藍底線；學習字維持黄色，朗讀當下也有深藍線，朗讀後留下黃色記憶重點。中文詞義為整組聚焦，未偽造逐中文字的辨識。

## 使用的音訊

唯一旁白來源：
`C:\Users\123\Documents\Codex\2026-10-11\referenced-chatgpt-conversation-this-is-an-2\outputs\arthur-ling-examples-test.mp3`

沒有重新合成 TTS、沒有使用 SAPI 聲音、沒有新增依賴、沒有調速或重剪指定 MP3。解碼為 WAV 後只補 Quiz 所需靜音尾段，再由渲染器編碼 AAC。
指定音軌 24.700068 秒，含故事、兩段中文詞義、兩段英文例句，不含「什麼意思？」或「武斷的」測驗旁白。Quiz 保留原文字、靜音呈現；27.650 秒揭曉答案。這項取捨避免新增未授權語音。

## 時間對齊方法與可追溯證據

既有工作資料保留 Arthur、Ling、examples 的原始 MP3、Whisper 逐詞時間戳、merge.py 與 merged.wav。
prepare-p2-v42.py 使用相同振幅門檻、裁切、淡入淡出與間隔，重建七段 edit list，逐樣本比對原 merged.wav 完全相等。指定 MP3 解碼後與重建 PCM 的相關係數為 0.9999555854；長度逐樣本相等。來源 SHA256 與 edit list 存在 alignment-provenance.json。

英文詞時間戳由原始音檔觀測值經精確剪輯位移轉換，轉成既有渲染器的 start/end/duration 與 words.at/until/pos/count/text。原故事文案為權威，辨識中的 90 / % 映射回 ninety / percent；只修正映射，未更改故事。

限制：Whisper 是辨識觀測，不是具有誤差上限的 forced alignment。budget 的 ninety 辨識起点落在原剪接點之前，依真實剪接點限制其最早起点；這個詞最需要聆聽複核。中文辨識有錯字，未用錯字覆寫文案，而採已知音訊片段與詞義組的 phrase timing。不能從結構檢查宣稱逐詞已達人耳可接受的精度。

| 事件 | 時間（秒） |
|---|---:|
| allocate 讀到／開始展開 | 3.945 |
| allocate 中文詞義 | 4.649–6.014 |
| allocate 英文例句 | 6.314–8.229 |
| 回故事 budget | 8.699 |
| CFO | 12.335 |
| 撥筆句 | 14.255–15.775 |
| arbitrary 讀到／開始展開 | 18.855 |
| arbitrary 中文詞義 | 19.855–21.567 |
| arbitrary 英文例句 | 21.975–23.235 |
| Meeting adjourned | 23.875–24.630 |
| 音軌結束 | 24.700 |
| Quiz 進場 | 24.850 |
| 2 秒思考 | 25.650–27.650 |
| B 答案揭曉 | 27.650 |

## 驗證

- 完整 MP4 音畫解碼通過，視頻與音訊時長差小於一格。
- 全 868 格 active cue 裁切與水平溢出檢查無問題。
- 47 個英文詞事件順序／音檔範圍與全部片段順序通過。
- 全片每 0.5 秒 chronological sheet 與 14 個代表畫面已檢視；單字展開、例句、故事恢復、撥筆、Quiz 的畫面銜接保留。
- 內建瀏覽器連接播放頁逾時。另以既有 Edge/Playwright 執行完整實時播放，證據見 playback-verification.json；這是播放器驗證，工具沒有音訊感知通道，不能視為已實際聆聽或完整人工觀看。
- 最終音畫同步的聆聽驗收仍待完成，尤其 budget 的 ninety、兩個單字 yellow handoff 與中文詞義起止。此版本為待聆聽驗收的整合測試，沒有標為正式定稿。

## 重現

在 C:\Users\123\toefl-threads 執行既有 bundled Python / Node：

```text
python scripts/video/prepare-p2-v42.py
node scripts/render-p2-v42.mjs
python scripts/video/verify-p2-v42.py
node scripts/video/playback-p2-v42.mjs
```

prepare 使用前次工作目錄作來源；上述來源檔需保留。無下載或安裝步驟。
人類可直接播放 MP4；有聲 HTML 預覽是 scripts/video/p2-v42.html?preview=1，依同一份 plan 與 audio.currentTime 驅動。

未建立 V5、Director、Skill 或批次系統。

## Template Status

本輪補上 Outro 與小型 reference template 抽離，詳見 [V4.2 Outro review](../p2-v4.2-outro/REVIEW.md)；原 V4.2 影片、聲音與 alignment 保留。

2026-10-11 更新：目前 reference implementation 是 [p2-v4.2-outro-music.mp4](../../outputs/p2-v4.2-outro-music.mp4)，使用者已确认視覺方向；保留檔案，不覆寫。本文件較早的待驗收敘述為歷史紀錄，目前狀態如下。

| 項目 | 狀態 |
|---|---|
| P2 visual language | validated |
| Voice quality（Arthur 英文故事／例句；Ling 中文詞義） | validated |
| Template architecture | partially validated |
| ElevenLabs automated voice pipeline | not yet validated |
| Cross-episode reuse | not yet validated |

固定視覺方向與 viewing flow 以 [目前設計規則](../video-design-system.md) 及 [reference Template Status](../p2-v4.2-outro/REVIEW.md#template-status) 為準；P2 timing、story length、vocabulary 數量、Hook animation、Quiz duration 與 Outro duration 都不是全 episode 固定規則。下一步先由 Claude Code 完成 ElevenLabs automation，再由 Codex review，最後用全新 episode 做 stress test；本輪僅記錄，不執行。

### A. 已經可以固定成模板的部分

白色串文 surface、深藍 reading cue、黃色 vocabulary handoff；詞義／例句展開與收回後恢復閱讀；資料化故事段落與 vocabulary 清單；Quiz／answer reveal 與同視窗回覆式 Outro。

### B. 目前仍應保持可調的部分

單字數量、各段時間與鏡頭 offset、Hook 動畫／形式、故事長度、Quiz 題型、Outro CTA。現有實作支援數字揭曉 Hook 與文字選擇題，未將其視為所有影片唯一格式。情境動畫仍是可選內容。

### C. 下一篇 episode 要驗證的部分

更換 JSON／audio／alignment 後的換行與 cue、不同數量及長度的 vocabulary、長詞義／例句、不同 Hook／Quiz 變體，以及鏡頭設定與語音節奏。下一篇仍需版面與節奏驗證，不能把 P2 的時長固定套用。
