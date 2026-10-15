# 影片系統 CURRENT_STATE

跨 agent 共用的「現在仍有效」狀態；不是開發日誌。細節與 hash 一律看各 `FROZEN.json`，這裡不複製。
更新時機：每次 freeze、共用規則改變之後。最後更新：2026-10-15 GitHub 同步（r9–r14 shared pipeline、整個 `video-studio/`、批量製作、影片資料夾都已推上 GitHub；未改 frozen assets，P2 兩個舊 reference 本機已缺失，見下方）。
入口：`AGENTS.md`（所有 agent）；`CLAUDE.md` 只有一行 `@AGENTS.md`，是 Claude Code 指向它的薄入口，不放任何專案記憶。

## 0. GitHub 同步狀態（給 ChatGPT 等只讀 GitHub 的 agent）

- Repo：`chiaying1230/toefl-threads`。**影片系統與 Video Studio 的最新內容在分支 `p5-validation`**，不在預設分支 `claude/magical-davinci-o7fmqc`（主線只有 App，還沒合併影片工作）。讀這個 repo 時請切到 `p5-validation`。
- 2026-10-15 推送內容：本文件與 `AGENTS.md`、`scripts/video/` 的 r9–r14 修改與新測試、`docs/video/revisions/r9…r14*.json`、整個 `video-studio/`（程式、測試、`public/` UI、所有說明文件 `*.md`）、各 `docs/*-auto/` 與舊實驗資料夾的 JSON／TSV／腳本紀錄、App 安裝教學步驟圖（`js/app.js`、`css/style.css`）。
- **刻意沒有推上 GitHub 的（只在作者本機）：** 依第 9／10 節的提交規則，截圖（`*.png`）、中間音檔與影片（`mix-work/`、`seam-experiments/`、`preview-*.wav`、`narration-only`、測試 render 的 `*.mp4`）、`voice-cache/`、`video-studio/state/`（Studio 草稿、run、sealed 語音、batch 狀態）、`.env`。所以本文件提到的 draft／run／candidate ID、`production/batches/*.json`、Studio 產出的 MP4 只存在本機；GitHub 上看得到的是程式與說明，看不到那些資料本身。
- `outputs/p2-v4.2-outro-music.mp4`：作者本機已刻意刪除（見第 11 節），但 GitHub 上沒有提交這個刪除，所以 Git 仍保留該 frozen 檔（commit `2635bc1` 起）。`outputs/p2-auto-pipeline.mp4` 從未進 Git。
- Tags（皆已在 GitHub）：`p2-freeze-2026-10-11`、`p3-validation-2026-10-11`、`p4-validation-2026-10-12`、`p5-validation-2026-10-12`。2026-10-15 的同步沒有新增 tag。
- 外部 agent 只能讀、不能執行本機 pipeline／Studio，也沒有 ElevenLabs key；回答「目前狀態」時以本文件與各 `FROZEN.json` 為準，不要用聊天記憶補。

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
- **P5 驗證的規則**（細節與理由在 `docs/video-design-system.md`「Hook、串流、Quiz、Outro 的規則」）：
  - Hook 不把故事提前講完、只留足以讓人停下來的資訊；Hook 視覺精簡，不為填滿 schema 顯示不需要的中文或第二層資訊。
  - 閱讀時下一段要用 `visibility` 提前出現在下方，不要留大片空白再突然跳出。
  - Quiz 選項的顯示文字可為版面做不改變語意的精簡；`js/data` 原始資料不改。
  - Outro 吉祥物要停留到接近 Outro 結束：把 `outro.mascot.cueDuration` 設為 `duration − scrollDuration − 0.45`（預設值會讓它提早消失）。
- 不加裝飾性動畫；metadata（右上角）不搶 Hook 與正文。原則：CLEAR > RHYTHMIC > DECORATIVE。
- camera 依真實 plan 用 `fit-camera.mjs` 擬合；不要用假時間定案。

## 4. Episode metadata schema（現行）

