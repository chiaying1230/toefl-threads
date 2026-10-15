# P6 narrow final readiness gate

2026-10-13 · branch `p5-validation` · review only.

**Verdict：B — Small fixes still required**

N1、N3 獨立驗證通過。N2 原文／base64 回顯已修，但 JSON Unicode escape 與完整
percent encoding 的 credential 仍可持久化並出現在 UI-readable diagnostics。
剩下 **1 個 P1（N2）**，沒有新 P0。第一次真實 synthesis 仍不應執行。

本報告更新 [上一輪 readiness verdict](REVIEW-2B1-P6-READINESS.md)，保留其歷史證據。
依 AGENTS、CURRENT_STATE、MILESTONE-2B.1 與目前 implementation 判斷；未修改 production code。

## 獨立負向驗證

### N1 — PASS：partial generation 受 ledger integrity 保護

`paid-voice.mjs:29–43` 的 trusted evidence 來自 coordinator 中 succeeded attempts 的
`audio_hash / alignment_hash`。Candidate bytes 對照這些原始 hashes，不會重算成新的可信證據。
`production.mjs:98` 在 reconcile 驗證 partial pairs；`paid-voice.mjs:191、207、256、325`
在 resume、cache read、下一次 dispatch 與 execution 結束重驗。

本輪獨立重現：

- request 1 成功、request 2 HTTP500、完整 voice bundle **尚未建立**。
- 改 MP3、改 alignment、刪 alignment：同一 process 的 view 即 stale；resume 409。
- ledger 原始 audio/alignment hashes 保持不變；provider count 固定 2。
- 還原原始 bytes，再 restart：舊 run 仍 stale、readiness false、舊授權 resume／recovery preview 409。
- request 2 已在 fake provider 時刪 request 1 的 alignment：request 3 及後續不送出。
  已送出的 request 2 無法撤回，因此 count 為 2；沒有因 drift 新增第三次請求。

Claude 的 fixes suite 另重跑 missing MP3 與 in-flight MP3 drift。原 adversarial cases
仍通過。沒有自動重試、把 tampered pair 當 hit、轉成付費 miss 或舊 run 自動 heal 的證據。

### N2 — FAIL：兩種標準可逆表示漏過 persistence boundary

本輪每個 case 用 `randomBytes(24)` 產生新的 **fake** `sk_…` credential。
直接走 production Studio guarded adapter，fake transport 回 HTTP401，body 與
`request-id` header 都回顯此假 credential。沒有讀取 `.env` 或使用真 key。

| 回顯形式 | response body/header | live SQLite WAL / restart 後 DB | UI-readable providerRequestId | requests |
|---|---|---|---|---:|
| 原文 + base64 | 遮蔽 | 無 credential | 遮蔽 | 1 |
| 每個字元 JSON `\\uXXXX` escape | **可還原內容留存** | **留存** | **留存** | 1 |
| 每個 ASCII byte `%XX` encoding | **可還原內容留存** | **留存** | **留存** | 1 |

Unicode case 的 wire body 是合法 JSON；解析其 message 即原 credential。Percent case
經 `decodeURIComponent` 即原 credential。這不是雜湊或無法還原的標記，也不是任意加密。
兩例保存的 `sanitization.redactions = 0`。負向測試只輸出洩漏路徑與布林結果，不輸出 credential。

根因位置：

- `paid-voice.mjs:52–65`：`secretForms` 使用 `JSON.stringify(secret)` 和
  `encodeURIComponent(secret)`。ASCII hex key 不會被這兩個 encoder 轉成 `\\uXXXX`
  或完整 `%XX`；因此 re-check 也只檢查同一個不完整 forms 集合。
- `paid-voice.mjs:278–288`：漏過的 `safe.text` 與 header 被寫進 response artifact；
  header 進 `provider_request_id`，保存到 DB。
- `paid-voice.mjs:346`／`public/production.js` ledger 顯示：encoded request ID 可以送到 UI。
  Percent message 也可能留在 persisted error；client 的原文 error redaction 不足以保護 wire bytes。

原文/base64 case 的 HTTP status、provider error code、遮蔽後 request ID 與 ledger error
仍足夠診斷。正常成功 response 的 raw wire body **逐位元組相同**，audio/alignment 正常封存。
每個 error case 都只 1 次請求，restart/GET 不會自動重送；問題是 credential persistence，
沒有證據顯示新增付費授權或 retry bypass。

**最小必修範圍**：只修 Studio 的 credential-safe persistence／diagnostic boundary
（`paid-voice.mjs`），涵蓋 JSON Unicode escapes 與完整 percent encoding；無法保證時，
保存固定診斷／status，省略可疑 payload/header 並停止，不重送。
Body、selected header、providerRequestId、error、SQLite/WAL 與 view 必須使用一致 contract。
正常無 credential response 仍需保留 byte identity；上述兩個新 assertions 必須正常 PASS，
不可改成 TODO、刪除或只檢查原文 key。無須 shared-template revision。

### N3 — PASS：restart 後真 HTTP GET 與 UI 均可讀

獨立 fixture 先走 mock voice + fake local steps，取得 explicit test approval；之後
更改 sealed narration。用 **createStudio 的實際 HTTP GET endpoint**，連續兩次 restart：

- HTTP200，不 throw；state stale、`productionReady:false`。
- canGenerate / canReview / canPromote 均 false，review null，所有 downstream steps 非 current。
- stale reason、invalidation、requires、nextActions 可機器讀取且兩次 restart 一致。
- steps / runs / receipts / executions 數量不增加，tampered narration bytes 不被重寫。
- 沒有 rebuild、heal 或新增 provider request；舊 accepted review 失效。

