# P6 Readiness Re-review — Milestone 2B.1

日期：2026-10-12。Verdict：**B — P6 前仍需少量修正**。

原 REVIEW-2B 的 P0/P1 reproductions 已通過，外部 engine trust root 與完整 voice
bundle 的 transitive integrity 修法成立。但補測仍找到三個 P1，不能批准現在開始付費。
修正範圍仍限定 Studio，不需重寫 renderer／shared pipeline。

本輪只 review + zero-paid preflight；production code 未修改。P6 尚未選定 draft
（owner 本輪已確認），未建立 P6。Promotion 維持 OFF；所有 fault injection 都在
temporary workspace／mock provider，publication regression 只用 fake repo。

## 1. 原 P0 / P1 修復驗證

| 原 finding | 結果 | 本輪證據 |
|---|---|---|
| R2B-01 copied execution integrity | 已修 | trusted file list/root 存 coordinator run row；candidate copy、snapshot manifest 與重算 self hash 不能覆寫；增／刪檔、改 voices、restart、receipt commit 後首次 dispatch 前修改皆 BLOCK，0 provider requests |
| R2B-02 completed nested artifacts | 已修；另有下述 partial window | 完整 voice bundle 的 MP3/alignment、assembly manifest、review session/bundle 更改後 approval/readiness 失效；restart 不恢復 accepted；但 voice bundle 尚未建立時的已生成 pairs 漏驗 ledger hashes |
| R2B-03 pinned cache drift | 已修 | envelope/pinned refs 每次 freshness＋reserve 前重新驗；第一個 request 改 pinned hit，沒有下一個 request |
| R2B-04 receipt checksum | 已修 | verifyReceipt 重算 content / DB checksum，identity/run/artifact/envelope bindings；replay、claim、reserve、restore/resume 都驗 |
| R2B-05 expiry | 已修 | reserve transaction 再驗 expiry；中途到期只保留已在途 request，剩餘不送；expired recovery 需新確認 |
| R2B-06 re-audit / old acceptance | 已修 | review input 綁 current bundle 全部 artifact/evidence/attempt/graph；更换 included evidence 開新 session／bundle，舊 acceptance 不回來 |
| R2B-09 issued restart | 已修 | 已 commit、未 claim 的 issued execution 可用同 receipt 明確起跑；double click 不多建 execution，不多送 request |

### Trust root 確實不由 candidate-controlled data 決定

`production.mjs:202` 的 engine binding 由 Candidate.create 對 live repo 計算後寫入 DB。
Candidate.engine() 只取得這份 DB expected record；assertTrustedEngine 驗 allowlist
及 root consistency，verifyEngine 重算 copied bytes 和 exact file set。
Snapshot engine-manifest 本身又有 sealed input ref。新 preview／recovery 的 server
code 不接受 client 的 engine/file/hash 欄位覆寫此 binding；recovery 只追加 envelope。
沒有發現 candidate manifest → coordinator trusted binding 的回寫路徑。

獨立測試刪 engine file／改 copied code，同時重算 snapshot manifest hash，restart
後 DB binding hash 不變、付費拒絕且 0 requests。另一測試先 commit receipt、再改
copied ElevenLabs client、再 resume，同樣 0 requests。原 safety-2b1 已覆蓋 extra
file、voices.json、完整自洽 manifest 替換，以及 downstream local step 不執行。
這是在可信本機 DB／checkout 模型下的完整性保證，不是抵抗任意有權修改 DB 的人。

### verifyDeep 的範圍與修復效果

它驗 ref 本身，再遞迴跟隨 candidate-owned `{path,bytesHash,size}` refs（inputs/
voice/sealed/attempts）；父 JSON hash 保護 ref 清單本身。Chain output、封存 input、
每份 envelope、preflight、成功 voice bundle 都使用它。Review bundle 增加全部 step
outputs／graphs／attempt IDs，因此單純重做 report 也不能借回舊 review。

Completed bundle 的 child asset 改動已 fail closed，沒有再重現原 productionReady
過早 true 或 copied code bypass。新缺口是尚未形成這個 graph 的 partial generation，
不是把原 completed-bundle test 改得比較寬鬆；見 N1。

## 2. 仍需修正的三個 P1

### N1 — partial generation 的已成功 pair 未以 ledger byte hashes 保護

位置：`paid-voice.mjs:147–158,182,249–258`；`production.mjs:94–96,268–281`。

sealed ready() 仍只看 MP3＋alignment 存在。成功 request 的 audio_hash / alignment_hash
雖存於 coordinator attempts，但 resume 的 freshness 不驗它們；staleness 只在有
成功 voice step／voiceBundle 時驗 transitive voice evidence。

獨立反例（audio 與 alignment 各一項）：