- **Studio 集數記憶（本人授權，2026-10-14）：** 新草稿依來源 pack 的明確系列對照、自有正式 episode metadata 與已保存草稿的最高集數，自動預留下一集；每個系列分開計數，重開／重跑／重錄不增加集數，手動跳號與修改仍可。未完成草稿也預留編號以避免兩支不同影片撞號。不改現有正確決策或 frozen metadata；保存時仍是 explicit series/seriesEpisode，未從 contentId 推測。`series-progress.mjs`／server 配置與 UI 不進既有 production engine dependency，現有影片不因此 stale。

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
| P2 | `p2` | TOEFL #01（legacy header） | `outputs/p2-auto-pipeline-music.mp4`（較早核准的 `outputs/p2-v4.2-outro-music.mp4` 本機已由 owner 清理，Git 中仍保留） | `docs/p2-auto/FROZEN.json` + `FREEZE.md` | tag `p2-freeze-2026-10-11` |
| P3 | `p348` | TOEFL #02（legacy header） | `outputs/p348-first-render.mp4` | `docs/p348-auto/FROZEN.json` + `VALIDATION.md` | tag `p3-validation-2026-10-11` |
| P4 | `toeic-079` | TOEIC #01 | `outputs/toeic-079-third-render.mp4` | `docs/toeic-079-auto/FROZEN.json` + `VALIDATION.md` | tag `p4-validation-2026-10-12`（分支 `p4-validation`） |
| P5 | `ielts-068` | IELTS #01（L2–L3） | `outputs/ielts-068-first-render.mp4`（45.033 秒） | `docs/ielts-068-auto/FROZEN.json` + `VALIDATION.md` | tag `p5-validation-2026-10-12`（分支 `p5-validation`） |

- `p1` 只是 TOEFL 貼文，從未做成影片，不計入系列。P1–P4 是專案階段代號，不是系列集數。
- 每個都用 `node scripts/video/check-freeze.mjs <FROZEN.json>` 檢查，四份 reference 資產都應是 intact。P2 原 manifest 保留 r8，預設 checker 會另報已記錄的 validator / assembler shared DRIFT / exit1；r9/r10 外置 revision 不覆寫 frozen metadata，版本與獨立驗證記錄見第 7 節。
- 目前所有影片工作都在 `p2-freeze → p3-validation → p4-validation → p5-validation` 這串分支，尚未合併到主線。四個分支都已在 GitHub；最新是 `p5-validation`（見第 0 節）。

## 7. 共用 template 目前版本與有效能力

- **現行 shared assembler r14-split-final-pcm：** 延續 r12，補 split parts 的最終 fade／PCM 範圍檢查。只在超過既有60ms slack時套同一 trimClip與exact sample word rebase；健康clips不改，原take／alignment／ReadingCue／renderer／voice request contract／threshold／tolerance不變。103 offline tests PASS；P2–P5 plan/WAV逐byte相同，P2/P3/P4逐幀912/1358/1473 frames PASS。P2第一輪4個已知mascot不穩定幀不符，單獨一次repeat 0 differ，原log與baseline保留；四支既有正式MP4維持r13驗證，驗證器與凍結plan/WAV不變。外置記錄 `docs/video/revisions/r14-split-final-pcm.json`；下方r12保留為歷史修正說明。

- **共用影片驗證器 r13-time-ref-delay：** `verify-episode.mjs` 的 wordTime 現在依 renderer／audio-mix 契約讀取 ref.delay 與 line edge，不改既有檢查或容許值；renderer、ReadingCue、assembler、voice contract 不變。102 項離線測試 PASS；P2/P3/P4 逐幀 912/1358/1473 frames regression PASS、四支 retained 正式 MP4 verify PASS、凍結 metadata／現存 assets hashes 不變（P2 既知兩個缺檔保留）。hs-016 真實決策在隔離假語音完成 assemble/camera/audit/render/mix/verify：995 frames、mix6/6、verify11/11；不代表真人發音已驗收。記錄在 `docs/video/revisions/r13-time-ref-delay.json`。

- **Studio opt-in request revision r11：** 新增 explicit segment language 與 immutable retake identity 的 shared preparation / generation metadata；不改 renderer、ReadingCue、voice config、trim/alignment/tolerance。舊 frozen narration不啟用此 contract，hash / prepared / plan / WAV byte parity、可用 MP4 verify 已通過；P2 兩個既存缺檔使全資產 stock integrity 仍未通過，詳見第 11 節與 r11 外置 revision。以下 r10/r9/r8 仍是相應 assembler / validator / renderer 的版本。

