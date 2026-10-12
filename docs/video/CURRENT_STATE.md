# 影片系統 CURRENT_STATE

跨 agent 共用的「現在仍有效」狀態；不是開發日誌。細節與 hash 一律看各 `FROZEN.json`，這裡不複製。
更新時機：每次 freeze、共用規則改變之後。最後更新：P4 freeze 與交接整理後（2026-10-12）。
入口：`AGENTS.md`（所有 agent）；`CLAUDE.md` 只有一行 `@AGENTS.md`，是 Claude Code 指向它的薄入口，不放任何專案記憶。

## 1. 專案目標

- toEfu：手機優先的英文單字學習 App（`js/`；詞彙庫：TOEFL、TOEIC、IELTS、高中、國小國中）。
- 影片系統（`scripts/video/`）：把一則貼文做成約 30–50 秒的直式短影音（1080×1920、30 fps）。流程是 Hook → 朗讀貼文 → 詞彙教學 → Quiz → Outro。旁白用 ElevenLabs，字級時間來自真實 alignment，Playwright 逐幀渲染，ffmpeg 編碼並混入配樂與答對音效。
- 目標：可重複、可驗證地做出系列影片（每個詞彙庫各自編號）。已 freeze 的影片同時是 regression 基準。

## 2. 架構

```
js/data（貼文、詞彙、levels.js、characters.js、packs/）
  → 人寫：scripts/video/narration/<id>.json + scripts/video/episodes/<id>-auto.json
  → voice.mjs      ElevenLabs → voice-cache/*.mp3（git-ignored） + narration/alignment/*.json + narration/<id>.manifest.json
  → assemble.mjs   → docs/<id>-auto/{narration.wav, <id>-auto.plan.json, assembly.json}
  → render-episode.mjs   post-reference.html + reference/*.js → MP4（有 music/soundEffects 就自動混音，另存 *.narration-only.mp4）
  → verify-episode.mjs / audio-mix.mjs / layout audit
```

- 命名：narration id = contentId（`p2`、`p348`、`toeic-079`）；episode 檔 `<id>-auto.json`；plan 路徑必須是 `/docs/<id>-auto/<id>-auto.plan.json`。
- 共用程式：`scripts/video/reference/`（PostTemplate、Components、**ReadingCue（受保護）**、Phrase、Header、post.css、outro.css）、`scripts/video/voice/`（語音 pipeline、`episode-refs.mjs` 驗證器）、`render-lib.mjs`、`audio-mix.mjs`。
- 工具：`check-freeze.mjs`、`regression.mjs`（DOM 快照 + 逐幀 hash；基準在 `docs/regression/`，P2、P3、P4 各一份）、`fit-camera.mjs`、`review-visual.mjs`。
- **Legacy，不要在上面做新 episode：** `scripts/make-video.mjs`、`scripts/make-voice.py`、`scripts/video/{VideoTemplate,Feed,scene.html,plan.mjs,episode.mjs}`、`docs/p2-v2…v4.2*` 的實驗。
- 環境（Windows）：Node 24、無 package.json、用 `python`（不是 `python3`）。Playwright / Edge / ffmpeg 用環境變數 `PLAYWRIGHT_MODULE`、`CHROMIUM_PATH`、`FFMPEG_PATH` 指定（目前仍有寫死的本機後備路徑）。Git Bash 傳 `/scripts/...` 參數時要設 `MSYS_NO_PATHCONV=1`。

## 3. 視覺 / 設計規則（現行）

