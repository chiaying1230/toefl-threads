# Milestone 2A — compiler / validation / free voice plan

範圍：延伸已驗收 M1；不製作 P6、不付費、不產出音訊 / 影片。Branch `p5-validation`。所有改動都在 `video-studio/`，canonical rules 與 `scripts/video` 未改。

## Compiler architecture

`DraftStore` 保存人工決策 → `compileDraft` pure compiler → 兩份現行 production schema JSON + compile report → `validateProduction` existing validators → `freeVoicePlan` existing planner。`ProductionWorkflow` 管理隔離 workspace、每步持久結果、hash / revision 防護與 fail-stop。HTTP 不接受任意 CLI、file path 或 output path。

```
draft → configured → compiled → validated → voice_planned
                         FAIL ──停止──┘
```

每次編譯使用新的 `workspaces/<draft UUID>/revision-N/<run UUID>/`，exclusive-create JSON。實際 narration / episode 檔名與內容 id 符合現行慣例；artifact 中 `/docs/<contentId>-auto/<contentId>-auto.plan.json` 和 `narration.wav` 是 canonical production target 的 reference，**本輪不建立這些 paths**。Frozen source 的隔離 dry-run 不改 frozen assets，不能把 draft artifacts promote 或 render。沒有第二套 episode format；工作狀態、report、production JSON 分開。

## Decision → production mapping

| Draft / source | Narration / episode output | 限制 |
|---|---|---|
| contentId | narration.id、episode.id=`<id>-auto`、contentId、plan/audio target refs | 不從 ID 推 series / episode |
| 明確 series / seriesEpisode / level | 原樣結構化 episode metadata | 不把建議自動寫入 |
| author、topic | episode.author.name/avatar/meta、social、hook.label | 來自 characters / post；缺資料讓 validator FAIL |
| series.json | outside、status.reading | 中性來源文案，不發明宣傳文字 |
| 選定 Hook 英文 | story-kind `hookLine` + scene_contrast.setup | 只編譯已保存的選擇；payoff=[]、last-token reveal 是內容 scaffold，choreography unresolved |
| Hook 中文 / absence | episode.hook.zh=明確文字或 null | null / whitespace BLOCK；不塞 `" "`、不改 shared validator；中文只显示，不送 Arthur |
| source `[[key\|shown]]` | 精確來源範圍、word / forms、教學位置 | 不推 morphology；跨句詞組、ReadingCue 無法 highlight 就 BLOCK |
| selected vocabulary | episode.vocabulary、story vocabulary parts | 只在來源第一次出現教學，按照故事位置排列；ID 依 deterministic selected indices |
| source zh / pos / ex / exZh | 詞卡 zh / pos / exampleZh；Ling meaning / Arthur example | 來源不改。旁白預設原詞義，顯示省略號 / 破折號需人工 meaningSpeech；中英混合段 BLOCK |
| sentence / punctuation | 一個 story segment；必要時 `parts.after` / `resumeAfter` | reuse `layoutParts` 確認實際 char boundary。句尾教學用 plain segment；整句只有一次 TTS unit |
| selected meaning Quiz | episode.quiz word/options/answer、quote、question/answer refs、source feedback | 選項用已確認 snapshot；Question / answer 是兩段 silent quiz，無付費 speaker |
| timing scaffold | gaps、教學動畫、silent Quiz timings | 明確 `DRAFT_TIMINGS` 輸出於 report，不是新 canonical production defaults |

Reliable 範圍：source marker 展開、來源詞形映射、明確 metadata / 詞義 / 例句、line / part / note / block references、可唯一定位的標點 handoff、phrase intact、Quiz refs、免費 counts / voice assignment。沒有編輯 js/data、轉成 legacy episode format 或猜 alignment。

## BLOCK 與 unresolved

**阻擋 validation / plan**：無中文 Hook、mixed-language story / Hook / example / meaning、獨立顯示破折號、缺來源欄位、同一邊界多個教學、ambiguous repeated cut word、after 解析與來源位置不符、同句超過兩次打斷、phrase crossing sentence / part、來源行无法亮起詞彙、無效選擇。Compiler 若可產生草稿，編譯成功但 `blocked[]` 非空；validation 必須 FAIL。Compiler 技術失敗 / incomplete source 則停在 compile，不假裝輸出可用。

**延後至 2B，允許免費 plan 但 productionReady=false**：camera（只有初始 Hook anchor at 0 / offset 0）、visibility（空，未假裝已有 streaming timing）、Outro（未輸出）、layout / 分行、Hook choreography、planning timings、逐句中文對照、配樂 / soundEffects、整句 parts 接縫實聽 / cut:late。未複製 P5 zh 空白、camera offsets、visibility 或 cueDuration=1.5；Outro 預設也未改。

