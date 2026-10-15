# Milestone 2B.1 — safety fixes for REVIEW-2B.md (P0 / P1 only)

範圍：`REVIEW-2B.md` 的 R2B-01、02（P0）與 R2B-03、04、05、06、09（P1）。沒有重新設計 2B；P2（R2B-07、R2B-08、whitespace 量測、visual policy 校準、每句一 block 的節奏）只保留紀錄。所有修改都在 `video-studio/`；沒有改 shared template、`ReadingCue.js`、frozen P2–P5、canonical rules、`css/style.css`、`js/app.js`。沒有真實 ElevenLabs request、P6、production render、promotion、freeze、commit、push、tag、merge。Promotion 仍預設關閉。

## P0-1（R2B-01）execution closure 的 trust root

- **Trust root 在 snapshot 外部**：建立 run 時，從 live repo 計算的 closure 完整記錄（每個檔案的 path / bytesHash / size，與 root hash）寫進 coordinator DB 的 run row（`inputs.bindings.engine` + `engineManifestHash`）。Candidate 內的 `inputs/engine-manifest.json` 只是一份 evidence 副本，**不再被讀來當依據**。
- `Candidate.engine()` 只回傳這份可信記錄；`assertTrustedEngine` 檢查記錄本身一致（root = files 的 canonical hash、檔案集合 = allowlist）。
- `Candidate.verifyEngine()` 每次都從 candidate `engine/` 的**實際 bytes** 重算：檔案集合必須完全相同（多一個、少一個都 BLOCK），每個 bytes hash / size 必須等於可信記錄。不會「重新產生 manifest」來取得合法狀態。
- 驗證時機：GET / restore / reconcile（`staleness`）、paid confirmation、**每一次 paid dispatch 前**（guard 的 freshness）、每個本機步驟前（chain 開始時 `assertFresh`），以及 `attemptRoot` 實際複製每個可執行檔案之前；`voices.json` 透過 `engineFile()` 驗 hash 後才解析。
- 可信記錄另外與 live repo 比對（pipeline engine drift），Studio 自己的程式碼仍由 loaded engine hash 管。
- 舊 run 沒有可信記錄 → fail closed（stale）。

## P0-2（R2B-02）transitive artifact integrity

- `Candidate.verifyDeep(ref)`：驗證 artifact 本身，若是 JSON，遞迴驗證它引用的每一個 candidate artifact（`{ path, bytesHash, size }`，只跟隨 `inputs/ voice/ sealed/ attempts/` 下的路徑），並回傳整個子圖的 digest。因為父 JSON 內嵌子 artifact 的 bytes hash，這是一棵 Merkle 樹：任何 nested 改變都會改變包含它的每一層的身分。
- Step chain 用 `verifyDeep` 驗每個 step 的 outputs（voice bundle → 每個 MP3 / alignment；review bundle → 所有 artifact）；失敗 → 該 step invalidated，下游全部不算。
- `staleness` 另外 transitive 驗證：所有 sealed inputs、**每一份 envelope（含 pinned pairs）**、preflight，以及已成功的 voice bundle。語音 evidence 無法在本機重做，因此改變 → run `stale`（`VOICE_EVIDENCE_CHANGED`），新預覽會從仍完好的 voice store 免費命中，或明確重新確認。
- Bundle manifest 增加每一步的 evidence（attemptId、inputHash、outputs、transitive graph digest、warning codes）。

## P1