1. Mock 第1個 request 成功，第2個 HTTP500，因此有一個 sealed pair，但沒有 voiceBundle。
2. 改這個 partial-success audio bytes 或 alignment JSON bytes；未改 DB/receipt/body。
3. Restart，再按同 receipt resume。
4. **仍送出2個剩餘 mock requests**；預期應為0，先 BLOCK changed pair。

已有失敗段落沒有被重送、budget 沒有超額、沒有證明 duplicate charge；也沒有在
這個反例中得到 approved（該 HTTP500 段仍未完成）。因此列 P1 paid dependency
freshness，與原任意執行副本／completed approval P0 區分。
但不能聲稱每個 generation lifecycle 都已具備 immutable audio evidence。

最小修正：以 DB succeeded attempts 的 audio/alignment hashes 驗 candidate partial
pairs，於 restore/GET/resume、每次 dispatch、cache.has/voiceResult 及 recovery pin
source boundary 使用同一個驗證。Mismatch／missing 不可當 hit、不可 silently 改成
付費 miss、不可更新 expected hashes 來「修好」；保存 stale reason、停止剩餘請求。
既有 validated voice store 可作另一次明確免費恢復來源，但需正常新 envelope/evidence。

### N2 — recording transport 把 provider 回顯的 credential 原文落盤

位置：`paid-voice.mjs:215–227`。

原 client 會 redact HTTP error 裡的 key，ledger/UI error 已經 scrubbed；但 recordingFetch
先保存未 scrub 的 response headers/raw，才把它交原 client parse。
以 dummy credential 的 mock HTTP500 error echo 重現：UI/ledger 沒有 dummy key，
`voice/responses/<attempt>.json` **含有 dummy key 原文**。

沒有讀取、輸出、傳送或洩漏真實 API key。本 finding 是無法保證 artifacts 不保存
credential；不是宣稱真 ElevenLabs 一定回顯 key。也是原 client 的 error redaction
在新增 persistence 層被繞過。Responses 不在 browser media allowlist，故未發現
browser 可直接下載此 raw artifact；仍違反本輪 explicit secret contract。

最小修正：在 response persistence／logs／headers boundary scrub known credential，
保留可 replay 的安全 payload、status、provider IDs 與 hash evidence。不能以 UI error
已 redact 當作落盤安全；測試 successful response parser/alignment 不被 sanitization
破壞。Key 不進 receipt／ledger／candidate env，此既有分層維持。

### N3 — stale narration 的 GET restore 拋錯，無完整 machine-readable readiness

位置：`production.mjs:131,138,396,542`。

Approved 後改 sealed narration、restart、GET view：reconcile 已把 run/review 作廢，
但 view 仍對 terminal run 呼叫 chain；review stepInputs → bundleManifest 再讀被改的
narration，拋 `Sealed artifact changed: inputs/narration.json`。沒有回傳預期的
stale state／productionReady:false。這不是付費或 approval bypass：resume/accept/media
仍 fail closed。問題是恢復狀態輸出不完整，UI 可保留舊畫面而只顯示 fetch error。

最小修正：terminal/integrity-failed input 路徑安全推導最後有效 milestone，chain input
resolution failure 納入 structured invalidation；GET 必須給 authoritative false
readiness、stale reasons／current refs，而非碰觸壞資料時整個 view 拋錯。

其餘新增的 manifest/session/bundle restart cases均通過；session/bundle損壞時 final
仍可作 verified media觀看是合理行為，不要求無關 bytes 被刪掉或重新 render。

## 3. Zero-paid preflight — 已執行

腳本：`zero-paid-preflight.test.mjs`（review/preflight only），**5/5 PASS**。
真實 provider request = 0；真實 synthesis request = 0；沒有用真實 key。
P6 尚未選定，因此這是共用 execution contract preflight，**不是某篇 P6 的 final
envelope／成本核准**。未將 fixture 命名成 P6，也未把測試決策寫入正式 episode。

### Exact request reconstruction

用 current Studio envelope、prepareNarration、buildRequest，對 single／phrase／multiple
temporary fixtures逐段重建，比對 exact serialized body hash、text、voiceId、model、
settings、previous/next context、output format、UTF16 characters／planner total。
Endpoint contract 是 POST `/v1/text-to-speech/{voiceId}/with-timestamps`，
`output_format=mp3_44100_128`；production allowlist 保留 https://api.elevenlabs.io。
Arthur/Ling取 voices.json roles；整句 parts 只有一個 unique request；silent/duplicates
不多買一次。Method/headers也在下面的原生 HTTP transport測試驗證。

目前設定：Arthur `C1npRmjB19a6yNkEucvx`、Ling `Z8Aisvg1z70p27kGvkZZ`，
model `eleven_v4`，settings `{stability:0, similarity_boost:0}`，與 current config相同。
這些是 public voice identifiers/settings，不是 credentials；未查 remote account。

