# Nullable Hook + source Chinese CTA

2026-10-13 · isolated P6 planning blockers · no paid requests.

## A — implemented

Studio store/UI 已可保存 `hook.zh:null`，但是 compiler 發出 HOOK_ZH_UNSUPPORTED，且 shared
validator 的 `need(hook,...zh)` 拒絕 null。兩者造成 Validation FAIL 與 free plan 停止。
Renderer 的 `node()` 原本就只在 text 非 null 時填 textContent，所以無須修改 renderer。

最小修正：

- `compiler.mjs` 移除舊 incompatibility blocker；明確 null 或 string 合法，其他 type BLOCK；
  output 保留 null，不填空白、中文或其他 workaround。
- `voice/episode-refs.mjs` 允許 explicit null；其他必填欄位與 string 行為不變。Missing/empty/
  invalid type 仍 FAIL。P5 歷史 whitespace string 不收緊，保護 frozen 相容性。
- Studio Hook 區域改為顯示已支援的提示；store/schema 本來已支援，無須改其 decision 格式。
- 更新 null-Hook integration / browser expectations，加 shared contract test。

Fixture 的 null Hook：compile → validation **PASS** → persistent free plan，generated/network
均0，productionReady false。有中文 Hook PASS 且 copy 不變。Browser mobile/desktop 保存重開
均正常。`ReadingCue.js`、Components、PostTemplate、paid boundary 全部不改。

已驗：offline **93/93**（原92 + nullable contract）、Studio targeted **30/30**，總 **123/123**；
四份 frozen narration/plan cross-validation PASS；四份 temporary assemble WAV/plan byte-identical；
四支既有 MP4 verify 全 PASS，輸出只到 TEMP。逐幀 regression 與 revision hash 見
`docs/video/revisions/r9-null-hook-zh.json`。P5 無既有 golden baseline，使用修改前記錄的 temporary
baseline；沒有 record/overwrite 正式 reference。原 FROZEN manifests 不改。

P4 既有 golden compare 兩次均有3幀 Outro mismatch。TEMP 舊 validator control（renderer bytes
與開工 SHA 相同）對同一 golden 也有3幀 mismatch；其重新記錄的雙 pass baseline 明確量到3幀
bit instability。這項發生在修改前 control，不能冒稱原 golden 已全 PASS；新 validator 與
control 的1473幀比較為0差異（6幀匹配工具原有的 alternate 處理），另記在 r9 evidence。
沒有放寬或覆寫正式 baseline。P2/P3/P5 分別912/1358/1351幀均0差異。

共用 validator 改變屬 r9；獨立記錄 revision 以保護 frozen metadata。預設 P2 checker 仍比較
r8，會報 validator-only shared DRIFT / exit1；reference groups 應全部 intact。r9 verification
view 在 TEMP 使用原 frozen manifest + 新 shared revision，沿用原 checker 檢查，不改 checker。

## B — initial capability probe (subsequent Studio wiring completed)

下列是最初調查記錄。後續已依使用者授權完成 explicit source-range UI/compiler 接線；
最新實作、TEMP elem-02 free-plan PASS 與限制見 [SOURCE-DISPLAY-ONLY.md](SOURCE-DISPLAY-ONLY.md)。

`PostTemplate.js:18` 的 `{type:"translation",text:"…"}` 是純畫面文字，不讀 narration line、
不建立 ReadingCue、無 TTS。`episode-refs.mjs` 只驗 text，不要求 narration reference。
例如在最後一個英文 story block 的 parts 追加：

```json
{ "type": "translation", "text": "週末你們都去哪了" }
```

Capability probe 用 fixture 證實 existing validator PASS、narration segment 數不增加、prepared
speech/free planner 均不含 CTA，source record 不變。這不是把真實 P6 手改 JSON，也不是把 CTA
冒充成 spoken reading。Static `reaction` part 同樣可只顯示文字並有自己的 DOM id；若需要獨立
visibility，可用既有這條能力，但仍需真 geometry/audit 驗證。

目前 Studio `expandSource` 將全文（包含原文最後的 CTA）編成 story speech；`english(text)`
因此擋住。逐句「中文翻譯」選擇只控制另外的 display text，**不會把原 source 那句從 TTS 移除**。
勾 translations:none、把 Hook 填中文、刪正文或寫假英文都不能合理解決。

最小 Studio-only 接線方案（不需新 shared part 或 mixed TTS）：

1. 在原文 preview 列出尾段，使用者明確確認「保留畫面、不要朗讀」，不得自動忽略中文。
2. 保存 source hash + 原始文字 range + exact text/hash + display-only choice；來源或 range
   改變需重新確認，決策 edit 依既有 revision/mutation boundary invalidate downstream。
3. Compiler 將**已確認的 range**排除於 English speech；只把原文 copy 映射成 existing
   translation/reaction display part。詞彙 marker 不得被默默排除；其餘中文仍 BLOCK。
4. 同步 source sentence/translation mapping，保留原始 offsets，避免 exclusion 使 note/parts/
   translation source hashes 對錯句。Free envelope 不得包含 CTA 或為其收 characters。
5. 若要 CTA 有自己的停留時間，使用既有 silent timing unit（CTA 文案只在 episode），由人
   確認 duration；若與最後英文 block 同步則沿用該 block timing。現有 camera/visibility solver
   與 audit 必須對新增文字的真實 geometry 判 fit/BLOCK，不能猜 offset。

本輪 B 僅調查與能力 probe；未新增此 source decision、未寫 UI checkbox、未修改 shared pipeline。
避免在沒有此人工確認時替使用者決定哪段不唸。沒有建立 mixed-language TTS。

## Real P6 status

唯讀檢查 draft `20ee16ed-e72f-4b06-9b4c-0387fc82b0f8` / `elem-02` / revision3：
英文 Hook `homework due tomorrow.`、zh null，所選 vocabulary 與 Quiz 保留。
純 compiler/validator diagnosis 已不再有 hook.zh error；**整支仍 FAIL：MIXED_STORY_LANGUAGE**，
因 source 最後一段「週末你們都去哪了」。沒有更改真 draft、article、compiled workspace 或 source hash。

Studio 正在跑的 process 需要重啟、再從 UI 重編譯；engine/fingerprint guard 會使舊 artifacts
失效，不能沿用舊 plan/receipt。CTA 的 explicit source classification 是剩餘 free-planning blocker；
geometry、audit、真人 seam/visual review 仍照正常後續流程。沒有放開 paid confirmation 或 promotion。

本輪真實 ElevenLabs requests **0**，沒有讀 `.env` / 用真 key、freeze P6、commit/push/tag。
Frozen P2–P5 metadata 與 assets、其他既存 css/style.css / js/app.js 修改均不碰。

新增／修改檔案：shared `voice/episode-refs.mjs` 與其 test；Studio `compiler.mjs`、
`production.test.mjs`、`browser-smoke.mjs`、`public/index.html`、新 `hook-cta.test.mjs`；
`docs/video/CURRENT_STATE.md`、`docs/video-design-system.md`、外置 r9 revision JSON 與本文件。