| Finding | 修法 |
|---|---|
| R2B-03 pinned drift during execution | 每次 dispatch 前（`freshness()` 之後、reserve 之前）重新驗 receipt 綁定 envelope 的每一個 pinned pair；且 `staleness` 的 envelope transitive 驗證也會發現。改變 → `PINNED_CACHE_CHANGED` / stale，不送下一個 request，不會把 hit 變成付費 miss。 |
| R2B-04 receipt checksum | `verifyReceipt`：重算 content 的 canonical hash = content.receiptHash = DB `receipt_hash`；receiptId / executionId / runId / envelope / challenge 綁定一致；revision / source / decisions / narration / episode / validation / voice plan / engine hashes 與 run row 一致；envelope 屬於這個 run；status 允許。用在 confirmation replay（三個 replay 路徑）、claim、**每一次 reserve transaction**、resume、restart restore。 |
| R2B-05 expiry | 同一個 `verifyReceipt` 在每次 reserve transaction 內檢查 expiry（content 與 DB 欄位一致且未過期）；發 receipt 與檢查用同一個 clock（`Date.now`）。過期 → execution `expired`、receipt `expired`。 |
| R2B-06 re-audit / old accepted bundle | review step 的輸入改為**整個 current bundle manifest 的 hash**（所有 artifact + 每步 evidence），不是三個媒體 hash。任何 included evidence 改變 → 新 review step、新 bundle、新的 open session。`syncApproval`：accepted review 的 bundle 不是 current → 立即 stale；approved run 失去 current approval → `failed`（`APPROVAL_INVALIDATED`），`productionReady=false`。終止中的 run 也從已驗證的 chain 重算 milestone，不會顯示舊的 `approved`。 |
| R2B-09 issued receipt restart | 確定性狀態：restart 時每個 `issued / interrupted / failed` execution 都重新驗 receipt；有效 → 保持（`issued` 可用「開始已確認的語音產生」以**同一張 receipt** 執行一次，重複點擊回到同一個 job）；tampered → `blocked`；expired → `expired`。已執行 → replay 回同一 execution；unknown → BLOCK；需要新確認時 UI 明確提供，且只有在先前請求真的可能送達 provider 時才要求「可能已扣額」確認。 |

## 測試

- `review-2b-adversarial.test.mjs`：P0/P1 的 9 項全部 PASS。兩項 P2（R2B-07 promotion marker、R2B-08 stationary→倒捲）**重新分類為 `todo`，assertion 未改**。另外兩處依修正調整了測試機制、沒有放寬安全斷言：
  - 第一項原本用 `c.engine()` 讀 snapshot manifest；現在 `engine()` 回傳可信記錄，所以改成直接改 snapshot 的 manifest 檔案。
  - 第一項原本斷言「被改過的副本仍可 materialize」（這是 bug 的證據）；修正後改為斷言 `attemptRoot` 拒絕。Provider requests = 0 的斷言不變。
- 新增 `safety-2b1.test.mjs`（8 項）：完全自洽地改副本 + 改 snapshot manifest（含 root hash）仍 BLOCK 且 restart 後仍 BLOCK；多一個檔案 / 改 voices.json 副本 BLOCK；改副本後本機步驟一個都不執行；nested MP3 改變後 restart → approval / readiness / media / promotion 全失效；evidence 改變 → 新 bundle、新 open review、舊 bundle 409；過期 / 竄改 receipt 在 restore / resume / replay 都拒絕且 0 requests，過期後以新確認完成；issued restart 以同一張 receipt 執行一次（雙擊仍 4 requests、1 execution）；pinned 中途改變只送 1 個 request。
- 既有 2B 測試兩項因竄改模擬現在更早被擋而調整：budget 測試改用一致重算 checksum 的 receipt（測 checksum 之後的獨立 budget 層），並新增「只改內容 → `RECEIPT_TAMPERED`、0 requests、execution blocked」；pinned 竄改測試改為在 confirmation 就被拒絕。
- 結果：Studio 99 tests：97 pass、0 fail、2 todo（上述 P2）；2A.1 review-safety + freshness 15/15；offline audio-mix + voice 92/92；`browser-smoke.mjs` 與 `browser-smoke-2b.mjs` PASS；P2/P3/P4/P5 check-freeze 全部 exit 0；`ReadingCue.js` hash 不變；`css/style.css`、`js/app.js` hash 與開工時相同。

## 未處理（P2，保留紀錄）

- R2B-07：promotion recovery 信任 marker 自述清單（post-P6 publication blocker；promotion 維持關閉）。
- R2B-08：audit 的 no-reversal 只看相鄰 delta 翻轉（人工視覺 gate 仍必要）。
- Lower whitespace 量測用所有可見內容的最大 bottom，未 clip 到 viewport。
- Visual policy 數值、每句一 block 的節奏：P6 校準。
- Review 中其他 P2 hardening（sameVideoStream 檢查 ffmpeg exit、mix check 名稱、MP4 URL 帶 bundle token、PID 身分、environment fingerprint 作為 prerequisite）。
- SQLite trigger 禁止更新 receipt content 沒有加入：本輪以「每次使用都重驗 checksum」fail closed；trigger 對本機可改 DB 的人沒有額外保護，且會讓竄改模擬測試無法進行。