手機／桌面 browser smoke 另驗同一 stale narration 畫面：原因與下一步可見，沒有 Accept、
付費 confirmation 或 MP4；無 overflow、page error 或外部 browser request。

## 兩項 stale UX P2 的判定

1. **failed execution 狀態 lag／誤顯示「續跑語音」：非 P6 safety blocker。**
   新 browser smoke 在 server 已啟動後竄改 partial MP3，重載顯示 stale / readiness false，
   並確實看到該按鈕。點擊實際 endpoint 回409，provider count不增加。沒有 approval、
   readiness 或付費 bypass。仍應改善 action filtering 與 execution 狀態一致性；不能把
   該按鈕當成舊 run 可恢復的證據。
2. **stale 畫面缺 browser evidence：本輪已補。**
   `final-readiness-browser-smoke.mjs` 同時覆蓋 partial-failed 與 approved-narration stale，
   手機／桌面均 PASS。

## Regression 與 zero-paid evidence

以下除明列「沿用」外，均為本輪實際執行。Full suite 在新增獨立 gate test **之前**收集，
所以不得將它的零 FAIL 解讀為本輪全部 safety assertions 通過。

| 項目 | 結果 |
|---|---|
| Existing Studio full suite | **122 tests：120 PASS、0 FAIL、2 TODO**；新增獨立 gate test 前收集 |
| readiness-fixes.test.mjs | 9/9 PASS，含於 full suite |
| readiness-review.test.mjs | 9/9 PASS，含於 full suite |
| review-2b-adversarial.test.mjs | 9 active PASS；R2B-07/08 兩個 P2 TODO 保留原 assertions |
| safety-2b1.test.mjs | 8/8 PASS，含於 full suite |
| 2A.1 review-safety.test.mjs | 5/5 PASS，freshness / 原 2B tests 亦包含於 full suite |
| 新 final-readiness-gate.test.mjs | **9 tests：7 PASS、2 FAIL（N2 Unicode／percent）** |
| offline audio-mix + voice | **92/92 PASS** |
| browser-smoke.mjs | PASS；免費 compile / plan、保存重開、Quiz drift、手機桌面 |
| 新 final-readiness-browser-smoke.mjs | 兩種 stale 畫面 PASS，resume409、0 additional request |
| zero-paid-preflight.test.mjs | **5/5 PASS**，含於 full suite；不代表 N2 負向 assertions 通過 |
| P2 / P3 / P4 / P5 check-freeze | **四份均 PASS**；r8 shared integrity intact |
| browser-smoke-2b.mjs | **沿用上一輪 PASS**；本輪未重跑其 render-to-review UI 路徑 |

共用 zero-paid preflight 覆蓋 fixtures 的 exact request reconstruction、46 份真實
audio/alignment 唯讀 parser、5 句 interrupted sentence parts、native loopback HTTP
serialization／failure handling、guarded response persistence 與 fake-key child environment。
本輪 production response persistence 有改動，因此其正向 preflight 重新執行；N2 的
error-echo 負向證據另列，不能被正向結果取代。沿用的 2B browser evidence 只支持正常
MP4/review UI 操作；本輪的 stale UI 已用新 smoke 補驗。

P6 尚未選定，本輪無 P6-specific envelope、真實 synthesis、真實 key、canonical promotion
或 frozen render。既有 suite 的 local chain 測試只使用隔離 fixture 與 fake provider。
Remote entitlement／quota、voice/model 接受、最新 provider response、實際扣額、自然度
與 real-duration seam，只能在之後經核准的 P6 真 request／人工聆聽驗證。

## 最終 gate 回答

| 問題 | 判定 |
|---|---|
| 1. P0 是否為0？ | **是。** 本輪檢查及相關 adversarial regression 未發現 P0。 |
| 2. P1 是否為0？ | **否。1 項：N2 encoded credential persistence。** |
| 3. N1 / N2 / N3 獨立通過？ | **N1 PASS、N2 FAIL、N3 PASS。** |
| 4. 是否允許選定 P6 draft？ | 可以只選定內容、保存 draft、執行免費 plan；本輪不選、不建立 P6。付費 gate 尚未開放。 |
| 5. exact-envelope preflight 後可本人確認第一次真 synthesis？ | **目前不可。** 先清除 N2；再選定 draft，跑該 revision 的 exact-envelope zero-paid preflight，由本人確認 immutable requests、voice/model/settings、cache hits/misses、characters/budget、零自動重試與 billing disclaimer，才可開放。 |
| 6. Promotion OFF？ | **是，必須繼續 OFF。** R2B-07 尚為 publication blocker。 |
| 7. P6 人工驗收的 P2？ | R2B-08 倒捲漏報、viewport 留白、visual-policy 門檻、每句一 block 節奏、真實 seam／詞組發音、Outro 停留、Quiz 可讀性，均需本人觀看聆聽。兩項 stale UX 見上節。 |

R2B-08 不新增 paid rights、不繞過 explicit human approval，仍不升成首次付費 blocker。
Visual policy 與每句一 block 仍屬 calibration；machine PASS 不代表可以自動接受影片。
即使 N2 修好也維持 isolated candidate、exact-bundle human review、promotion OFF。

## 變更與保護範圍

本輪只新增：

- `final-readiness-gate.test.mjs`（review-only，保留兩個正常失敗 assertions）
- `final-readiness-browser-smoke.mjs`（review-only，mock voice + fake local steps，無 renderer）
- 本報告

開工 baseline 的既有 Studio／video code 與 data hashes 全部不變。`css/style.css`、
`js/app.js` 既存修改未碰；其 SHA256 與開工一致。未改 shared template、ReadingCue、
frozen reference 或 production behavior；未 stage、commit、push、tag、merge、freeze 或開通 promotion。

停在 **B**。唯一最小 blocker 為 N2，未自行修正，也未開始 P6。
