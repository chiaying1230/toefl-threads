# Milestone 2B — paid confirmation, isolated production candidate, human review

> 2B final review（REVIEW-2B.md）的 P0 / P1 已在 [MILESTONE-2B.1.md](MILESTONE-2B.1.md) 修正；下文是 2B 原始實作紀錄，trust root 與 artifact integrity 的現行做法以 2B.1 為準。

實作依據：`MILESTONE-2B-DESIGN.md`（本輪 contract）。範圍只在 `video-studio/`；沒有修改 `scripts/video/`（shared template / pipeline / ReadingCue）、frozen references、canonical rules、`css/style.css`、`js/app.js`。沒有付費、沒有 P6、沒有 freeze / commit / push / tag / merge。所有驗證用 fixture + 本機 mock provider。

## State machine

```
voice_planned ─(免費 preflight + envelope)─┬─ 全部命中 ───────────────┐
                                           └─ 明確確認 → voice_confirmed → voice_generating ─┤
voice_generated → assembled → camera_fitted → audited → rendered → mixed → verified
→ awaiting_human_review ─ 接受 → approved（不 freeze、不 promotion）
                        └ 需要修改 → changes_requested（終止；改決策 = 新 revision，語音依 hash 重用）
```

- Milestone 由「目前有效的 step chain」推導：每步的 input hash 必須等於前一步 sealed outputs 的 hash，outputs 每次讀取都重新驗 hash。任何不符 → 那一步 invalidated，之後全部不算數。
- 執行狀態另存（running / failed / blocked / interrupted / stale / superseded / approved / changes_requested），FAIL 不冒充下一個 milestone。
- `productionReady`（capabilityProfile 2B）只在 approved + 目前 bundle + 仍 fresh 時為 true；2A draft 的 `productionReady` 仍永遠 false。

## 模組

| 檔案 | 內容 |
|---|---|
| `coordinator.mjs` | `node:sqlite`（Node 24 內建，無新依賴）WAL + `synchronous=FULL`；OS lifetime lock = 持有 EXCLUSIVE transaction 的 SQLite 檔（process 結束即由 OS 釋放，不用 TTL / PID）；runs / steps / challenges / receipts / executions / attempts / mutations / reviews / publications |
| `candidate.mjs` | candidate workspace：pipeline closure byte-identical 快照（不 normalize LF/CRLF、不複製 .env / .git / frozen assets）、每步獨立 attempt root、sealed outputs（exclusive + read-only + hash）、Studio voice store |
| `voice-envelope.mjs` | 免費 envelope：`prepareNarration` → pinned cache（解碼 + alignment + meta 驗證後複製；驗不過 = quarantine = miss）→ `planNarration` → `buildRequest` dry run（URL allowlist、serialized body hash） |
| `paid-voice.mjs` | 一次性 challenge / receipt / execution、guarded `synthesize`、recording `fetchImpl`、validated cache writer、ledger、restart recovery |
| `production-steps.mjs` | assemble / camera / audit / render / mix / verify adapters（在 attempt root 跑原 CLI，argv 固定、`shell:false`、env 移除 `ELEVENLABS_API_KEY`）、付費前卡片高度 dry run、接縫試聽 clips |
| `geometry-worker.mjs` + `camera-solver.mjs` | 用 candidate 的原 renderer 逐幀量測；anchors / time-ref parity / bounded solver / 全幀 audit |
| `production-decisions.mjs` | 付費前必須確認的 production 決策（Outro、配樂、逐句翻譯、visual / timing policy） |
| `production.mjs` | orchestrator：freshness、preview / confirm / resume / recovery、chain、review、promotion、views / media |
| `promotion.mjs` | frozen denylist、collision、lock、journal、no-replace 安裝、commit marker、crash recovery |
| `public/production.js` | 2B UI 面板 |

## 1. Paid confirmation / receipt