- 白色貼文視窗 + 暖色外圍。**深藍底線** = 閱讀進度（逐字跟隨真實 alignment）；**黃色** = 詞彙 / 要記住 / 答對。
- Hook 只有兩種內容類型：`number_contrast`（沒寫 `type` 的預設）與 `scene_contrast`（setup + payoff）。question / quote / reveal 等只是文案手法，不是新 variant。Hook 先看原文最值得停下來的具體反差再選，不捏造數字。
- 詞彙教學：開啟 → 詞義（Ling）→ 例句（Arthur）→ 回到故事。支援單字與**詞組**（`word` / `forms` 含空白即詞組；整段連續 token 才變黃，詞組外的 a / of / and 不亮）。
- **handoff 插入點**：優先在詞彙之後最近的標點邊界（, . ; : ! ?），narration 用 `after`；若邊界就是句尾，整句不切、教學放在句後。舊的 `through`（切在該字之後）仍可用。黃色詞彙範圍與「在哪裡停下來教學」是兩件事。
- Quiz 只有 `meaning` 型。Outro 約 2.4 秒、有 mascot、單字 / 詞組列（詞組：英文在上、中文在下）。
- 配樂與音效沿用：`assets/social-soft-groove.wav`（94 BPM）、`assets/answer-correct.wav`，設定寫在 episode 的 `music` / `soundEffects`。
- **內容 emoji 預設關閉**（Hook、正文、例句、詞彙卡、Quiz、Outro）。例外要寫 `allowContentEmoji: true`。mascot、帳號頭像、UI 符號（✓ ● ↳）不算內容。
- 中文詞彙標題與 Quiz 題目用 `keep-all`（不在中文字詞中間斷行）。
- 不加裝飾性動畫；metadata（右上角）不搶 Hook 與正文。原則：CLEAR > RHYTHMIC > DECORATIVE。
- camera 依真實 plan 用 `fit-camera.mjs` 擬合；不要用假時間定案。

## 4. Episode metadata schema（現行）

```json
{ "series": "TOEIC", "seriesEpisode": 1, "level": { "min": 2, "max": 2 }, "contentId": "toeic-079" }
```

- 四欄都是**明確資料，由使用者決定**；不從 contentId、檔名、資料夾推測。每個詞彙庫各自編號；集數可跳號、可重做。
- 右上角顯示 `series · #NN · level`（`TOEIC · #01 · L2`、`TOEFL · #02 · L1–L2`；至少兩位、不設上限；範圍只是顯示形式，不存進資料）。這條路徑下帳號列的 level badge 不顯示，不需要 `episodeLabel` / `author.level`。
- **Legacy**：沒有 `series` 的 episode（P2、P3）維持 `episodeLabel` + level badge，完全照舊。
- `level.min / max` 是 1–3（來自 `js/data/levels.js`），`min <= max`。
- 沒有來源依據的欄位用中性值（系列名與標語來自 `scripts/video/series.json`）；不自行創造 EP 編號或宣傳文案。作者 / 帳號 / topic 來自 `js/data/characters.js` 與貼文資料。
- 詞彙的中文、例句、`zh` 一律用來源資料（`batch-*.js`、`packs/*.js`），不自己寫。

## 5. 語音規則

- 角色：**Arthur**（`eleven_v4`）= 故事、英文例句、英文 Hook；**Ling** = 中文詞義。設定在 `scripts/video/voices.json`，未經使用者同意不改。
- API key 只在 repo 根目錄 `.env`（`ELEVENLABS_API_KEY`，git-ignored；範本 `.env.example`）。不顯示、不提交。沒有備用聲音或 TTS。
- `voice.mjs <id>` 只規劃、不送出；`--yes` 才生成缺少的 segment（扣費）；`--frozen` 絕不呼叫 API（render 用）。cache 以「聲音 + 模型 + 設定 + 唸出的文字」為 key，命中就不重生成。`voice-cache/` 不進 Git，alignment 與 manifest 進 Git。
- 被詞彙打斷的句子**只送一次 TTS**，再依 `parts` 切開（不要拆成兩次 TTS）。`cut: "late"` 用於前一字是爆破音接下一字的情況。
- 詞義 segment 的 `text` 是 Ling **唸出的自然說法**，畫面顯示的是 episode 的 `zh`（來源中文），兩者可以不同。破折號等純顯示標點目前不支援，旁白寫成逗號版本。
- **接縫自然度機器無法判斷，一定要使用者實聽**；不要自行宣稱「聽起來自然」。

