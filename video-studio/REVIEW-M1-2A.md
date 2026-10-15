# Focused architecture review — M1 + 2A

日期：2026-10-12。Verdict：**B — approved with minor fixes**。保留現有分層；以下 R1–R5 必修完成、safety assertions 通過前，不應開始 2B。這裡的 minor 指修正範圍局限於 Studio，並不表示 stale state / 人工決策問題可以忽略。沒有要求重寫 renderer 或變更 canonical production schema。

Review 範圍：先讀 AGENTS、CURRENT_STATE、video-design-system、Studio ARCHITECTURE / MILESTONE-2A，再讀 Studio implementation / tests 和直接相關的 narration / episode validator、planner / cache、assemble、camera、render / verify interfaces。沒有無目的掃 repo。只新增本報告與 review-safety tests，沒有修改 production behavior。

## Findings（依實際影響）

### R1 — P1：artifact drift 沒有作廢「已顯示有效」的 voice plan

位置：`workflow.mjs:33`（reconcile）、`:56`（read）、`server.mjs:44`（artifact GET）、`public/app.js:117`（plan 顯示）。

重現：完成 voice_planned → 改隔離 episode JSON 的 seriesEpisode → reconcile / GET draft 仍回傳 voice_planned，voicePlan succeeded result 仍在。GET voicePlan 只 hash-check plan 自己，沒有查 episode / narration 依賴。再次**執行** validation / plan 時能阻擋，這點正確；但尚未再次執行前，UI 與 API 把舊 plan 視為 current。

修正範圍：Studio workflow freshness 檢查需要包含成功階段的依賴 artifact hashes / existence / parsing，錯誤時作廢該步及下游 active results、保留歷史 evidence；job GET / artifact GET 必須使用同一有效性判定。不能只清一個錯誤訊息而留 succeeded plan。UI 只展示「對當前 revision / run 有效」的結果。

### R2 — P1：保存 Quiz 時可悄悄更改人工已確認的選項

位置：`store.mjs:35–46`、`catalog.mjs:43–46`、`public/app.js:31` / `:75`。

UI 只送 candidateId，server 保存時重新從**全域** vocabulary 產生 candidate。SourceHash 只包含該 post / author / post 詞彙，沒有包含外部 distractor dependencies。真實 p1 的 ubiquitous 題第三選項來自另一篇的 arbitrary；當 arbitrary 詞義改變，p1 sourceHash 不變，同一 radio ID 保存後換成不同第三選項。重新打開 UI 也會顯示重新推薦的題，而不是 saved snapshot；compiler 卻用 persisted snapshot。

修正範圍：版本化候選或 candidate hash，human confirmation 綁定**完整 options / answer snapshot**。保存與 compiler 必須使用已確認 snapshot；候選來源變更需要 409 / 明確重新確認。UI 恢復要顯示 saved decision，將新推薦當成新候選，不以相同 ID 默默替換。這是現有唯一需要修補的「人工決策 source of truth」裂縫。

### R3 — P2（付費前必修）：request body 等待期間可能使用 stale source

位置：`server.mjs:23` 與 `:27`。

Catalog 在讀 request body **之前** refresh。測試送半段 POST body → 等 server 完成 refresh → 切換 source snapshot → 補完 body。Workflow 仍用舊 store.catalog 到 voice_planned。現有 source drift 測試只涵蓋 request 開始前變更，漏掉此時序。

修正範圍：完成 body 驗證後，在 mutation 實際開始時取得 fresh、request-local catalog；不要依賴 handler 間共用的可變 store.catalog。HTTP revision check 和 source / engine fingerprint check 必須同一操作邊界。2B 的 async steps 另需 durable revision / run lease，不能把舊 draft object 完成後整份覆寫。

### R4 — P2：英文斷句假設在真實資料產生不正確 TTS units

位置：`compiler.mjs:43`。

直接 Intl.Segmenter 並非已驗證的 English sentence model。真實 p186 的 `Mr. Holmes solves crimes ...` 被拆成獨立 `Mr.` 與 `Holmes ...` story segments，compiler / shared validation 全 PASS、沒有 ambiguity warning。Fixture 的句子太規則，沒有涵蓋縮寫 / 引號 / 時間。這會在付費後才暴露錯誤語調 / pause；目前的「每句一次 TTS」只對已正確辨識的句子成立。

修正範圍：Studio source sentence adapter + tests；支援可驗證的縮寫 / 原文 boundaries，無法可靠判定時 machine-readable BLOCK / sentence decision，不把片段當完整句。測真實 p186、Mr./Dr.、a.m./p.m.、引號與 phrase 跨界。保留整句一次 TTS + parts；不改 shared segments 或 ReadingCue。

### R5 — P2：stale / early failure workflow 缺 productionReady=false