- Preview（免費）：2A 必須 voice_planned 且 Quiz confirmed、production 決策齊全、compile report 沒有要靠決策解決的 unresolved、沒有 canonical / series collision、frozen inventory 可解析、time-ref parity（文字 token）通過、付費前卡片高度 / 橫向 overflow dry run（真 renderer + 合成 plan，標明不是 production evidence）通過。任何一項失敗 → run `blocked`，不發 challenge。
- UI 顯示：每個 request 的 segment / parts、speaker、model、settings、language、要唸的完整文字、characters；cache 命中 / miss / duplicate / silent；預計送出 characters（`utf16_request_text`）、最大單一 request、預算上限（= 顯示數字，不能提高）、重試政策（自動付費重試 0 次）；並明示「不是 ElevenLabs 實際扣額保證」。
- Receipt 綁定 draft / revision / source / decision hash、narration / compiled episode / validation / voice plan bytes hash、envelope hash、engine manifest hash、voice config hash、每個 request 的 body hash / URL / voice / model / settings / chars、pinned cache manifest、confirmed miss hashes、budget、retry policy、expiry；`receiptHash` 是內容的 canonical hash。
- 一次性：challenge 只能消耗一次；idempotency key 相同 → 同一 execution，key 相同但內容不同 → 409；同一 run 永遠只有一個進行中的 execution（第二個視窗 / 第二次預覽都回到同一個）。
- 任何依賴改變（決策、來源、2A artifacts、Studio 程式、pipeline closure、sealed inputs、mutation pending）→ run stale、receipt revoked；在 dispatch 前每次重查。
- 全部命中 → 不顯示付費按鈕、不建立 receipt，直接以驗證過的 pinned pairs 完成 voice_generated。

## 2. Request ledger / retry / recovery

- 唯一送出請求的地方是 guarded `synthesize`：重建 request 必須與 receipt 的 body hash / URL / chars 完全一致；預算（characters / requests / 單一 request 上限）在 transaction 內保留；**先寫 durable `dispatch_intent` 才送 HTTP**；收到 response 先存 raw response（含 request-id）再交給原 client parse。
- 零自動付費重試：guard 丟出的錯誤不是 `ElevenLabsError` / `AlignmentError` / `NO_ALIGNMENT`，現行 `withRetry` 不會重試；alignment 驗證失敗時 `withRetry` 的第二次呼叫只會 replay 同一份已存 response（不連網）。
- 結果：`succeeded`（MP3 + alignment 驗證、exclusive 封存）、`failed`（provider 已回應；是否扣額未知）、`unknown`（沒有可驗證的 response；可能已扣額）。`providerBilledCharacters` 一律 `null`。
- Resume（同一 receipt）只送「從未嘗試過」的段落；有 unknown 一律拒絕。剩下的段落需要新的 recovery 確認，UI 明示「先前請求可能已扣額、重送可能再次扣額」，必須勾選才可確認。
- Restart：`dispatch_intent` 沒有 durable response → `unknown`；running execution → `interrupted`；不自動重送。

## 3. Voice generation adapter

`generateNarration` / `planNarration` / `synthesizeWithTimestamps` / `buildRequest` / `prepareNarration` 原樣使用；Studio 只注入 guarded synthesize、recording fetch 與 cache。Arthur / Ling 來自 candidate 內的 `voices.json` roles；中斷句仍是一次 TTS + parts（測試確認 part 不會個別送出）。驗證過的 pair 另外發佈到 Studio voice store（content-addressed、不覆寫；不同 bytes = collision 停止），讓新 revision 的相同 segment 免費命中。repo 的 `voice-cache/` 與 alignment 只讀。

## 4. Candidate workspace

每個 run 一個 candidate（UUID）：`engine/`（closure 快照 + manifest hash）、`inputs/`（決策、2A artifacts 的 bytes 副本、preflight、envelope）、`voice/`（pinned / sealed / responses / staging）、`sealed/<step>/<attempt>/`、`attempts/<step>/<attempt>/root/`。每步標準 result（schemaVersion、runId、candidateId、revision、step、attemptId、inputManifestHash、engineManifestHash、fencingToken、outputs[bytesHash,size]、errors、warnings、exitCode、productionReady=false）同時寫入 DB 與 sealed `completion-<step>.json`。