## 6. Freeze / reference 狀態

| | contentId | 系列 | reference MP4 | 記錄 | Git |
|---|---|---|---|---|---|
| P2 | `p2` | TOEFL #01（legacy header） | `outputs/p2-auto-pipeline-music.mp4`（較早核准的 `outputs/p2-v4.2-outro-music.mp4` 也保留） | `docs/p2-auto/FROZEN.json` + `FREEZE.md` | tag `p2-freeze-2026-10-11` |
| P3 | `p348` | TOEFL #02（legacy header） | `outputs/p348-first-render.mp4` | `docs/p348-auto/FROZEN.json` + `VALIDATION.md` | tag `p3-validation-2026-10-11` |
| P4 | `toeic-079` | TOEIC #01 | `outputs/toeic-079-third-render.mp4` | `docs/toeic-079-auto/FROZEN.json` + `VALIDATION.md` | tag `p4-validation-2026-10-12`（分支 `p4-validation`） |

- `p1` 只是 TOEFL 貼文，從未做成影片，不計入系列。P1–P4 是專案階段代號，不是系列集數。
- 每個都用 `node scripts/video/check-freeze.mjs <FROZEN.json>` 檢查，三個都應是 intact。
- 目前所有影片工作都在 `p2-freeze → p3-validation → p4-validation` 這串分支，尚未合併到主線。

## 7. 共用 template 目前版本與有效能力

- 最新 revision：**r8**。revision 歷史與 hash 在 `docs/p2-auto/FROZEN.json` 的 `revisions[]` 與 `docs/p2-auto/FREEZE.md`（P2、P3、P4 共用同一份共用程式記錄）。
- 有效能力：scene_contrast Hook、多個詞彙、句中 / 句尾 handoff、詞組與詞形（forms）、標點邊界 handoff（`after`）、攝影機與教學框動畫重疊的修正、Quiz 與詞彙標題中文 keep-all、詞組 Outro 排版、結構化系列 metadata 與新 header、內容 emoji 預設關閉、verify 的詞彙黃色 span / header / emoji 檢查。
- **尚未驗證**：中英混合在同一段 TTS、其他 Hook / Quiz variant、純顯示標點對應、一個詞組內部被打斷、一句三次以上打斷、`speak` 用在真實內容。

## 8. 受保護的不變量

- `reference/ReadingCue.js` 不改（hash 記在 FROZEN.json）。契約：每個 token 的時間來自真實 alignment、不內插；`key` 只在建立時決定，`update()` 只切換 read / active。
- FROZEN.json 的 reference 影片、narration / plan / manifest / config、音訊資產、alignment 不改（`check-freeze` exit 2 = 凍結檔本身被動過）。
- P2 / P3 / P4 要維持 regression：`regression.mjs compare` 的 DOM 快照與逐幀 hash 一致（Outro 吉祥物少數幀不是 bit-stable，工具已處理）。基準與瀏覽器版本綁定，只在同一台機器可靠。
- legacy episode（沒有 `series`）永遠走舊路徑，畫面不變。
- 測試、regression、render 都不呼叫 API；assemble / render 都是本機、免費。
- 資料有問題要讓驗證器報錯，不允許「資料合法但畫面不亮」。
- 明確資料（series、集數、level、Hook、Quiz）不推測。

## 9. 新 episode 標準流程

