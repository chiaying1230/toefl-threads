# p2 V4 prototype

只做 p2。白色貼文視窗與實際朗讀是本次 prototype 的主體；未建立模板、Director System、Skill、批次流程，也未修改 App 或其他 episodes。

## 實作前：V3 離開風險

閱讀 V3 實作、完整時間軸與成片抽幀後，定位以下時刻。曾嘗試開啟成片播放，但本次 Computer Use 沒有可用瀏覽器或原生 App surface；因此不能聲稱已像人類一樣完整播放觀看／聆聽。

- 2–5 秒：原文大段進場，無音軌，也無朗讀定位，觀眾得自己找閱讀線。
- 5.9–12.1 秒：allocate 註解長時間沒有新內容；除了進度條，幾乎整幅不變。
- 12.8–16.9 秒：CFO／撥筆有笑點，卻沒有朗讀、視覺落點或明確的反應節拍。
- 19.6–27.0 秒：arbitrary 複製第一個字的展開方式，接下來會怎樣已能預測。
- 27.5 秒：測驗只有兩個選項；文章持續漂浮在紙色背景中，缺少一眼可辨認的貼文視窗。

## V3 → V4

V3 沒有音軌，所謂 reading pace 是預估秒數；V4 使用本機 Zira 英文、Hanhan 中文 TTS，以及引擎 SpeakProgress 回傳的 AudioPosition / CharacterPosition。只裁頭尾靜音，不拉快音訊。英文與中文皆為 rate 0（正常語速）。學習解釋直接在遇到該字時展開，不等整句讀完。

外層為米黃色品牌背景；主體為固定白色 post window，作者、分級、邊界及串文 metadata 全程留在原位。只有正文在視窗內移動，單字註解是正文的 inline expansion，quiz 是正文下方回覆。沒有黑色測驗頁、品牌結尾頁或吉祥物占位。

為減少重複，正文作小幅編輯：`I have decided to` 縮為 `I decided to`，CFO 段落拆成兩句，仍保留 90% 預算／紙箱／撥筆／final and completely arbitrary／散會的情節。兩個字改用更短但完整的新例句，不刪學習欄位：

| 字 | 意思／詞性 | 英文例句 | 中文翻譯 |
|---|---|---|---|
| allocate | 分配；撥出 · v. | We allocate money to advertising. | 我們分配預算給廣告。 |
| arbitrary | 任意的；武斷的 · adj. | The rule seems arbitrary. | 這項規定似乎很武斷。 |

## Attention events 的理由

| 約略時間 | Event | 為什麼值得繼續看 |
|---|---|---|
| 0–3.0 秒 | 90% 及九成比例條 → cardboard boxes／📦 | 短句朗讀製造數字與用途的反差；字幕第一格即帶出紙箱問題 |
| 3.0–4.5 秒 | 開始正文；讀到 allocate 即展開 | 當下遇到的字被點開，來源還在句中，不先閱讀完整句再上課 |
| 4.5–8.0 秒 | 意思成組呈現 → 例句跟讀 | 一個短註解容納字、意思、詞性、例句及翻譯；語音帶視線在已有資訊間移動 |
| 8.0–11.3 秒 | 收回註解、讀剩下的預算句 | 重回故事，看到這個字實際把預算撥給紙箱的用途 |
| 11.3–12.9 秒 | CFO：為什麼？ | 新角色問題建立期待 |
| 12.9–14.7 秒 | 貓掌撥筆；沒有解釋，只有貓掌 | 撥筆物件是這句的具體 payoff，動作跟 knocked 同步，沒有角色站在角落 |
| 14.7–17.9 秒 | final → completely arbitrary | 宣布荒謬決定不可改，第二個字是故事結果 |
| 17.9–21.3 秒 | 「因為我是貓」→ arbitrary 意思與例句 | 用剛剛的故事幫助記憶「無合理依據」；不同於第一個字的單純短註解 |
| 21.3–22.4 秒 | Meeting adjourned | 散會作為情節結束；註解收回，留言緊接其後 |
| 22.4–25.4 秒 | 引用原句、arbitrary 意思三選一 | 不是進入新 App，而是回覆剛才的決定；提示後保留 2 秒思考 |
| 25.4–27.0 秒 | B 黄色正解及「沒有合理依據」 | 正解連回紙箱預算與貓說了算，直接結束 |

一般朗讀用細灰底線；學習字才使用 serif 與黃色強調。首輪檢查後移除其他詞的 serif／常駐黃色，避免整段都是重點。Quiz 思考與答案停留也增加過一次。白色視窗、作者、背景沒有同時搶動作。