### Real response parser / alignment / parts

唯讀使用 P2／P3／P4／P5 narration、repo voice-cache MP3 與真實 alignment：

| Reference | Spoken records | Interrupted sentences |
|---|---:|---:|
| P2 / p2 | 10 | 1 |
| P3 / p348 | 14 | 2 |
| P4 / toeic-079 | 10 | 1 |
| P5 / ielts-068 | 12 | 1 |
| 合計 | **46** | **5** |

用真實 audio bytes／provider character arrays重建 response wrapper，交原
synthesizeWithTimestamps parser；驗 audio byte equality、decoded duration、timestamps、
source text、voice/model/settings/prosody／segment key與validatePair。再用原
assembleNarration在memory組合全部四份，frame count與line IDs對照 frozen plans，
每個 interrupted part出現一次。没有寫 WAV／plan或render frozen影片。

另外拒絕 bad JSON、missing/empty audio、missing alignment、truncated timestamp
arrays與negative timestamps。沒有猜字級 timing／normalized text fallback。
這個 wrapper重建不等於保存了歷史完整 HTTP response/headers；只聲稱 parser 能接受
真實保存的 audio/alignment內容，沒有用 mock tone聲音替代這項證據。

### Native loopback transport

原 production client 支援顯式 apiBase/fetchImpl，無需改 production code：

- 直接client把apiBase指本測試127.0.0.1 ephemeralport；restricted fetch拒其他origin。
- Guarded Studio adapter保留原ElevenLabs URL／receiptbodyhash，只在**test-injected
  fetchImpl**映射到loopback，同樣payload/headers交原生Nodefetch。
- 驗POST/bodyserialization、Content-Type/Accept、dummy xi-api-key；成功body採真實錄音
  parsercase，guardedpersistencecase採本機mockaudio。
- 驗HTTP500、connection/body truncation、timeout、malformedresponse；guarded truncation
  記unknown，只一個request、舊receiptresume拒絕，不networkretry。
- Guarded成功4個requests各有durableresponseref、providerrequestID、hashverify與sealedpair。

沒有改 production allowlist、沒有把localhost設定寫入 voices.json。
localhost 測試證明 Node transport／persistence／parser contract，不能證明遠端 TLS、
account entitlement、當下 provider behavior 或扣費語意。

### Environment / secret boundary

Candidate root不含.env/.git。用dummy parent ELEVENLABS_API_KEY啟動原runNode，child
回報hasKey=false，stdout不含dummy。Production keygetter只在guardedpaid位置讀repo
.env，不把值塞process.env；receipt/envelope無key，browser只能取安全view/media。
這些通過。**整體「artifacts不保存key」未通過N2**，不能以這五個positive preflight
tests PASS抹去獨立error-echo反例。

### 已排除／只能第一次 P6 驗證

已排除：compiler→requestserialization drift、fixture roles/settings mismatch、parts
被當獨立TTS、真實保存alignment不相容、基本timestamp／MP3／assembly錯誤、原生HTTP
failures被當success、guardedtruncation自動重送、child取得dummykey。

仍需第一次真request或另行只讀metadata確認：當下accountkey/quota、model/voice權限、
settings/server接受、當前with-timestampsresponse/normalizedtextbehavior、remoteTLS/
rate limits、實際credits與失敗request是否扣費、realnarrationdurations與phoneticseam。
真声自然度、camera無解與節奏需實片人工驗收；不能在offlinepreflight宣稱完成。
Requestchars cap仍只限制client提交的UTF16text量，不是貨幣／provider billing保證。

## 4. P2 分類：不升級成首次付費 blocker

| 項目 | 第一次付費 | 自動產MP4 | 人工calibration／後續限制 |
|---|---|---|---|
| Promotion marker list R2B-07 | 不阻止 | 不阻止isolatedcandidate | **只阻止promotion/publication**；維持OFF |
| No-reversal audit R2B-08 | 不阻止 | 可產，但不能把machinePASS當完整視覺認可 | stationary→backward可能漏報；本人必看camera，明顯倒捲選Needs changes |
| Whitespace measurement | 不阻止 | 可產 | 遠處contentbottom可能掩蓋viewport空白；本人逐段看streaming，不相信softwarning完備 |
| Proposed visualpolicy數值 | 不阻止 | 可產；solver無解仍BLOCK | reading/Quiz位置、速度、lookahead/留白門檻用P6校準，不先freeze數值 |
| 每句一block節奏 | 不阻止 | 不阻止 | 保留TTS/parts/handoff；看feed碎裂感、camera密度、teachingreturn與中英spacing |