- 現行 shared assembler revision：**r12-playback-grid-trim**，記錄在 `docs/video/revisions/r12-playback-grid-trim.json`。延續 r10 的 fade 後最終 PCM／原始 10ms grid 與 35/50ms padding，另檢查播放後的 10ms grid；僅在超出既有 60ms slack 時裁去多餘空白，同時保留 source-grid 的 speech bounds，不能安全修正則 BLOCK。健康 clips 不改，alignment 仍只做 exact sample offset rebase/clamp，threshold 與 verify tolerance 不變。102 項離線測試 PASS，P2–P5 plan/WAV 逐 byte 相同、現存正式 MP4 verify PASS；P2/P3/P4 逐幀 regression PASS（P4 首次有 3 格既知 mascot bit instability，單獨 repeat 0 differ，原始 log 保留）；P5 renderer byte hash 未變、plan/WAV parity 與 verify PASS，不聲稱本輪新跑 P5 全幀比較。Validator 維持 **r9-null-hook-zh**，Renderer 維持 r8，voice request contract 維持 r11。原 frozen metadata 不改，r9/r10/r11 record 保留；P2 既知缺檔與 pipeline DRIFT 限制仍保留。
- 有效能力：scene_contrast Hook、多個詞彙、句中 / 句尾 handoff、詞組與詞形（forms）、標點邊界 handoff（`after`）、攝影機與教學框動畫重疊的修正、Quiz 與詞彙標題中文 keep-all、詞組 Outro 排版、結構化系列 metadata 與新 header、內容 emoji 預設關閉、verify 的詞彙黃色 span / header / emoji 檢查。
- **尚未驗證**：中英混合在同一段 TTS、其他 Hook / Quiz variant、純顯示標點對應、一個詞組內部被打斷、一句三次以上打斷、`speak` 用在真實內容。

## 8. 受保護的不變量

- `reference/ReadingCue.js` 不改（hash 記在 FROZEN.json）。契約：每個 token 的時間來自真實 alignment、不內插；`key` 只在建立時決定，`update()` 只切換 read / active。
- FROZEN.json 的 reference 影片、narration / plan / manifest / config、音訊資產、alignment 不改（`check-freeze` exit 2 = 凍結檔本身被動過）。
- P2 / P3 / P4 要維持 regression（P5 沒有改共用程式，沒有另建 regression 基準）：`regression.mjs compare` 的 DOM 快照與逐幀 hash 一致（Outro 吉祥物少數幀不是 bit-stable，工具已處理）。基準與瀏覽器版本綁定，只在同一台機器可靠。
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

- 離線測試：`node --test scripts/video/audio-mix.test.mjs scripts/video/voice/*.test.mjs`（2026-10-15 為 103 個，含 nullable-Hook、final-waveform trim、explicit language、split final PCM regression，須全過）。Studio 自己的測試在 `video-studio/*.test.mjs`。
- `check-freeze`：P2、P3、P4 都 intact；`sha256sum scripts/video/reference/ReadingCue.js` 與 FROZEN.json 相同。
- 改共用程式後：P2 / P3 / P4 的 `regression.mjs compare`；P2 / P3 `assemble --out <暫存>` 與凍結檔逐位元組相同；對現有 P2 / P3 mp4 跑 `verify-episode`。
- 每個新 episode：narration ↔ episode 0 問題；layout audit 0 問題；`verify-episode` 全 PASS（閱讀游標、Hook reveal、詞彙黃色 span ×2、header、無 emoji、各詞彙 handoff、Quiz 流程、語音範圍、MP4 可解碼）；`audio-mix` 6/6；`review-visual` 攝影機方向反轉 0 次、教學期間詞組與教學框在視窗內。
- 提交前：確認沒有 `.env`、API key、`voice-cache/`、截圖與中間檔；先看 `git diff --cached --name-only`。

## 11. 目前下一步

- **工作室豆腐封面（2026-10-15）：** 本人提供黃色豆腐圖標並要求工作室裝飾；新增 `video-studio/public/studio-cover.png`（豆腐＋場記板＋聚光燈）與多尺寸 `studio-tofu.ico`。桌面「toEfu 影片工作室」捷徑改用新圖示；wizard、影片資料夾、批量頁首與favicon共用新資產，`studio-brand.css` 提供細場記板條紋及手機縮排。只新增固定白名單靜態資產路由，不改影片內容／草稿／語音／付費或驗收流程。