## Voice-synced cue

每個英文 token 根據字元位置匹配 SAPI event。畫面使用 `line.start + word.at` 開啟底線，下一個詞開始時移交；已讀文字變墨色，未讀文字為可讀的灰色。中文意思朗讀時，整組意思以淡黃聚焦。Hook 是 phrase-level event：90% 聚焦到「for cardboard boxes」朗讀開始，才揭露紙箱重點。

音訊、逐字時間戳與 HTML 都使用同一份 `p2-v4.plan.json`。成片每格呼叫 `renderFrame(t)`；音軌是同份 WAV 的 AAC 編碼。預覽頁 `scripts/video/p2-v4.html?preview=1` 提供播放按鈕，以 audio.currentTime 驅動畫面。這是 p2 專用試驗，未修改 shared video engine。

## allocate / arbitrary 的不同節奏

同步驗證曾發現預設 WAV 輸出格式與部分 SpeakProgress 時間戳不一致，最後的詞被標在音檔結束後。已修正為明確指定 16kHz、16-bit、mono PCM，重新產生正常語速音訊與全部畫面。沒有把失敗的時間戳夾進音檔範圍、或用字數估算掩蓋偏移。

allocate 是句子中間的短註解：字出現就打開，快速解釋，再接著讀預算用途。arbitrary 位在句尾：先讀完決策宣告，再在該字被朗讀時打開有情節記憶提示的註解；例句再次朗讀 arbitrary，之後進入意思回想。两者共享白色貼文、淡黃註解與同樣字型，但第二次多了故事記憶，並直接服務測驗。

## 豆腐出場

「因為我是貓」與「沒有解釋。只有貓掌。」是編輯反應／記憶提示，不是原文逐字引述。

零次。90%／紙箱本身能製造反差，撥筆已有貓掌物件，quiz 的黄色正解也能完成 feedback。此時加入豆腐沒有必要。

## Quiz continuity

同一張白色 post window、同一作者、同一正文欄位。arbitrary 註解收回後，接散會與回覆。回覆引用真正朗讀過的 `The decision is final, and completely arbitrary.`，再問意思，列 A／B／C 三個中文選項。提示音結束後保留 2 秒思考，B 變黄色，中文朗讀「武斷的」，並顯示原因。沒有再切換底色或產品語言。

## 仍然最弱的三個地方

1. 本機 desktop TTS 的情緒與喜劇停頓較機械，英文／中文換聲線也能聽出合成痕跡；本次沒有可用播放 surface，未完成真實聆聽驗收，不能把語音自然度算已通過。
2. allocate 句中仍插入意思與例句，可能讓觀眾察覺「開始學英文」；這版靠短註解與立即回到預算句降低打斷，沒有證明已消除。
3. 第二次仍用 inline expansion，雖然記憶提示與 quiz 關聯不同，interaction 的差異可能仍不夠；27.0 秒的雙語資訊密度也需真實手機觀眾測試。

## 交付與重現

`p2-v4.mp4`、`sheet-review.png`、`sheet-timeline.png`、`mp4-stills/`、`phone/`、本文件。所有新增內容均在 scripts/ 與 docs/；V3 檔案保留。

```powershell
powershell -ExecutionPolicy Bypass -File scripts/video/p2-v4-voice.ps1
python scripts/video/prepare-p2-v4.py
node scripts/render-p2-v4.mjs
python scripts/video/verify-p2-v4.py
```

使用既有 Windows 語音、System.Speech、Playwright、Edge、ffmpeg、Pillow。沒有安裝依賴或使用網路 TTS。字型本機 fallback 與 V3 相同，單字另外使用 Georgia serif。

驗收以完整 MP4 解碼、全時間軸每 0.5 秒抽幀、360×640 圖、逐字時間戳和逐格 active cue 裁切檢查進行；不把這些檢查描述成人類實時播放完整看過。

最終驗證：27.033333 秒、811 格、1080×1920、30fps、H.264 / yuv420p；AAC 音軌 27.034 秒。全片解碼通過，54 個語音時間戳通過音檔範圍與順序檢查，811 格的水平溢出／active cue 裁切檢查無問題。全片 55 張 chronological samples、代表圖總覽、arbitrary 學習與測驗正解的手機圖已檢視。沒有發現新增的裁切問題；對焦清楚度与願不願意看下一秒仍是設計判斷，不是留存率測試結果。
