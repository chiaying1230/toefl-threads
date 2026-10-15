# N2-only final gate

2026-10-13 · branch `p5-validation` · review only.

**A — Ready for isolated P6**

N2 **PASS**。上一輪四個 failing cases 已原樣通過；新增的有限 success/depth/header/
transport adversarial checks 也全部通過。此報告更新 [前一份 N2 verdict](REVIEW-N2-P6-GATE.md)，
保留舊報告與 reproducer，不修改其 assertions。

## 本輪實際重跑

| 執行 | 結果 |
|---|---|
| `n2-only-boundary-review.test.mjs` 原樣 matrix | **11/11 PASS**；包含 base64(percent)、double base64、hex(percent)、header-name credential |
| 新 `n2-success-final-review.test.mjs` | **11/11 PASS**；合法成功 TTS、composition、depth、headers、transport、restart/GET/resume |
| directly affected targeted tests | **21/21 PASS**；N2 gate、normal response、loopback persistence、receipt/idempotency/budget、zero retry |

共 **43 PASS／0 FAIL**。沒有重跑完整 Studio、offline、browser 或 frozen suite。
N1/N3、原 P0、P2–P5 integrity 與正常 browser review path 沿用既有獨立 evidence；Claude
回報的 paid-path/browser/offline/frozen 結果為補充資料，不列作本輪執行結果。

原 matrix SHA256 開工／結束一致：
`C9E5722A303992894E51DDA82A17DBCE469104D0BBC9915207CCEAB08F186AA8`。

## Actual production path

已沿 `paid-voice.mjs` 的實際路徑檢查，不只依賴測試回報：

- `recordingFetch` 在 fetch/body read 後先呼叫 `gateResponse`，只把 `gate.record` 寫入
  response artifact。原始 provider raw/header 不另存。
- Parser 接收 `gate.body`／`gate.headers`；ledger 的 providerRequestId 只由 gated exact
  request-id／x-request-id 取得。`gate.failed` 時 providerRequestId 為 null。
- Non-success 或沒有 TTS audio 的 response 保存 metadata-only：HTTP status、size、
  經 shape/detection 檢查的 provider status code。Provider message、echo、unknown free
  text 不交給 parser、manifest、ledger 或 UI。
- Headers 使用固定名稱表與 value shape；名稱及 value 一起做 credential detection。
  類似名稱、prefix/suffix trick、credential-bearing 名稱和值均不保存。
- Success TTS raw body 只有 detector 判 clean 才 verbatim 保存；contiguous credential、
  segmented 或 undecidable 時省略 raw/header 並停止。
- `credentialTrace` 受 depth、view 數與 work budget 限制；depth bound 還有 text-like
  encoding 時回 undecidable，不把未完成檢查視為 clean。
- Transport fetch/body-read exception 先轉成固定訊息與受限 code/name；provider free
  exception text 不進 client。`safeMessage` 對下游 persisted message 再檢查。
- Sanitization failure 經 out-of-band `unsafeResponse` 保留固定 error code，即使 client
  包裝 exception 也不變成 network retry。已有 attempted hash 不再取得 paid request。
  Replay 只讀 gated response，驗 hash；`raw:null` 不可 replay，且不重送。

## Independent success/depth/header evidence

每例使用 runtime-generated fake `sk_…` credential。Fake transport 回 **HTTP200、有效
本機 synthetic MP3、與 request text 對應的真實格式 character alignment、normalized_alignment**。
Credential 放在額外 provider diagnostic field；不使用缺 audio/錯 alignment 來取得拒絕。

測試矩陣：

- Literal、base64(percent(key))、double base64、JSON character-array segmentation：成功
  response 全 fail closed，不保存 secret-bearing raw/header。
- **5 層 base64** 與 **6 層 alternating base64/hex**（DECODE_DEPTH=4）：fail closed。
- **5 層 base64 且內層有非 printable binary padding**：亦 fail closed。使用獨立 Buffer
  decoding oracle 證明可還原假 credential，未以 production detector 自證。
- Allowlisted header value 含 literal/composed credential：整個該 header 被省略，clean
  success body byte-identical；providerRequestId null，不從其他欄位取回不安全 ID。
- Case-normalized 合法 request ID 保留；unexpected substring/prefix/suffix header、
  credential in header name、unexpected header value 均不保存。保存的 keys 精確符合預期表。
- Allowlisted header value 帶超過 depth 的 encoding：整份 response fail closed。
- Transport error 的 message/name/cause echo：不落盤，固定診斷，unknown outcome，舊 receipt
  resume 拒絕且無重送。

掃描整個 temporary workspace，含 response artifacts、SQLite、live WAL、ledger、
manifest、run/execution persisted state；restart 後再次掃描，另檢查 UI-readable view。
**沒有 literal 或本例可逆 representation 留存。** Normal clean success raw bytes 保持原樣。

Retry checks 使用 **exactly one confirmed miss**，其他 fixture segments 由本機 synthetic
pairs 免費 pin，避免把另外仍被授權且從未嘗試的 segments 混成 retry。每個 case：
dispatch → idle → restart → GET → 真實 resume method → GET，fake request count **維持1**。
Fail-closed response 為 `raw:null`、headers 空、固定 SECRET_SANITIZATION_FAILED；沒有
自動 retry、重送 failed hash、重新取得 secret 或從原始 provider text 恢復內容。

這是有限、與 production boundary 直接相關的測試；不是對任意自訂加密/covert channel
或所有可想像 encoding 的形式證明。

## 最終 gate 回答

| 問題 | 回答 |
|---|---|
| 1. N2 PASS/FAIL | **PASS** |
| 2. P0 數量 | **0**；沿用先前 evidence，本輪無新 P0 |
| 3. P1 數量 | **0**；N2 已清除，N1/N3 沿用已 PASS evidence |
| 4. A — Ready for isolated P6？ | **是** |
| 5. 允許下一步？ | **是**：由使用者在 Studio 選定 P6、保存 explicit decisions、free plan、該 revision 的 exact-envelope zero-paid preflight；PASS 後本人明確確認第一次真 synthesis |
| 6. Promotion OFF？ | **是，繼續 OFF**；不含 canonical promotion、freeze 或 git 發布 |
| 7. 人工 review 的 P2？ | R2B-08 倒捲漏報、viewport 留白、visual-policy calibration、每句一 block 節奏、真聲 seam/phrase、Outro 停留、Quiz 可讀性；stale resume UX 仍非 safety blocker。R2B-07 仍只阻止 promotion/publication |

P6-specific preflight 必須重建當次 exact endpoint/body/text、speaker/voice/model/settings、
whole-sentence parts、cache hits/misses、characters/budget 與 dependency hashes；本人確認
immutable envelope、零自動付費 retry 與估算非 billing 保證。任何 stale dependency 均須
重新 preflight/confirmation。Machine PASS 不替代 human visual review 與 seam listening。

本輪只新增本報告與 `n2-success-final-review.test.mjs`。既有 production code、兩份舊
review tests、`css/style.css`／`js/app.js` baseline hashes 不變；沒有 shared/frozen 寫入。
沒有讀 `.env`、用真 key、發真實 synthesis、開始 P6、render、promotion、freeze、
commit、push、tag 或 merge。停在 **A gate**。