- **同句多字與批量全部教學（2026-10-15）：** 本人要求自選批次每篇所有詞彙都教，取消最多2字，改 `auto-source-all-v2`；既有批次 immutable 決策／語音預算／授權不改。compiler 對同 punctuation cut 分組，依來源位置逐卡教學，不以 find 漏掉第二字；整句仍一次 TTS，parts 只切 unique cut，resumeAfter 指向整組教完後的 silent exit。silent duration 由既有 close/open/scroll duration 計算，真實 plan 綁 open.delay，不改 ReadingCue、共享 renderer 或驗證門檻。toeic-01 原草稿 `a8a7d022-9c05-4e65-b54a-7e87da72e9c9` revision3 免費 compile/validate/plan PASS，document/deadline/manager 三字全保留，所有 decisions 與 revision 不變；receipt15／network attempts114 前後相同。相同真實決策用隔離假語音完整 assemble/camera/audit/render/mix/verify PASS（719幀，verify12、mix6），尚未替本人產生新語音或接受。多字共用句中／句尾切點、反向選字仍依原文順序、3個不同切點等17項相關回歸 PASS。桌面另有專屬圖示捷徑「toEfu 影片工作室」，`video-studio/open-studio.ps1` 只在本機未啟動時啟動server並開瀏覽器，無 paid／accept／promotion 動作。

- **批量自動製作（本人授權，2026-10-15）：** 工作室與影片資料夾頁首加入 `/batch`「批量產生／待確認」。本人選數量1–20與可選系列後，系統自選尚未建立且非frozen文章（跨系列round-robin）、預留各系列下一集、預設教完每篇全部來源詞彙、原文Hook、詞義Quiz；中文只顯示2秒，可靠來源翻譯自填，無可靠對應則明示不顯示逐句翻譯，配樂／片尾沿用既有提案。這是本人明確委託的 `auto-source-all-v2`（舊批次 v1 保留原決策與授權），不從檔名猜metadata。免費準備建立immutable run／envelope，列出整批maxRequests／maxSubmittedChars與逐段需求；按一次「確認用量，開始這批製作」後才可付費，逐支serial完成製作至awaiting_review，不自動接受／freeze／公開。失敗保留原因不重試，仍繼續下一支；批次狀態保存 `production/batches/*.json`。授權hash綁精確run/envelope/budget，排隊超過舊challenge TTL時只為同一已授權envelope簽新challenge；內容／費用變更仍由既有paid gates拒絕。重啟不自動重送producing影片，僅本人按繼續處理尚未開始者。3項隔離契約測試PASS（零key／付費前停止、重複開始、未知／失敗不重試、重啟、過期challenge、stale decisions／tampered budget），手機從自選→整批開始→重開→最後一次驗收PASS，既有wizard旅程PASS，真實完整pipeline假語音10 verify／6 mix PASS。未替本人建立真實批次或新增真實語音請求。詳見 `video-studio/BATCH-PRODUCTION.md`。

- **toeic-015 原文標點標示修正（2026-10-15）：** draft `c9477444-b61d-40e4-9d38-55d50db10c08` revision2 所選 `case` 的原文是 `case:`；受保護ReadingCue只去除句點與逗號，compiler只有裸字form而BLOCK。現在僅依來源marker exact range、相同normalizeToken，加入原文完整token的display alias（`case:`），不改任何原文／spoken narration／meaning／Hook／Quiz／集數／revision或ReadingCue。原真草稿 compile→validation→free voice plan 已PASS，全部decisions與narration相同，新增receipt/request0。16項離線相關回歸PASS，涵蓋冒號／分號／驚嘆號／問號／引號以及非標點字尾不冒充form；同份真實決策用隔離假語音完整assemble/camera/audit/render/mix/verify PASS，實際黃色檢查通過。尚未產生本篇真人語音或代本人接受；這輪修正不是付費授權。

- **影片資料夾分類／精簡列表（2026-10-15）：** `/videos` 改為「未上傳／已上傳」兩區，標題可拖曳；只顯示標題，點開才顯示播放／下載／保存位置，手機或鍵盤可用展開後的移動按鈕。分類由本人標記，存 `production/library-upload-status.json`，跨重啟保留，不自動對外上傳。各系列／contentId只列最新通過verify且完整可播放版本；旧版本從列表隱藏，immutable sealed／frozen 檔保留供修復，不破壞receipt／語音依賴。上傳標記綁具體runId，新版不繼承舊版已上傳。CSRF／未知或過時版本／損壞檔案拒絕；4單元／HTTP測試、隔離實際drag→server restart→mobile移回與既有wizard瀏覽器旅程PASS。無新增語音request／accept／freeze。