## 5. Assemble / alignment

attempt root 內放 narration、compiled episode、驗證過的 MP3 + alignment，跑原 `assemble.mjs <id>`；再以 `validateEpisode(linesFromPlan)` 檢查 refs、以原 `writeManifest` 產生 manifest。保存 plan / WAV / assembly.json / manifest 的 hash、每條 line 時間、part → whole-take 對應、cut 時間與 quiet ratio、assembly warnings（接縫 warning 不是 FAIL，但人工必須確認）。

## 6. Camera / visibility

- Anchors（決定性）：Hook（t=0, offset 0）、每條 story reading line、每個詞卡 open、Quiz question；距離小於一次 scroll 的 anchors 合併。
- Time-ref parity：renderer（`PostTemplate.time`）、fit-camera、verify-episode 三種 normalization 必須落在同一個字；不一致或找不到 → `TIME_REF_PARITY_BLOCKED`（付費前用文字 token 檢查一次，真 alignment 後再用 renderer 檢查一次）。Compiler 的 `open.word` / `reveal.word` 改為 renderer 會比對的 key（舊 2A 對 `:` `;` `!` `?` 結尾的切點會產生 renderer 找不到的 ref）。
- Solver：在 candidate 原 renderer 逐幀量測真實幾何（thread 座標，與 camera 無關）；對每個 anchor 的 settled window 求 offset 可行區間（active cue、整個黃色詞組、完整詞卡、詞義、thinking 期間的 Quiz 題目 / 選項、答案說明），加上 no-reversal 與 translate ≥ 0；用固定 cost（閱讀行放在 policy 位置、詞卡保持不動、Quiz 用 policy offset）在區間內取整數；區間為空 → `CAMERA_UNSATISFIABLE`，需要倒捲 → `CAMERA_REVERSAL_REQUIRED`，都是 BLOCK 並附上衝突的兩個內容。
- 真 renderer 全幀 audit 驗證；失敗時只調整有限參數（anchor 提前量 −scroll / −½scroll / 0、該 anchor 的安全邊 +12px），最多 6 次，仍失敗 → `CAMERA_AUDIT_UNRESOLVED` BLOCK。
- Visibility（policy v1）：第一段在第一個 camera 移動時出現（之前 0.2 預覽）；下一段在前一段最後一句開始時（減 scrollDuration）出現；Quiz 不早於最後一句旁白結束。輸出仍是現行 episode schema（semantic refs + delay），沒有第二份 camera format。
- Outro：`cueDuration = duration − scrollDuration − 0.45`（決策表單計算並檢查 > 0.2），並在 audit 驗證吉祥物實際可見到結尾。沒有用固定 1.5、沒有改 shared default。

## 7. Audit / render / mix / verify

- Audit：原 `render-episode --audit-only`（全 30fps）＋ extended audit（每一個輸出幀；frameCount = 預期幀數、coverage hash、40 個隨機幀 renderer parity）。Hard：shared audit issue、Hook 在旁白中被捲走、active cue / 黃色詞組 / 完整詞卡 / 詞義 / Quiz 不在可見範圍、旁白結束前 Quiz 選項可見、吉祥物提前消失、camera 反轉。Soft（需人工確認）：單幀移動過快、朗讀時下方留白過久、詞卡教學期間正文詞組不在畫面。
- Render：強制 `--narration-only`；幀數 / 長度必須等於 audit；MP4 完整解碼。
- Mix：只混一次；原 `audio-mix` 六項檢查（4 + 配樂 + 每個音效）全部 PASS、exit 0；不混音時明確記錄 final = narration-only（不偽造六項 PASS）。
- Verify：原 `verify-episode`（narration-only）；required check set 依 episode features 版本化，缺一項、任一 FAIL、exit ≠ 0 或空報告都 FAIL；final MP4 必須完整解碼、幀數相同、與 narration-only 是同一條 h264 stream。
- 每步同時只有一個 renderer（OS lifetime lock）；固定 port 被其他程式占用 → BLOCK（不殺其他 process）。重啟後 running step → interrupted（若記錄的子程序仍活著 → blocked），不推定成功；續跑是新的 attempt。

