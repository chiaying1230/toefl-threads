# N2-only P6 readiness gate

2026-10-13 · `p5-validation` · review only.

**B — Small fixes still required**

上一輪兩個 reproducer 已原樣 PASS；N2 整體仍 FAIL。有限的獨立矩陣發現兩個剩餘
persistence boundary 缺口：base64／hex 與其他 encoding 的兩層組合，以及被保存的 header
名稱。仍屬同一個 N2 P1，未重開 N1／N3 或其他架構議題。

## 原樣 reproducer

先讀 AGENTS、CURRENT_STATE、REVIEW-P6-FINAL-GATE，再執行：

```powershell
node --test --test-isolation=none --test-name-pattern="FINAL N2" video-studio/final-readiness-gate.test.mjs
```

**4/4 PASS**：literal/base64、原本 FAIL 的 JSON Unicode escape 與 fully percent encoded、
正常成功 wire response byte identity。沒有改 assertion，也沒有執行此檔的 N1／N3 tests。
該檔 SHA256 開工／結束一致：
`44CD1853DC4EE21DBDC0BD8D200CE1E3E2AF74A81597F0EDA1F7A0B7B40EA054`。

## 有限的獨立 boundary matrix

新 review-only `n2-only-boundary-review.test.mjs`。每例以 `randomBytes(24)` 產生新的
fake credential；透過現行 guarded Studio adapter、HTTP401 fake provider，分別在 body
與 selected header echo。掃描整個 temporary workspace（含 live WAL），關閉／restart 後
再掃 SQLite、response、其他 persisted files，並檢查 UI-readable view。
沒有讀取 `.env`、使用真 key 或向 ElevenLabs 發 request。

| Case | 結果 | 證據 |
|---|---|---|
| Partial percent | PASS | Body/header 遮蔽，disk/view 無可還原 credential |
| Three-layer percent | PASS | 同上 |
| Literal + Unicode + percent 混合 | PASS | 無法 token-wise 安全遮蔽時 payload/header 省略，fail closed |
| Base64url | PASS | Body/header 遮蔽 |
| Hex | PASS | Body/header 遮蔽 |
| Base64 後 percent encode | PASS | Body/header 遮蔽 |
| **Percent 後 base64 encode** | **FAIL** | response artifact、WAL、restart DB 與 view 留存可還原內容 |
| **Base64 兩次** | **FAIL** | 同上 |
| **Percent 後 hex encode** | **FAIL** | 同上 |
| JSON character-array segmentation | PASS | `raw:null`、headers 空、providerRequestId null、SECRET_SANITIZATION_FAILED |
| **Selected header 名稱 echo** | **FAIL** | response artifact 的 header key 保存 literal credential；此例 DB/view 未發現 credential |

**11 tests：7 PASS／4 FAIL**。沒有 TODO，失敗 assertions 保留。所有案例只有 **1 次 fake
request**；idle、restart、GET 不增加 request count，readiness false。已偵測的混合／分段
case 不保存 secret-bearing payload/header；正常 response byte identity 由原 reproducer
與 targeted tests 驗證。失敗案例的 `sanitization.redactions = 0`，不是成功遮蔽後誤報。

這不是無限 fuzzing：三個 encoding 反例均只兩層、使用標準 base64／hex／percent。
Reproducer 用獨立 `Buffer.from(...,'base64'/'hex')` 加 `decodeURIComponent`，確定能還原
假 credential；不以 production decodeView 作為自證 oracle。

## 唯一 P1 的最小修正範圍

只需修 **Studio `paid-voice.mjs` credential persistence boundary**，不需改 shared template。

1. **兩層 base64／hex 組合沒有進入 decoded comparison。**
   `paid-voice.mjs:61–88` 的 decodeView 解 escape／percent／HTML entities；base64／hex
   仍只比對原 key bytes 派生的 forms。因此 `base64(percent(key))`、`base64(base64(key))`、
   `hex(percent(key))` 都被當作安全文字，進 response 與 `provider_request_id`／ledger
   diagnostics。最小 acceptance 是有限、受限的 composed decoding／comparison，或無法
   安全判斷時省略可疑內容並 fail closed；須保留正常 response bytes 與零自動 retry。
2. **Provider-controlled header 名稱沒有檢查。**
   `paid-voice.mjs:317–322` 使用廣泛的 substring regex 選 header，只 scrub value，
   直接把原始名稱寫入 `headers[k]`。`x-request-id-<fake credential>: diagnostic-id`
   因此原文落盤。只接受 exact known header names，或同樣檢查名稱並拒絕不安全名稱，
   即可關閉此路徑。已遮蔽 value 不應從任何其他欄位重新寫回。

本輪沒有實作修正。兩項是同一 N2 finding 的最小剩餘範圍，沒有 paid retry、approval 或
trust-root bypass 的證據。

## Targeted regression

沒有重跑 full Studio、offline、browser 或 frozen suite。

```powershell
node --test --test-isolation=none --test-name-pattern="^N2|^ZERO PAID: guarded|^envelope =|^zero automatic paid retries|^unknown provider outcome|^budget and request-body|^double" video-studio/readiness-fixes.test.mjs video-studio/zero-paid-preflight.test.mjs video-studio/paid.test.mjs
```

**19/19 PASS**：現行 N2 6 tests（含有限 forms matrix、fail-closed payload、正常音訊與
alignment）、guarded native loopback response persistence／unknown outcome、receipt／planner
bindings、double click、budget/body guard、HTTP/network/timeout/parser/alignment 零自動 retry。

N1／N3、原 P0、offline、browser、P2–P5 integrity 沿用上一輪獨立 evidence；Claude 回報的
新 full suite 與 freeze/browser 結果列為補充 evidence，**不是本輪獨立重跑的結果**。
N2 新反例並未由這些正向 targeted results 排除。

## Final gate

| 問題 | 回答 |
|---|---|
| 1. N2 PASS？ | **否。** 舊兩個 bypass 修好，剩餘兩個 boundary 缺口如上。 |
| 2. P0 為0？ | **是，沿用先前 P0 evidence；本輪未發現新 P0。** |
| 3. P1 為0？ | **否，仍 1 個 N2 P1。** |
| 4. 可開始選定 isolated P6 draft？ | **可以只選定內容、保存 draft、免費 compile／validation／plan；本輪不開始。** |
| 5. P6 exact-envelope zero-paid PASS 後可本人確認真 synthesis？ | **目前不可。** 須先清除 N2，再通過該 revision 的 exact-envelope preflight，由本人確認 immutable requests、voice/model/settings、cache misses、characters/budget 與 retry/billing policy。 |
| 6. Promotion OFF？ | **是，繼續 OFF。** |
| 7. P6 人工驗收 P2？ | 沿用 R2B-08 倒捲漏報、viewport 留白、visual policy、每句一 block 節奏、seam／詞組聆聽、Outro／Quiz；stale resume UX 仍非 safety blocker。R2B-07 只阻止 promotion/publication。 |

新增只有本報告與 review-only test。既有 production/test files、`css/style.css` 與
`js/app.js` 開工 baseline hashes 全部不變。沒有真實 provider request、真 key、P6、
promotion、shared/frozen 寫入、commit、push 或 tag。停在 **B**，未自行修正。