- **影片資料夾與舊集數修正（2026-10-14）：** 工作室頁首加入「影片資料夾」→ `/videos`。列出所有通過 verify 的 Studio 已保存 MP4（含舊版本、等待本人驗收），以及4支現存 canonical reference；可搜尋系列／contentId、播放、下載、展開並複製本機完整路徑。只由可信 run/candidate 或 canonical reference manifest 找檔，驗證 sealed bytes／frozen reference hash，沒有任意檔案路徑入口。舊編號盤點只有 `elem-012` 和較早的 `elem-02` 同為國小國中#1：本人授權修為#2，draft `192e0e8d-bfca-4dbf-91ca-12a900e7dbf5` revision5，其餘全部 decisions 完全不變。新 run `dc28bbfc-6357-49af-a50e-5b57e679d447` 沿用9語音/0 miss/4 silent完成完整免費製作，verify11/11、mix6/6、state awaiting_review；新增paid request0，沒有代本人接受。舊 immutable MP4與reference保留；下一支國小國中預填#3。集數／跨重開／並行新建／只改編號測試與手機 library/search/path/range-stream/browser旅程PASS。

- **hs-016 r14 正式免費回復完成（2026-10-14）：** draft `e7e98f79-7176-4f3e-8e5a-03bbac2e392c` revision2，原paid run `a9e43b1e-239e-4dec-a995-84943a09c909` 的 `story004En1Part2` tail slack200ms，原因是r12最終PCM修正未套split分支。原sealed語音保留，7真實pairs隔離重播全過後，正式新run `ddbedecb-e15b-49b4-b074-b99c541cf2df` / candidate `2f290027-3e2a-4573-99d0-b66e167a444e` 完成 voice/assemble/camera/audit/render/mix/verify/review preparation。verify11/11、mix6/6、9 acoustic lines PASS，問題片段tail50ms、整支max55ms；state `awaiting_review`。免費8 hit/0 miss/5 silent，decisions與revision完全不變，receipt/execution/attempt/network request/reserved chars aggregate前後相同，新增paid requests0。Promotion OFF、productionReady false，未代本人接受或freeze。本人由該draft final影片觀看後一次確認即可。詳見 `video-studio/R14-SPLIT-TAIL-RECOVERY.md`。

- **Studio 整支影片一次驗收／Quiz 排序／hs-016 定位修正（2026-10-14）：** 本人要求看完影片只確認一次，UI 提供「看完了，沒問題」，整支影片確認模式記入 receipt，接句／畫面紀錄改為選用；backend bundle freshness 與完整機器 gates 維持，未代本人接受。新 Quiz 推薦依 contentId 與詞彙 seed 分散 A/B/C，已確認的舊排序與答案保留，來源變更仍 invalidates。hs-016 revision2 draft `e7e98f79-7176-4f3e-8e5a-03bbac2e392c` 的 `mix-ups` boundary 因 helper normalization 不一致而 preflight BLOCK；Studio compiler 選唯一相容教學詞，camera 用真實 plan part end 綁定 delay，不改 ReadingCue／shared pipeline／語音文字。真草稿重新 compile/validation/free plan/preflight PASS，decisions／revision 不變；實際 envelope 有 7 個新請求，尚未付費確認，禁止宣稱全部語音沿用。舊 UI 無 envelope 時的沿用成功文案已修正；沒有新增 ElevenLabs request、接受／freeze／promotion。

- **ielts-017 r12 正式免費回復完成（2026-10-14）：** draft `fddd18eb-fcc2-41c1-af2f-76349cce05ed` revision2 原 paid run `967f7699-6345-4e45-9e2e-900cbc415af8` / candidate `0f8bd1af-7b6a-44b4-943a-4bdeb2e6d4ea` 的 3 段尾 slack 為 75/75/65ms，超過 60ms。根因是 trim 的 original 10ms grid 與 35ms head trim 後的 playback grid 不同。r12 保持 threshold/tolerance，補最終播放 grid 檢查並保留原 grid speech；健康/frozen clips byte-identical。原 paid MP3/alignment/candidate 全保留，所有 decisions 與 revision 不變。新 run `de64c6b6-bd57-40d1-99e4-c8d0e51fc07e` / candidate `d6acd540-86fc-4f02-8cac-65770de24901` 完成 voice → assemble → camera → audit → render → mix → verify → review，state `awaiting_review` / milestone `awaiting_human_review`；verify12/12、mix6/6、16 acoustic lines PASS、max tail slack55ms。免費預覽14 hit /0 miss /2 silent /0 new requests，全部既有語音沿用；receipt/execution/attempt/network request/paid chars aggregate 前後相同。Promotion OFF、productionReady false，未代本人接受/freeze/commit/push/tag。正式影片可由該 draft production/media/final 播放。免費回復另已補 `engineDrift` 判斷：共用 pipeline 更新也啟用免費重建；同一無變更 failure 仍 blocked。持久案例與品質規則見 `video-studio/KNOWN_FAILURES.md`、`AGENTS.md`，詳見 `video-studio/R12-VERIFY-RECOVERY.md`。