位置：`workflow.mjs:27–42`。

成功 compile / validation / plan 與新 run 的 productionReady 都明確 false，沒有 route 可以設 true。可是 reconcile 的 stale workflow 使用新 object，遺漏 productionReady；部分 compile 前失敗亦相同，得到 undefined。當前因 action allowlist 沒有 production capability，所以沒有實際 render bypass；但不符合「任何 2A job 都是明確 false」的資料契約。

修正範圍：Studio 統一 workflow factory / failure / invalidation shape，所有 2A 結果明確 false。2B readiness 應由 server 依 required evidence / unresolved / revision hashes 推導，不能把 client label 或可編輯 JSON boolean 當授權；absence 必須 fail closed。

## Correctness / production truth

- **沒有新發明 narration 或 episode schema**：compiler 正確輸出現行 segments / parts、vocabulary / story / Hook / Quiz、structured metadata 和 canonical target path 慣例。Draft、reports 是另一種工作狀態，合理而且不應直接拿去 render。
- `prepareNarration(requireApiKey:false, env:{}) → linesFromNarration → validateEpisode` 是現有 validation。Studio 的 mixed-language / ambiguous-handoff / missing-decision BLOCK 是 compiler 支援範圍檢查，沒有取代 shared validator。
- Source marker 的 key / explicit shown form 進 word/forms；phrase 必須在一個 reading line 內，與 shared phrase functions 接合。Nearest punctuation 有 `layoutParts` 再驗證 char boundary；collision / repeated target / 同句 >2 interruptions fail-stop。多 vocabulary 的 playback order、meaning / example / close refs 在 fixtures 與既有測試成立。
- Hook 英文對應 story role，中文純顯示；Quiz question / answer 是 silent segments；roles / speaker / model 來自 voices.json 與 prepareNarration，沒有 Studio 第二套聲音規則。
- No-Chinese Hook：store trim 後 null → compiler output null / blocked reason → current validator FAIL → 不跑 plan；既有測試與 browser smoke 證實。沒有空白 workaround，沒有改 shared validator。
- Known incomplete fields 沒有被假裝完成：camera 只有初始 Hook、visibility 空、Outro 省略、layout / timing / seam 等 unresolved。2A allowlist 只到 voicePlan，其他 capabilities 不存在。R5 修正 metadata 完整性後，仍須保持這個 ceiling。

## Duplicate logic / coupling

- Store 與 shared validator 重複正整數集數、level 1–3 / range、emoji 等規則；可用 shared-contract parity tests 保護，未必為抽 helper 而動 shared code。
- Markup 展開有 `catalog.plain` 與 compiler 兩種實作；前者只換 underscore，後者會用 source word / w。應讓候選與 compiler 共用 Studio source adapter，避免 word aliases 出現不同英文。
- Compiler 重複 punctuation regex、ReadingCue cue normalization；它有 reuse layoutParts / phrase matching 的最後驗證，所以目前多數歧義是安全 BLOCK，但應加 contract parity coverage。
- `english()` 實際只是「沒有 BMP Han」，不是語言識別；未知 script / 非英語來源必須在 production preflight 明確處理，不能宣稱多語言已支援。
- `mapping.sourceRange` 是**展開 marker / 移除 emoji 後的 plaintext range**，不是 raw post range。後續 source evidence / UI highlight 應明確命名並另存 raw range，不能直接索引 js/data 原文。
- App 的 batch / pack 載入清單在 catalog 硬編碼，UI 與 store 的 complete checks 也重複。新 data batch / 新欄位需 parity / manifest 管理，避免維護 drift。
- 每個 API reload 全 catalog（923 篇）是保守 correctness 選擇；2B progress polling 不應每次做整個 VM data load，可用 source file hashes cache，但 mutation boundary 的 freshness 不可拿掉。
- Existing production tools 的 REPO_ROOT / HTTP allowroots 是 coupling：renderer 只 serve scripts/video、docs，Studio state 不在允許範圍；episode plan/audio 仍指 canonical target。**只傳 --out 到 temp 並不能隔離 inputs 或其他 writes**。不要在 2B 直接把當前 draft JSON交給 render / assemble CLI。
- Compiler cueKey 保留 `! ? ; :`，fit-camera / review-visual 的 word lookup 卻移除更多 punctuation；例如 supplies! 可 schema PASS，但未來 camera adapter 不能直接假設所有 open.word 都能被這些 helpers 定位。需 wrapper preflight / adapter parity，無需本輪修改 shared helpers。

## State machine / safety

Milestones 是持久 server transitions，不只是 UI labels；prerequisites、start / finish、errors、timestamps、artifact refs 確實保存。Decision update 提升 revision 並清 active artifacts / steps；source / dependency fingerprint drift 清除下游；重啟 running 標成 interrupted。單一 server 中同步 pure workflow 不 yield，配合 optimistic revision 可保護一般 concurrent windows。R1–R3 是尚未完整覆蓋的 edge cases。