1. 使用者選內容、詞彙庫、`seriesEpisode`、`level`（不要自己決定）。
2. 從 `js/data` 取真實貼文與詞彙，寫 `narration/<id>.json` 與 `episodes/<id>-auto.json`（可參考 `toeic-079` 的詞組、`p348` 的單字）。
3. Hook：從原文提出 3 個 content-first 候選，使用者選；Quiz 同理（只用 `meaning`）。
4. `voice.mjs <id>` 看計畫（段數、字元數、cache 命中）→ 使用者同意後 `--yes`。
5. `assemble.mjs <id>`；看 warnings；**使用者實聽接縫與詞組處**。
6. `fit-camera.mjs <episode> --write`，再 `render-episode.mjs <episode> --audit-only` 到 0 問題。
7. `render-episode.mjs <episode> --out outputs/<id>-first-render.mp4`，接著 `audio-mix.mjs`、`verify-episode.mjs --video <narration-only>`、`review-visual.mjs`。
8. 使用者看影片；有問題先回報原因再修，不重新設計；共用程式要改就走第 8 節的 regression 與新 revision。
9. 使用者驗收後：建立 `docs/<id>-auto/FROZEN.json` + `VALIDATION.md`（格式照 P3 / P4），提交 reference MP4、narration.wav、plan、manifest、alignment、episode，不提交 narration-only、截圖、`mix-work/`、`voice-cache/`；tag `p<N>-validation-<日期>`。

## 10. 驗證清單

- 離線測試：`node --test scripts/video/audio-mix.test.mjs scripts/video/voice/*.test.mjs`（目前 92 個，須全過）。
- `check-freeze`：P2、P3、P4 都 intact；`sha256sum scripts/video/reference/ReadingCue.js` 與 FROZEN.json 相同。
- 改共用程式後：P2 / P3 / P4 的 `regression.mjs compare`；P2 / P3 `assemble --out <暫存>` 與凍結檔逐位元組相同；對現有 P2 / P3 mp4 跑 `verify-episode`。
- 每個新 episode：narration ↔ episode 0 問題；layout audit 0 問題；`verify-episode` 全 PASS（閱讀游標、Hook reveal、詞彙黃色 span ×2、header、無 emoji、各詞彙 handoff、Quiz 流程、語音範圍、MP4 可解碼）；`audio-mix` 6/6；`review-visual` 攝影機方向反轉 0 次、教學期間詞組與教學框在視窗內。
- 提交前：確認沒有 `.env`、API key、`voice-cache/`、截圖與中間檔；先看 `git diff --cached --name-only`。

## 11. 目前下一步

- P4 已完成並 freeze、已 push。**下一支是 P5，尚未開始，也沒有選定內容。**
- P5 開始前使用者要決定：內容、詞彙庫、`seriesEpisode`、`level`。
- 已知待辦（不屬於 P5 本身）：本機路徑可攜性（`render-lib.mjs`、`voice/audio.mjs` 等的後備路徑；環境變數見第 2 節）、換行字元（無 `.gitattributes`，CRLF 可能影響跨機器 hash 驗證）、P2 / P3 的 reference 仍是 legacy header。
- P4 已知但延後的美觀項目：Hook 中文提前透露 payoff、答案說明最後一行只剩一字、第一個例句較長、詞彙卡標題在「被…」後換行。
- `docs/video-design-system.md`：開頭的驗證狀態與「系列識別與內容規則」一節是現行；早期章節（第 1–13 節、feed revisions）是歷史紀錄。兩者有出入時以本文件與各 FROZEN.json 為準。

## 12. 必讀與依任務再讀

**新 session 啟動時只必讀兩個檔案：**

1. `AGENTS.md`
2. `docs/video/CURRENT_STATE.md`（本文件）

其他文件依任務需要再讀，不要預先全部讀：

| 任務 | 再讀 |
|---|---|
| 修改共用 template / pipeline | `docs/p2-auto/FREEZE.md`（revision 表）、`docs/p2-auto/FROZEN.json`（hash 與各 revision 的 regression 證據） |
| 做新 episode | `docs/video-design-system.md` 的「系列識別與內容規則」一節；最新範例 `scripts/video/episodes/toeic-079-auto.json`（詞組）、`p348-auto.json`（單字）、`scripts/video/narration/toeic-079.json`（`after` 的寫法） |
| 碰語音 / narration | `scripts/video/voice/README.md`（`parts`、`through` / `after`、`cut: late`、混音） |
| 研究或比對 P4 | `docs/toeic-079-auto/VALIDATION.md`、`docs/toeic-079-auto/FROZEN.json`（P3：`docs/p348-auto/`；P2：`docs/p2-auto/`） |