- **Studio 混合開場中文只顯示（2026-10-14）：** 已選的 `storyChinese.mode=subtitle` 同時套用到含中文的開場。Compiler 保留完整 `hook.text` 在畫面，新增 silent `hookReadingPause`（沿用本人設定的秒數），然後 `hookLine` 僅朗讀英文；中文不進 Arthur request，reveal 使用英文末詞，不改 shared renderer / ReadingCue / voice pipeline。純中文、沒有英文可朗讀的開場仍明確 BLOCK 並引導回開場句補英文。真實 toeic-016 draft `a744c61f-0293-422f-b601-07a8fdedc3c1` revision2 已免費重檢至 voice_planned，原 Hook／Quiz／metadata／所有 decisions 完全不變：畫面「我的 vision is not good now, so I thought it was a white handbag.」、旁白「vision is not good now, so I thought it was a white handbag.」，開場先停留 2 秒。20 項相關測試 PASS；隔離 mock 組合／camera／audit 1001 幀 shared issues 0 / extended hard 0，3.63 秒留白 soft warning 保留供實際影片人工看。新增 paid request / receipt / execution / attempt=0，Promotion OFF，未接受或 freeze。

- **Studio 混合句翻譯接線（2026-10-14）：** toeic-016 的原文含中文句號後直接接英文，以及拆分後的 `story001En1` / `story003En1`。逐句來源對應已支援此情況，中文只顯示模式不要求未使用的純中文翻譯文字逐字一致；英文片段以相鄰原文中文作 exact anchors，單一英文片段有中文語序差異時沿用來源整句翻譯一次。正式 API 已提供 wedding →「婚禮」與另兩段英文的來源翻譯。舊頁面提交空翻譯時，PUT 在原有 store 驗證前只補齊來源已可靠對應的空欄，保留非空人工修改與其他所有未保存設定。17 項相關測試與 toeic-016 隔離手機 UI 保存 → 免費規劃 PASS，key/provider requests 0。真實 toeic-016 revision1 尚未替使用者保存（其餘選項只存在未保存表單），使用者可直接保存，再重新整理；沒有覆寫草稿選擇、生成語音、接受或 freeze。

- **Studio 英文逐句中文自動帶入（2026-10-14，接續下方字幕設定）：** 已修正混合原文的中文句尾辨識，並將來源翻譯接至 subtitleProposal。「中文只顯示」時僅為英文句子自動帶入中文，原文中文不重複翻譯。真實 `elem-012` draft `192e0e8d-bfca-4dbf-91ca-12a900e7dbf5` 最新為 revision4，4 句英文皆已保存對應來源中文，兩段原文中文仍各停留 2 秒。compile / validation / free voice plan PASS；所有 spoken request hashes 與 revision3 相同，新增 paid request / receipt / execution / attempt=0，Promotion OFF。手機 UI 保存／重開／免費檢查 PASS，未要求手填 4 句翻譯；有可靠來源中文時自動帶入，無可靠對應時不捏造翻譯。