JSON + rename 提供單檔 atomic save，**不是**跨 process compare-and-swap / job transaction。兩個 Studio processes 可共享 stateDir，沒有 file lock；2B async generation 若沿用 finishStep(draft) 整份 persist，也可能覆寫更新後的 draft。付費前需獨立不可變 job input snapshot、durable lease / mutation lock、revision + runId check。

目前沒有 HTTP 路徑能傳 shell command、--yes、任意 output path 或呼叫 generate / render / freeze / git。固定 spawn 只打開 loopback browser。沒有 .env loader 調用；pure plan 僅有 cache.has。Static assets / artifact names 有 allowlist，Host / Origin + loopback、JSON Content-Type、CSP / textContent 保護本機 UI。Workspace writes exclusive-create，檢查 parent realpath / symlink；HTTP 不允許改 stateDir。

限制：這是可信本機 checkout / state 的隔離，不是對本機任意改 JSON、junction、程式碼的人提供安全 sandbox。VM 只執行 repo-owned source，不能未來拿來執行使用者上傳 scripts。Phone LAN / 外部存取尚未授權或實作。

## Voice plan 可相信到哪裡

Segment / hit / miss / silent / duplicate、charsToGenerate 都直接來自現有 planner；chars 來自 prepareNarration 的 `speak.length`（JS UTF-16 長度），聲音從既有 cfg resolve。沒有 Studio 重新估算；數字可作為**當時未 cached 的 unique request texts**的確認基礎。

不能直接當成不可超過的實際 ElevenLabs 扣額：cache.has 只看 MP3+alignment 是否存在，非內容完整性；cache 可變，plan 是 timestamp snapshot；既有 generator retry 會重新呼叫 synthesize，maxChars 只比較初始 plan sum，不是所有 attempts 的累計上限。本 review 未驗證 provider 對 retries / normalized text 的實際 billing，不能宣稱最終扣額等於此值。

2B 的 hard confirmation boundary 建議獨立 server endpoint / paid executor：重新 read / validate job → 重新 plan / 驗 cache → 顯示 exact miss hashes、spoken text / characters、voice/settings/model/output、retry policy → 人工確認一次性 receipt（revision + runId + input / artifact / plan hashes + expiry + budget）→ durable lease 消耗 receipt → 才讓唯一 paid worker 取得 credentials。Changed inputs / 增加 misses / 不明確 request outcome 必須停下重確認或走明確 consent 的 bounded recovery。不得以 UI checkbox 布林或 generic workflow action 代替此 boundary。

## Promotion model（設計，未實作）

1. **Studio revision workspace**：維持 immutable outputs + hashes，不寫 canonical；record / decisions / engine version 固定。
2. **Verified production candidate**：在隔離 candidate root 保留與目前 pipeline 完全一致的 scripts/video、docs/<id>-auto、outputs path layout，複製所需 shared code / assets 並驗 hash，不複製 .env / frozen episode outputs。既有 CLI 的 REPO_ROOT 因而指 candidate root；voice/cache writes 也必須隔離。Generated assets、final camera/visibility/Outro episode、plan/WAV、narration-only/final MP4、all reports 成為同一 immutable manifest bundle。這是建議的 interface adapter；本輪沒有建立或 render candidate。
3. **Explicit human approval**：觀看 final MP4 / 聽接縫，接受 warnings 或 needs changes；approval 綁 exact bundle hash 與 revision。修改任一 artifact / decision 就失效。付費 confirmation、影片 acceptance、canonical promotion、freeze 是不同授權邊界。
4. **Canonical promotion**：獨立 promotion coordinator，先檢查當前 revision、engine hash、verified evidence / readiness、human approval、目標 content / series collision 與每份 FROZEN.json 記錄的全部 protected paths。拒絕任何 existing destination / overwrite；不能只查四個 IDs。
5. **Transaction barrier**：同一 filesystem staging、全 bundle preflight、exclusive lock、可恢復 journal、exclusive-create target files、最後 atomic publish committed manifest。只有 committed bundle 可被 Studio / production wrapper 視為 canonical。Crash rollback 只移除本次 transaction 建立且 hash 相符的檔案，絕不動 frozen / 其他作者檔案；恢復前禁止 production consumers 讀未完成 transaction。

重要限制：現有 assets 分散於 scripts、docs、outputs，檔案逐一 rename **不是跨目錄 atomic bundle promotion**。Existing raw CLIs 不知道 committed manifest / lock；只加 marker 卻不管讀者仍可能觀察 partial files。2B 必須讓所有 Studio-controlled production invocations 經 coordinator gate，並明確禁止 raw CLI 與 promotion 同時運作；若要求所有 legacy readers 也具備真正原子 publication，就需要另提 canonical layout / reader contract revision，不能本輪偷偷改規則。