## 8. Human review

Machine PASS 才產生 review session（綁 bundle hash）：final MP4（Range streaming，只服務目前有效 bundle 的檔案）、verify review sheet、每個接縫的三段試聽（整句原始 take、進入教學前、回到故事）與跳到影片位置、5 項視覺檢查、所有 warnings（每項必須勾選）、機器驗證結果。接受需要每個接縫 / 視覺項目 / warning 都明確勾選；bundle 不是目前的 → 409；同 idempotency key 不重複。需要修改必須寫下問題，run 終止。任何上游決策修改 → approval 失效。接受不 freeze、不 promotion。

## 9. Promotion

`promotion.mjs` 依 design：frozen denylist（全部 `FROZEN.json` 的所有 hash group 與 revisions、frozen 資料夾、大小寫 / alias、shared code 永久拒絕、reparse point 拒絕；FROZEN.json 無法解析 → fail closed）、目的地已存在 → BLOCK（只有 hash 相同的非 frozen alignment 可列為 reuse 引用）、publication lifetime lock、DB journal（PREPARED → STAGED → INSTALLING → READY_TO_PUBLISH → COMMITTED）、no-replace hard link 安裝、commit marker 最後安裝作為 linearization point、crash recovery（無 marker → 只刪除本 transaction 建立且 file id + hash 相符的檔案；marker 完整 → roll forward；marker 存在但檔案不符 → BROKEN、gate 關閉、人工處理）。**明確不宣稱原子**：commit 前外部工具仍可能看到部分檔案。Studio 的製作在 journal 未結束時被 publication gate 阻擋。

本輪**未開通**：Studio 預設 `promotion.enabled=false`，UI 只顯示說明；需要 owner 另行授權並以 `--enable-promotion` 啟動。測試只對暫存的假 repo 執行。

## 10. Policy 與限制（誠實記錄）

- 無中文 Hook 仍 BLOCK；沒有 `" "` workaround、沒有 shared revision、沒有改 Outro shared default。
- Visual policy v1 的數值（閱讀行 y=110、Quiz offset 35、留白門檻、最大速度）是 Studio **proposed** policy，必須在第一支真實影片的人工驗收時校準；不是 canonical 規則。
- 2A compiler 每一句是一個 story block（P2–P5 是每段一個 block）；畫面可接受但與 frozen references 不同，P6 驗收時要看。
- Story 逐句翻譯是人工輸入（或明確選擇不顯示，驗收時需確認）；沒有自動切 `post.zh`。
- 真 ElevenLabs 路徑沒有被執行（依指示）。程式與 mock 走同一條 code path，但第一次真實付費就是 P6 驗證本身；provider 是否對失敗請求計費、是否支援 idempotency 都沒有權威資料，因此一律 fail closed。
- SQLite FULL + OS lock 經 process kill 測試；硬體斷電沒有做 fault injection。
- 手機 LAN 存取、AI 候選、跨機器 deployment 不在本輪。

## 測試

- Studio：`node --test --test-isolation=none video-studio/*.test.mjs` → 80/80（2A 原 39 + 2B 41）。
- 既有 offline：audio-mix + voice 92/92。
- Browser：`node video-studio/browser-smoke.mjs`（2A）與 `node video-studio/browser-smoke-2b.mjs`（2B，fixture + mock provider + 真 render）。
- P2 / P3 / P4 / P5 `check-freeze` intact；`ReadingCue.js` hash 不變。