- **Studio 原文中文字幕（2026-10-14）：** 使用者明確決定原文中的中文不朗讀，畫面保留並給閱讀時間。新 `storyChinese` 決策在「原文朗讀」勾選，停留時間可設 1–8 秒；不影響 Ling 的中文詞義教學。混合段落依原文位置分成英文朗讀與中文字幕，中文使用既有 translation part + silent narration line，Studio camera / visibility / audit 對該停留期間逐幀檢查；共用 renderer / ReadingCue / voice pipeline 不改。真實 `elem-012` draft `192e0e8d-bfca-4dbf-91ca-12a900e7dbf5` 已依本人要求保存為 revision3，每段 2 秒，compile → validation → free voice plan PASS；兩段為「我們都笑了。」「他還是說這個計畫很好」。本次新增 paid request / execution / receipt / attempt=0，Promotion OFF，未代替本人接受或 freeze。隔離 mock 音訊的真實組合與 852 幀 audit hard issues 0、兩段旁白 PCM RMS 0；留白 soft warning 保留供人工查看，未聲稱真人發音已驗收。只改停留秒數不改 spoken request hash，但下游需免費重建；舊 workflow 仍依版本 freshness 規則重檢，sealed 影片／語音不覆寫。詳見 `video-studio/STORY-SUBTITLES.md`。

- **r11 language / single-take retake 已接線，P6 尚未付費 retake：** Studio compiler 明確輸出 spoken `language`（Ling zh / Arthur en），opt-in `requestContract=explicit-language-v1` 進現有 adapter 的 `language_code`；缺語言或與 speaker 不符則 BLOCK。語言與 immutable takeId 納入 request/hash/cache/evidence/receipt。舊 frozen narration 維持原 contract/hash。Retake 的人工作廢／選取決策在 coordinator immutable snapshot/checksum，其他 10 段是固定原 take evidence reuse（不冒充新語言 contract 的 cache）。新 take 成功後停 `awaiting_take_selection`；明確選為 active 才重建 voice bundle 與全部免費 downstream / verify / human review。`elem-02` revision5 原文案／CTA／Hook 決策不變，run `f9daa230-7123-42c4-b068-ed3ef299b9a8` / candidate `5a65b6e4-4b86-4b89-bfaa-f4880c57ecda` 在 `awaiting_confirmation`，只預覽 `v1Meaning=家庭作業` / Ling / eleven_v4 / zh / 1 request / 4 submitted UTF-16 chars；10 reuse +2 silent。原 1 receipt /1 execution /11 succeeded requests evidence 不變；新增 receipt/request/paid chars/key reads=0。尚未生成／active selection／接受／freeze；productionReady false、Promotion OFF。詳見 `video-studio/LANGUAGE-RETAKE.md` 與 `docs/video/revisions/r11-explicit-language-retake.json`。
- **P2 舊 reference 刻意清理（owner 已確認）：** `outputs/p2-auto-pipeline.mp4` 與 `outputs/p2-v4.2-outro-music.mp4` 已由 owner 刻意清理；不恢復或修改 frozen 路徑。stock P2 check-freeze 仍 exit2，不宣稱全資產 integrity PASS。保留的 P2 frozen hashes（含正式 music MP4）一致，P3/P4/P5 intact；四支 prepared/hash/plan/WAV parity、保留的 MP4 verify 均 PASS。此既存缺檔不再是 r11 / P6 retake gate 的待確認 blocker；保留 checker limitation。這項確認不是付費 synthesis 授權。