## Existing validation / planner

Validation 直接 import：`prepareNarration(...,{requireApiKey:false,env:{}})` → `linesFromNarration` → `validateEpisode(...,{warnings})`。保留既有問題為 structured errors，並將 compiler blocked decisions 納入 FAIL。Scope 明示 `narration-schema-and-episode-references`；不是 layout / render / audio verification。PASS 綁定 narration、episode、compileReport 的 hashes；plan 前再讀取 / 驗證三份 artifacts 與 validation report，任何 tamper 都 fail-stop。

Voice plan 直接 reuse `planNarration`，只提供 `cache.has` read capability。沒有 `generateNarration` / synthesize 調用、沒有 `--yes` / CLI、沒有 `.env` 載入、沒有 API key 需求。`segmentCount`、hit/miss/silent/duplicate、`charsToGenerate`、speaker / voiceId / model / language、part IDs、playback order 都保存在 voice-plan JSON 與 state。`generatedThisRun=0`、`networkRequests=0`。Cache hits 是現有 planner 的 MP3+alignment existence 檢查，沒有宣稱已驗證音訊。

## Persistence / freshness

保留 M1 schemaVersion=1（向後相容，新增 Hook zh、meaningSpeech、workflow 等 additive fields）。每步保存 `name,status,startedAt,finishedAt,inputHash,result{status,errors,warnings,blocked?,unresolved?,verdict?},artifacts`。`workflow` 保存 runId、compilerVersion、sourceHash、decisionRevision、inputHash、failedStep、timestamps、mode、productionReady。Failed 狀態保留最後成功 milestone：validation FAIL 時仍 `compiled`，voice plan FAIL 時仍 `validated`，不假裝成功。Output refs 存 path/hash/revision/sourceHash。

每次 API reload canonical data，不只信 browser / startup cache。source、decisions、revision、compiler、shared helper、voices.json、series.json hash 綁 workflow；drift 時清除 active artifact refs，保存 freshness failed reason 與歷史 refs。Source 變更需新 draft；工具 / voice config 變更需重新編譯。已載入程式碼改變必須重啟 Studio，不用舊 import 模組搭配新 fingerprint。Artifact JSON hash mismatch 同樣阻擋。

修改人工決策即清除 steps / artifacts / workflow，archive 最多十筆歷史摘要 / refs；舊隔離檔案仍保存，不自動刪除。Step running 在重啟後視為 interrupted failed，需重新編譯或依 prerequisites 重做該步。UI 不可提交自訂 workflow status / artifacts / approvals。同步 pure pipeline 順序執行；沒有 background paid job 或 renderer port 競爭。

## UI / files

新增 Hook 中文與 Ling 唸法決策欄位。Production 區有 combined run、compile、validation、free plan 按鈕；dirty draft 先保存；展示逐步 ✓ / FAIL、errors、warnings、blocked、unresolved、原始 JSON 詳細結果與 artifact preview links。Plan 摘要顯示段數、generatedThisRun 0、silent、cache hits / misses / duplicates、預計 characters、每段 speaker / model。結果重開可恢復，沒有付費按鈕。

新增：`compiler.mjs`、`production-validation.mjs`、`free-voice-plan.mjs`、`workflow.mjs`、`fixtures.mjs`、`production.test.mjs`、本文件。修改：`store.mjs`、`server.mjs`、`public/app.js`、`public/index.html`、`public/style.css`（JSON details 排版）、`browser-smoke.mjs`、README、ARCHITECTURE、VALIDATION。Runtime artifacts / QA 截圖僅在 ignored state；沒有寫正式 production artifacts。

## 2B 前尚缺

- 無中文 Hook 的 shared schema 路徑仍 BLOCK，等使用者決定 revision；本輪不必改 shared code 即可完成 compiler / validation / plan。
- Canonical promotion、frozen hash paths denylist、existing-path exclusive guard、paid plan-bound explicit confirmation / limits，尚未接通。
- 真實 voice generation 與可恢復 manifest、assemble、人工聽接縫、camera anchors / fit、visibility、Outro 人工文案與參數、layout audit / fix、render / mix / verify / review-visual orchestration。
- Plan counts 尚是 cache-existence snapshot，真正生成前必須重新計畫並綁定 confirmed hash；不能沿用過期 consent。
- 實體手機 LAN 存取的 token / authentication；目前仍 loopback，responsive UI 測試通過但不是 LAN 已開通。

在 2A 完成後停止，沒有開始 2B。