R2B-08 不會新增paidrights、改receiptbudget、污染canonical，且機器PASS不自動approved；
有exactbundle humanreview gate。因此本次不升P0/P1，允許修好真正blockers後用P6
產片校準。若P6遇到需手改JSON的cut/timing／camera問題，仍是automationgap，應修
Studio另案處理，不手工把單支P6修成片。

## 5. Tests / unchanged scope

| 執行 | 本輪結果 |
|---|---|
| Existing Studio full suite（新增本輪test前收集） | **99 tests：97 PASS、0 FAIL、2 TODO**（只有R2B-07/08延期assertions） |
| review-2b-adversarial | 9個active全部PASS；2個P2 TODO仍保留原失敗assertions，不能稱11/11正常PASS |
| safety-2b1 | **8/8 PASS**（含於fullsuite） |
| 2A.1 review-safety另外重跑 | **5/5 PASS** |
| 原2B／2A／offline | 原Studiocases含於99；offline **92/92 PASS** |
| browser-smoke / browser-smoke-2b | **兩者PASS**；temporaryfixtures、mockprovider、無外部requests |
| zero-paid-preflight.test.mjs | **5/5 PASS**，不代表N2secretnegativecase通過 |
| readiness-review.test.mjs | **9 tests：5PASS／4FAIL**；partial audio/alignment各一FAIL、rawcredentialpersistence一FAIL、stalenarrationview一FAIL |
| P2/P3/P4/P5 frozen integrity | 全部exit0／intact，ReadingCue/sharedclosure未改 |

原有productioncode／tests／scripts/video/data以開工SHA256 inventory比對，**全部不變**。
css/style.css與js/app.js兩份既存修改hash未變、未stage/revert；gitindex空。
新增僅 `readiness-review.test.mjs`、`zero-paid-preflight.test.mjs`、本reviewreport。
Browser QA可更新ignoredstate/qa，沒有canonical輸出。新reviewassertions為正常FAIL、
未TODO；將來globfullsuite會包含它們，不能忽略它們宣稱所有readinesschecks已PASS。

## 6. 最终十二個答案

1. **P0是否為0？原兩項P0的已完成execution／bundle bypass已清除，未再發現同級
   arbitrarycopiedexecution／completedapprovalbypass。** Partial-generation lifecycle
   freshness仍有N1，列P1；不能把這句當所有integritycases已通過。
2. **P1是否為0？不是。** N1partialpairledgerhash、N2responsecredentialpersistence、
   N3stalenarrationview是本輪最小blockers；原R2B-03/04/05/06/09activeassertions已PASS。
3. **第一次真ElevenLabsrequest安全？目前不批准。** 修上述blockers並重跑negative
   cases，再選定P6draft做exactfreepreview；本輪完全沒有真providerrequests。
4. **自動到MP4安全？正常fixturechain已通，但目前不批准P6付費chain。** 修復後允許
   solver／alignment無解安全停下；不是保證任意source一次可成片。
5. **進humanapproval安全？完整currentbundle gate已修復／測通。** 第一支P6仍先等
   blockers清除；機器PASS不代表本人已看過／聽過，所有seam/visual/warnings明確確認。
6. **Promotion仍應關閉？是。** R2B-07與publicationhardening另案，不阻止隔離驗片。
7. **R2B-08阻止P6？否。** 它是visualauditcoverage問題，修好P1後可產片但必須humanreview。
8. **Visualpolicy只屬P6calibration？数值是。** Reversal／whitespacemeasurementcoverage
   是後續codehardening，不只是調數值；本輪不擴scope、不改productioncode。
9. **每句一block仍非blocker？是。** 視覺節奏需本人看第一次實片。
10. **真request前UI必須確認：** 所選sourcehash／draftrevision、series/episode/level、
    vocab、Hook（目前須中文）、完整Quizsnapshot、Outro/audio/translation與timingpolicy；
    exactspokenrequesttexts/whole-sentenceparts、Arthur/LingvoiceIDs/model/settings、
    verifiedhits/misses/duplicates/silent、UTF16chars及maxrequests/maxbudget、零auto-paid
    retry、估算≠實扣、付費後仍可能BLOCK。Recovery另明確確認可能已扣額／再次扣額；
    確認必綁當前immutableenvelope，沒有「沿用過期同意」。
11. **只有第一次P6能驗證的風險：** realprovider接受／新response形態、真timeline／
    phoneticseams與畫面節奏；billing不確定性不能因一次成功便宣稱已全面解決。
12. **需要shared-template revision？本輪最小修正不需要。** 都在Studioadapter/workflow。
    無中文Hook仍BLOCK；要改這個contract另提revision，不填空白、不碰ReadingCue。

下一輪只修N1/N2/N3並讓本輪4個negativeassertions正常PASS，再作readiness確認。
本輪到此停止，沒有開始P6。