- P4、P5 已完成並 freeze。**P5 = `ielts-068`（IELTS #01、L2–L3），正式 frozen reference**：`outputs/ielts-068-first-render.mp4`、`docs/ielts-068-auto/FROZEN.json`。P5 沒有改共用 template；P5 的 commit 與 tag 已推上 GitHub（分支 `p5-validation`）。
- P6 開始前使用者要決定：內容、詞彙庫、`seriesEpisode`、`level`。
- **已解的 Hook 技術債（r9）：** 使用者明確選擇無中文時保存 `hook.zh = null`，Studio compiler / shared validator 可正常驗證與免費規劃。不塞空白或假中文。P5 的單一空白仍是歷史 workaround；為相容 frozen 輸入而保留接受，不修改 P5。
- **Studio source display-only 已接線：** 使用者可勾選完整原文段落「畫面保留、不朗讀」，保存 source hash、UTF-16 range、原文與 SHA-256 evidence。Compiler 僅排除已確認的 range，映射至既有 `translation` part；其餘中文仍 `MIXED_STORY_LANGUAGE` BLOCK。Source / range / text mismatch 會 invalidate 舊 workflow / plan，不猜位置。`elem-02` 真實決策的 TEMP 副本經 UI compile → validation → free plan PASS：CTA「週末你們都去哪了」保留畫面，無 CTA TTS，Hook null PASS；11 spoken + 2 silent、0 hits / 11 misses、202 estimated characters。真 draft 未代替使用者勾選或改写；重啟 Studio 後由本人選 range、保存、重編譯。接線、限制與測試見 `video-studio/SOURCE-DISPLAY-ONLY.md`；早期 probe 見 `video-studio/HOOK-NULL-CTA.md`。不修改 js/data / shared pipeline、不新增 mixed-language TTS。
- **Paid preflight 已對齊 nullable Hook：** 移除 Studio `production.mjs` 的舊 `HOOK_ZH_UNSUPPORTED` 重複規則；依現行 hash-bound compiler/shared validation，明確 null 合法、缺欄位／非法型別仍 FAIL，其餘 paid safety gates 不變。依使用者明確確認，真實 `elem-02` draft `20ee16ed-e72f-4b06-9b4c-0387fc82b0f8` 已保存 CTA display-only 為 revision4，compile → validation → free plan → exact-envelope production preflight PASS，停在 `awaiting_confirmation`。11 spoken + 2 silent Quiz、202 UTF-16 characters、0 cache hits / 11 misses；receipt / execution / attempts / provider requests / key reads 都 0。Promotion OFF、productionReady false，未 synthesis/render/freeze。Studio 已重啟；本人需刷新 UI、重新取得免費付費前預覽／challenge，核對請求与成本及 acknowledgements，才可明確確認第一次 synthesis。證據見 `video-studio/P6-EXACT-ENVELOPE-PREFLIGHT.md`。
- **P6 最新狀態（上述 zero-paid gate 是歷史紀錄）：** `elem-02` revision4 已以 r10 新 immutable candidate `576a0421-0114-491c-bc93-9cc3743beb73` / run `51f38eec-9cdb-4e58-99e0-adfd3492245a` 完成免費 recovery。原 paid run `be8e6a15-8d6b-48bb-b0d9-6bb1bd575182`、receipt、11組sealed voice/alignment/ledger 全保留；全部11 verified cache hits，新增 request/attempt/paid characters/receipt=0。Assemble → camera → audit → render → mix → verify → review preparation 全成功，verify12/12、11 spoken acoustic lines PASS；story002 start7.635011/end8.910022、voiced7.675011–8.865011、尾 slack45.011ms。722幀/24.066667s MP4 在 Studio 可播放，state=`awaiting_review`、milestone=`awaiting_human_review`，未代替本人接受、productionReady false、Promotion OFF、未freeze。Audit shared/hard issues0；7.633333s有1幀 homework 正文黃色詞彙隱藏的 soft warning，需人工核對。相同 inputs/pipeline 的 VERIFY_FAILED 已有 deterministic retry blocker（UI及API）；inputs更改後才可再驗證。詳見 `video-studio/R10-P6-RECOVERY.md`；原診斷仍保留在 `P6-VERIFY-DIAGNOSIS.md`。
- **P5 episode-level workaround：** `outro.mascot.cueDuration = 1.5` 讓吉祥物停留到 Outro 結束；這只是 P5 episode 的設定。未來若要變成預設，需要 shared-template revision + P2 / P3 / P4 regression。
- **P6 human review 暫不接受（最新 draft revision5）：** 本人回報 v1Meaning「家庭作業」像外文，v2「想睡的」／v3「週末」正常。唯讀診斷確認三段 voiceId/model/settings/context 相同，Studio lang=zh，但 HTTP body 全部沒有 language_code；response MP3與sealed/ledger/current cached copies逐byte相同，assembled PCM只做既有trim/fade，render相關性0.99998、mix6/6，問題可定位原始provider take，內部語言判斷原因未知。詳見 `video-studio/P6-V1MEANING-DIAGNOSIS.md`。沒有重synthesis、改文字/voice、接受或freeze。現有Studio只恢復failed/unknown，不支援「成功但人工不接受」的單take替換；需要explicit take variant +1 request/4 submitted characters的新確認contract與下游完整invalidate/rebuild，尚未實作/授權。ProductionReady false、Promotion OFF，診斷新增request=0；歷史P6總paid requests仍11。
- P5 freeze 時**人工接受**的 automated review warning（不是待修 blocker；已寫入 FROZEN.json 的 `knownNotBlocking`）：`review-visual` 回報 `in deadly earnest` 教學卡高約 970px（整張卡在視窗內的時間僅約 4%）、`frivolous` 教學期間故事詞組不在視窗內（0%）；人工看過、接受用於 P5 freeze；layout audit 與 verify 仍為 0 問題。
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