Freeze 仍另行明確人工確認；promotion committed 不代表 frozen。不要自動建立 tag / commit / push。

## Camera / visibility recommendation

採 **deterministic semantic anchors + geometry-driven heuristic solver + deterministic full-frame audit**。AI 可以提供需人工審核的分段 / display copy proposal，不能產生未經檢查的 offsets / alignment times 或自動豁免 audit。

- Anchor 根據真實 plan 的 story reading、vocabulary open / close、Quiz、Outro；time refs 保持與 renderer normalization 一致。沒有音訊 alignment 前只提出 unresolved anchors，不定 final offsets。
- 用實際 browser/font/viewport geometry 解 active cue、whole phrase、教學卡可讀範圍、單向移動與 note animation / camera settle overlap；既有 fit-camera 可作初值 / supported-subset adapter，不是已完成完整通用演算法。
- Visibility 基於前一段開始與當前 viewport 的 lookahead constraints，並考慮 camera move、語音 pause、提前透露 Quiz / story；不套 P5 delay 常數。
- 全幀 layout audit + visual review 檢查 horizontal / vertical bounds、phrase / card visibility、camera reversals、空白停留與 premature reveal。現有 audit 不涵蓋所有審美 / 語意，零 issues 不代表所有 production criteria 成立。
- 約束無解（例如教學卡比 viewport 高）就 machine-readable BLOCK / 人工內容決策；不能為了 PASS 刪掉所選詞彙、補假 timing 或直接沿用 P5 accepted warnings。

## 2B 五大風險

| 排名 | 最容易失敗的地方 | 建議 barrier |
|---|---|---|
| 1 | 付費重試、double click、多 process / async stale revision、cache 假命中或 collision | receipt 綁 exact inputs、durable per-job / per-hash lease、bounded attempts / unknown outcome 停止、生成前 re-plan；不要覆寫 frozen alignment |
| 2 | Sentence / phrase / punctuation / mixed language 與真實 alignment 不一致 | 先修 R4；compiler supported grammar + preflight、整句一次 TTS、拒絕不明確 mappings；不能等付費後才發現基本斷句錯誤 |
| 3 | Camera / visibility 在長卡、長例句與 animation overlap 下無法自動 fit | semantic anchors + actual geometry heuristic + full-frame constraints；無解時明確停在該步 |
| 4 | Schema / verify PASS 但接縫不自然、mixed audio / final MP4 與審核版本不同 | narration-only verify 與 final mix checks 分開；人工 seam review / final playback acceptance 必須綁 artifact hash；避免 render auto mix 後再混一次 |
| 5 | 既有 CLI 固定 root/ports、非原子 promotion、同 content / frozen paths collision | candidate root isolation、serialized renderer/preflight、transaction coordinator、全 FROZEN path denylist、exclusive destination、freeze 獨立確認 |

## Tests / 本輪改動

- 原 Studio tests：**14/14 PASS**。
- Existing offline audio-mix + voice：**92/92 PASS**（mock APIs / 免費 CLI smoke；沒有付費或 reference render）。
- Existing browser smoke：**PASS**（M1 保存恢復、no-Chinese FAIL、Chinese PASS、免費 plan / reload；手機 / desktop 無 overflow、pageerrors、外部 network）。
- P2 / P3 / P4 / P5 check-freeze：皆 exit 0 / intact。
- 新 `review-safety.test.mjs`：**5 個 TODO，五個預期 safety assertions 都失敗，已重現 R1–R5**。Node TODO tests 的 exit code 0 不代表 acceptance PASS；修正後移除 TODO，必須轉成正常通過的 regression tests。
- 本輪僅新增 `REVIEW-M1-2A.md`、`review-safety.test.mjs`；沒有 production implementation 變更。Browser QA 只更新 ignored state/qa。
- `css/style.css` 與 `js/app.js` 不讀其實作、不改、不 stage/revert；結束以 SHA256 比對確認兩者和 review 開始相同。
- 未開始 2B，未 paid voice、render、freeze、commit、push、tag 或 merge。

精確必修範圍：R1 workflow / API effective results + tests；R2 store / candidates / Quiz restore UI + versioned decision tests；R3 server mutation freshness + request-local context tests；R4 Studio source sentence adapter / compiler + real corpus boundary tests；R5 workflow shape / server-derived readiness tests。**都可先在 video-studio 完成，不需要碰 shared template、ReadingCue、frozen references 或 canonical production rules。** Promotion / paid executor / camera solver 是後續 2B 設計，不在本輪實作。
