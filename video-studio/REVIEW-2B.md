# Milestone 2B final architecture / safety review

日期：2026-10-12。Verdict：**C — 不應開始 P6**。

既有 80 個 Studio tests 全過，架構方向也符合 wrapper / isolated candidate 原則，
但獨立反例發現 execution closure 與 transitive artifact integrity 的 P0 缺口。
目前不能核准第一次真實付費確認或宣稱 exact bundle approval 安全。
這個 verdict 不是因為 proposed visual policy 尚未 frozen。

本輪只 review；新增本文件與 `review-2b-adversarial.test.mjs`。
沒有修改 production code、shared template、ReadingCue、canonical/frozen assets 或
production rules。Regression 的媒體只有 temporary fixtures + mock provider；
沒有真實 ElevenLabs request、P6、新 production episode render、canonical promotion、
freeze、commit、push、tag 或 merge。Promotion tests 只寫暫存假 repo。

## 1. Findings

P0 = 不能開始 P6；P1 = P6 前應修；P2 = P6 calibration 或 P6 後處理。
Severity 依本次完整性／freshness contract 判斷，不將本機任意修改 DB 的能力誤稱為
遠端 UI exploit；本工具仍假設可信本機 checkout，不是惡意本機使用者的安全 sandbox。

| ID | 分級 | Finding | 最小必要修正 |
|---|---|---|---|
| R2B-01 | **P0** | Copied pipeline manifest 的 self-reported hash 可繞過 integrity；改過的 code 可以被 materialize 且付費前未 BLOCK | 將 engine manifest 本身納入 authoritative sealed refs；重算 closure manifest root，對照 run binding；驗 exact allowlisted files/path set 與每個 copied byte hash |
| R2B-02 | **P0** | voiceBundle 只驗 JSON、不驗引用的 MP3/alignment；改 alignment 後仍 `approved / productionReady:true` | Artifact graph 做 transitive integrity；voice pair／pinned pair／bundle children 都驗；producer invalidation 必須撤銷 review/approval/readiness |
| R2B-03 | P1 | Pinned hit 在第一個 request 中途變更，下一個 paid request 仍送出 | 每次 dispatch 的 freshness 要包含 receipt-bound pinned cache，不只初始 planner／最後 manifest |
| R2B-04 | P1 | Receipt content hash 寫了但 dispatch 未驗證；DB 內 content 變更仍執行 | claim／dispatch 重算 content hash、比對 DB receipt_hash 與 envelope/bindings；DB 禁止更新 immutable content，status 另存 |
| R2B-05 | P1 | Receipt expiry 只在 claim 檢查，之後 request 不再檢查 | 每個 dispatch／reserve transaction 檢查 expiry/status/hash/fence；expired fail closed |
| R2B-06 | P1 | Audit 重做但媒體 bytes 相同時沿用舊 accepted bundle；milestone 回到 approved，沒有新 review | Review prerequisites 綁完整 current bundle/evidence graph，非只有 verification/final/episode 三個 byte hashes；任何 included report/evidence 更換都開新 session |
| R2B-07 | P2，**post-P6 publication blocker** | Recovery 信任 marker.files 自述清單；空清單＋缺失 target 仍 COMMITTED | 完整 marker schema、tx/bundle/approval hashes、journal target set/size/hash 一致才 roll forward；失配 BROKEN |
| R2B-08 | P2，visual gate correctness | Audit 的 no-reversal 只抓相鄰非零 delta 翻轉；stationary→持續倒捲可 PASS | 檢查 phase-aware monotonic displacement／cumulative excursion，不能只看兩個相鄰 delta 的符號 |
| R2B-09 | P1 | Receipt 已 commit、execution 尚未 claim 時 restart，issued execution 沒有安全可用的起跑／resume 路徑 | Recovery／resume 明確處理 issued，冪等排程同 execution，不建立新 paid rights |

### R2B-01：copied code 沒有可信的 manifest anchor

位置：`candidate.mjs:37–39,82–89`；`production.mjs:85–87,188–191`。

Candidate.create 封存 engine-manifest.json，但沒有把它的 bytes ref 加到 run.inputs。
Candidate.engine() 直接 JSON.parse；engineDrift 只比較真實 repo manifest.hash 與
candidate manifest 自述的 hash，沒有確認其 files 對應這個 hash。attemptRoot 又以
這份可改的 files hashes 驗 copied code。

重現：在 temporary candidate 把 copied assemble.mjs 加一行 harmless comment，
更新 engine-manifest.files 中該檔案 hash，保留原 manifest.hash。未碰 repo／DB／
任何 production assets。Confirmation 仍執行 **4 個 mock paid requests**，
attemptRoot 成功包含改過的 script。預期應為 0 requests + BLOCK。

測試只用 comment，沒有執行破壞性 script；但既有 assemble/render adapter 會執行
同樣被 materialize 的 code。不能因此保證 tampered candidate 不會寫出 workspace。
這不是已發生 canonical/frozen 污染；是可繞過所宣告執行完整性邊界的確切證據。
不要求建立任意本機 attacker sandbox，只要求 immutable execution closure 不相信
自己的可改 metadata。voiceConfig 的 copied bytes 也應由同一可信 manifest 驗證。

### R2B-02：transitive voice dependencies 漏驗，readiness 過期

位置：`production.mjs:125–145,257–270,378–405,509–524`；
`paid-voice.mjs:123`。

Chain 驗 step.result.outputs，voice 步驟唯一 output 是 voice-bundle.json。
其 pairs 裡的 audio/alignment refs 沒有遞迴驗證；engine／inputs freshness 也不管它們。
付費 resume 的 sealed ready() 更只驗 pair 存在。

重現：mock voice＋fake local steps 到 approved，只改 candidate 某一個 sealed
alignment JSON。GET view 仍 **productionReady:true**。不是改 DB 或改 manifest hashes。
Final MP4 自身未被改動；問題是 candidate 的 source/provenance assets 已 stale，
server 仍宣稱 exact bundle／approval current，違反 upstream invalidation contract。

修正需涵蓋 GET/readiness、dispatch/resume、assemble/review/media 與 promotion preflight，
而非僅 assemble 時再驗。Missing／changed nested ref 應 invalidate voice 與全部
downstream、stale reviews、readiness=false；sealed existence 不能作 success evidence。

### R2B-03：cache freshness 不能只在起跑時檢查

位置：`paid-voice.mjs:117–123,167–174,210–220`；`production.mjs:72–89`。

第一次 run 建立 cache；新 revision 改 Hook 與 Ling 唸法，因此 preview 是 2 misses＋
2 pinned hits。在第一個 mock response 中改掉 pinned audio；結果 **2 個 requests
都送出**，直到 writeManifest 再讀 cache 時才失敗，預期最多第一個已在途 request。

每次 guarded dispatch 呼叫的 assertFresh 目前不驗 pinned refs。不可把它 silently
變 paid miss，也不可等整輪多扣一次後才報錯。Shared cache 在 preview 後增刪並不
影響已 pinned snapshot，這個設計正確；本 finding 是 pinned snapshot 自己的 drift。

### R2B-04／05：receipt integrity 與 expiry

位置：`paid-voice.mjs:65–69,96–109,167–190`。

Content 寫入 SQLite 後 application 正常流程沒有更新它，屬於邏輯上的 immutable。
但是 receiptHash／DB receipt_hash 未在 executeVoice 比對；review-only test 修改
temporary DB 的 budget content、保留舊 hash，仍執行 4 mock requests。這不是證明
UI 可以提高 budget，也不是 cryptographic 防惡意 DB 管理員的需求；是 integrity
field 沒有 enforce，與聲稱的 contract 不一致。

Expiry test 在第一個 response 後將測試 clock 推進一小時，剩餘 requests 仍送出，
共 4 次、預期 1 次。預算 sum 在真 dispatch 前的 DB transaction 保留這點已實作，
但它不能替代 valid receipt status/hash/expiry 檢查。重查需在同 reserve boundary。

### R2B-06：approval 沒有綁完整 current evidence

位置：`production.mjs:119–145,340–374,378–405`。

Review stepInputHash 只有 verification/final/episode。Accepted bundle 卻包含 audit
report、assembly、manifest、alignment 等更多 assets 和 attempt IDs。改舊 layoutAudit，
chain 正確 invalidates audit；resume 產生新 audit，但 renderSpec bytes 相同，下游
media/verify reused，舊 review step 也被 reused。

反例得到 milestone=approved、review 仍是舊 accepted bundle，沒有 current new review。
重要限制：此 resume 路徑 run.state 變 awaiting_review，因此當下 productionReady
是 false，不是已證明新 MP4 被錯誤批准為 true。但 state/milestone/session 互相矛盾、
舊 bundle 仍指 corrupted report，且 UI 沒有可接受的新 session；必須在 P6 前修。

Invalidation 不能只 break chain；應撤銷 accepted reviews。Review input 應包含重新
計算的 current bundle hash、所有 verification/warning/seam evidence；accepted milestone
也需 current exact graph，而非比對舊 step.report.bundleHash 即可。

### R2B-07：promotion recovery 完整性（不是首次 P6 blocker）

位置：`promotion.mjs:65–68,145–150,162–176`。

在 temporary fake repo 注入 crash after-marker-before-DB，將 marker.files 改 []、
刪掉唯一 target。Recovery 仍 **COMMITTED**、gate open，預期 BROKEN。
`marker.files.every()` 空陣列為真，且沒有對照 journal 的完整 target set、bundleHash／
approvalHash／size。不要拿 marker 自述清單當 transaction evidence authority。

其餘設計有有效 protection：allowlist、frozen paths/folders case handling、parent
alias/junction refusal、existing destination collision、no-replace hardlinks、SQLite
lifetime publication lock、intent journal、按 inode/hash 判 rollback ownership。
它們已由原 promotion tests 覆蓋；但不足以批准 publication capability。

還需 harden：lock 應綁 canonical repo 而不只是單一 stateDir；marker fsync、同 volume
與 staging/path guard；已 COMMITTED publication 在 consumer read 時仍需完整 hash gate；
resume/chain 等 canonical-sensitive entry points 必須遵守 publication gate，不只
preview/confirm。Hardware power loss 未被本輪證實。

Promotion 預設 enabled=false，這些 **不阻止隔離 P6 產片與人工驗收**，但啟用
canonical publication 前必修。維持關閉即可，不要求先重構 legacy readers。

### R2B-08：no-reversal 漏測（visual correctness，非付費 blocker）

位置：`camera-solver.mjs:206–209`。

Pure evidence test：camera 靜止後每幀倒捲 10px、共 60px，沒有相鄰兩個大 delta
符號翻轉，audit 沒有 CAMERA_REVERSAL。這是 audit predicate 漏洞，不是單純調整
maxReversalPx 可以解決。但 solver 另有 anchor forward constraint，所以此 synthetic
counterexample 不證明目前每個實際 candidate 都會倒捲。可列 P6 visual calibration /
gate hardening，人工視覺 gate 必須保留；不能宣稱 full-frame audit 已證明全段單向。

## 2. Paid safety 與真實 client boundary

### 已確認成立的部分

- Current buildRequest 建 exact provider URL/body，receipt 綁 JSON body bytes hash，
  voiceId/model/settings/prosody/outputFormat 經 prepared segment／request hash 保護。
  每次 synthesize rebuild body 並比較；不是 Studio 的另一套 TTS request schema。
- Arthur／Ling assignment 來自 voices.json roles；whole sentence+parts 只有一個 TTS
  hash/request，parts 交給 original split/assembly，silent/duplicates 不另買一次。
- Confirmation double click、HTTP retry、multi-window 正常路徑返回同 execution；
  challenge consumption 與 idempotency rows/unique constraints 在 transaction 內。
  單一 stateDir coordinator lifetime SQLite EXCLUSIVE lock 阻止第二 process。
- Durable dispatch_intent 在外部 HTTP 前 commit；characters/requests 累計 reservation
  包括 failed/unknown，不自動 refund；characters 使用 text.length UTF-16。
- Current HTTP/timeout/network/malformed JSON/NO_ALIGNMENT failure 被 DispatchStopped
  包裝，不觸發原 generator paid retry。原 AlignmentError 的 retry callback 只能
  replay durable response，不再次 network；原測試皆一次 mock request 即停。
- Partial success 保留 sealed cache；同 receipt 只跑未嘗試 segments；unknown 不可
  resume。Recovery 要新 envelope/receipt 與 possibleDoubleCharge acknowledgement。
- Crash 在 dispatch 中無 durable response → unknown、不重送。Review 新增的
  response file 已落盤但尚未 attach ledger 空窗，也正確 unknown／拒絕舊 receipt。
  Response_received 未 seal 的 startup recovery保守 failed，不猜其已可用。

### Mock 可以證明與不能證明的事

Mock 注入 fetchImpl，但仍走 current synthesizeWithTimestamps 的 buildRequest／
JSON parser、alignmentToWords、validatePair、原 MP3 decode/cache/assemble。因此它
沒有绕過 production parser。測試含 HTTP 500/429/401、network、timeout、bad JSON、
missing/mismatched alignment，對 adapter semantic 很有用。

但是 mock 是對 body.text 產生完整逐字 alignment 的 tone MP3，不驗 account model/
voice entitlement、settings 的 provider 接受方式、normalized text、真實 socket/body
stream 行為、費率或真聲音。不能以這些 PASS 宣稱 eleven_v4／兩 voiceIDs 今天可用，
或 promise failure 不扣額。voices.json 的 comment 本身也保留歷史相容性待驗註記。
Current client.characters=text.length，不是 provider billing；ledger 的 billed=null
與 UI disclaimer 正確。沒有驗證 provider idempotency，所以不承諾外部 exactly-once。

### 第一次真實 request 前的零付費 preflight

修完 P0/P1 後，另做 **reviewable offline preflight**，不要先送 TTS：

1. 在 Studio 對所選真實 source revision 做 compile/validation、production decisions、
   card bounds/time-ref parity、tools/fonts/ports/assets/frozen/collision preflight。
2. 用 current prepareNarration/buildRequest 重建每個 exact request，打印安全 metadata
   與 spoken text，對照 sealed envelope/receipt/body hash、聲音設定、parts／budget。
   Key 僅檢查設定有效與否，不輸出；不把 secrets 傳給本機 mock。
3. 用錄製／現有 cache 的真实 MP3+character alignment，在 temp workspace 驗 original
   client parser→validated pair→assembly。僅讀 frozen assets，不寫、不 re-render。
4. 補真 Node fetch 對 loopback HTTP mock 的 body truncation／abort／timeout／response
   persistence crash tests；現有 direct function mock 不能取代 socket semantics。
5. 新 review-only safety assertions 轉成正常 PASS，receipt/cache/input graph重新驗證。

以上無 provider requests，也不保證 account/server 當下接受 request。若需要額外
provider capability 確認，另行提出只讀 metadata/documentation preflight；本輪沒有
呼叫任何 ElevenLabs endpoint。真實成功聲音、seam 自然度仍只可由首次受控 production
與本人聆聽驗證，不能在 review 中假稱完成。

## 3. State / restart / isolation / media

Inputs 固定 source/decision/revision、2A artifact hashes、loaded Studio engine hash、
pipeline closure；async steps 有 run epoch fence，decision PUT 先 mutation intent +
revoke 再更新 draft。GET reconcile 會偵測 2A source/artifact/engine drift。這些可保留。
缺口集中在 engine manifest anchor、nested artifacts 與 current review bundle evidence。

另已用反例確認 R2B-09 recovery gap：confirmReceipt transaction 已 issued 但還没 startVoice／claim
時 crash，recover 只將 running execution 改 interrupted；issued 留原狀。resumeVoice
只接受 interrupted/failed，confirm replay 不重新 schedule，preview 又沿用已開始 run。
會卡住 voice_confirmed：replay 返回同 execution 但 0 requests，resumeVoice 報「沒有可續跑的 execution」。
沒有 duplicate charge 證據，但需 P6 前補 issued recovery／同 authorization enqueue，
不能以新 receipt 繞過。Child PID recovery 只查 PID 是否
存在、resume 不再檢查 alive orphan；另列 recovery hardening，不能以 PID 冒充身份。

正常 candidate paths 隔離成立：byte copy closure、fresh attempt root、固定 argv、
shell:false、原 REPO_ROOT 指向副本，createCache/assemble/render defaults 落 attempt，
不複製 .env/.git/frozen assets，canonical cache只讀。Hash/path guards、reserved names /
ADS/traversal rejection、exclusive writes 都已實作。Credential getter僅在paid claim後讀
repo .env，沒有把key放process.env；local Node workers移除ELEVENLABS_API_KEY。
這些不是 OS filesystem sandbox；R2B-01 讓被改的 code 能進這個執行環境，須先堵住。

Render 固定 --narration-only；mix單獨一次，不接受 --no-verify；verify測 narration-only
並將 final完整解碼、frame count及h264 stream binding接合。Required verify checks拒空／
缺項／FAIL／nonzero exit。Partial localoutput無success attach，restart另開attempt。
Ports被別人占用BLOCK不殺process；原CLI8131/8132用lifetime renderer lock。

新增正向反例測試：兩個不同 key 的 Accept，第二個409；替換 sealed final MP4後
productionReady=false且media(final)404。正常 final substitution defense成立，不能
把R2B-02說成這條路徑也已繞過。sameVideoStream仍應檢查ffmpeg exit/error/截斷，
mix check完整性應驗名稱而非只驗數目，列P2 hardening。

Human seam clips由原take／assembledWAV生成，另外可seek exactfinalvideo；5項visual
checklist和每warning必勾，舊source/revision acceptance409。P0/P1修好完整graph後
可保留此human gate。MP4 URL目前按currentrun，不含bundlehash；應增加expectedbundle
token避免舊視窗Range／seek載到其他版本，現有oldrevisionaccept409則已阻擋直接批准。

## 4. Camera / visibility 與 compiler structure

确實不是AI猜pixels：geometry-worker用candidate原renderer的renderFrame逐幀量測，
solver根據真plan、notes動畫settle、requiredrects的可行interval決定offset。
最多6次、找不到解即BLOCK、不改copy／字體／所選vocab強過。Renderer/fitCamera/verify
normalization parity在付費前與真alignment後檢查；compiler cue key已作Studio修正。
未改sharedtemplate或ReadingCue。

原shared audit+extended audit覆蓋每個30fps輸出frame，檢查sampleindex/frames並做40個
random-access pose parity，不只截圖抽查。這證明離散輸出frames coverage，不是連續
時間collision證明。Geometryreport记录browser/fonts，但environment fingerprint未作
durable prerequisite；font/browser/ffmpeg改動後應重新audit/review，不宜當跨機器證據。

| 使用情境 | 本輪確認／限制 |
|---|---|
| Long vocab/card、long Arthur example | 真renderer付費前innerHeight/overflow dry run；overheight BLOCK。沒有全面真語音／長文E2E證據，不能承諾任意長例句可解 |
| Phrase | 原phrase rendering/helpers、whole-sentence TTS、allkeyrects；現有tests有phrase compile／envelope與synthetic geometry |
| Multiple vocabulary | 多notes／open/close／resume映射；原tests有multiple compile／preflight。重點仍須真alignment後full-frame，不能沿用fixturetimes |
| Sentence middle/end | 中間parts一take；句尾plainsegment後教學。compiler per-sentenceblock可涵蓋兩者，不改handoff semantics |
| Short/long story | Reading anchors隨真lines生成，visibility跟前block last line；long/rapid speech可因transition無解BLOCK，不保證一次solve成功 |
| Quiz | question/options/feedback phase constraints、thinking期可讀、prematureQuiz hardgate、rawsnapshot不自動改copy |
| Outro | renderer自動appendcamera；episode cueDuration由confirmed duration/scroll計算，不固定1.5；sharedaudit文字與extendedmascot visibility |
| Animation overlap / viewport transition | 真renderer逐幀audit與settle extension，6次bounded solve；無解安全停下，需表單新revision修正 |
| Backward movement | Anchor solver有forward constraint，但full-frame reversal predicate有R2B-08漏測，不可宣稱完整單向證明 |
| Lower whitespace | Soft warning＋人工streamingcheck；contentBottom取所有已visible內容的最大bottom，未clip到viewport，可能由遠處內容掩蓋目前空白。需改viewport occupancy measurement，非只調threshold |
| Content appearing too early | Quiz有硬限制；storylookahead／Hook悬念語意仍人工評估。Opacity/ancestorclip不像rectbounds已完整建模，需保守校準 |

此次重新跑的真localE2E（HTTP與browser）都是singlefixture，使用mocktone聲音。
之前MILESTONE-2B回報三fixturesfullchain，但本輪不將那段文字當獨立證明全部long/
phrase/multiple新case都已通過。讀code／puretests／前付費geometry能支持架構方向，
不能支持「所有真資料一次產片」的承諾。

**每句一block不是P6 safety blocker。** Narration units、parts／note／Quiz refs仍是
production contract；block是layout container而非TTSunit。Sentence-block會增加paragraph/
translationspacing、每句cameraanchor與lookahead，可能讓feed更碎、教學return移動更密。
需P6檢查streamfeeling、pause、空白與camera節奏。先作第一次驗證合理，無須為了和
frozenreferences長得一樣重寫compiler／sharedrenderer。

Visualpolicy的readingTop/quizTop/速度／空白threshold可以P6校準，**不因未frozen判FAIL**。
不過R2B-08／whitespacemeasurement是gate coverage缺口，不是單純數值calibration；
應清楚呈現限制並維持人工gate。Camera無解後若需cut:late／timing／copy修改，現有
表單未提供全部seamcut控制，是automationgap；不得偷偷手改P6JSON或跑零散CLI。

## 5. Regression / adversarial evidence

| 檢查 | 本輪結果 |
|---|---|
| 原Studio suite（新增review檔之前收集原files） | **80/80 PASS**：原2A/2A.1 39＋2B 41；0fail/TODO/skip，約231秒 |
| 2A.1 review-safety另行重跑 | **5/5 PASS** |
| Existing offline audio-mix + voice | **92/92 PASS** |
| browser-smoke.mjs | **PASS**：decision persistence、no-Chinese FAIL、freeplan、Quiz drift；無externalnetwork/pageerror/overflow |
| browser-smoke-2b.mjs | **PASS**：fixture/mock，4requests，真localmediachain、reviewcheckboxgates、approvedreload；無externalnetwork/pageerror/overflow |
| P2/P3/P4/P5 FROZEN.json | **全部exit0 / intact**；sharedtemplate與ReadingCue integrity通過 |
| 新review-only adversarial suite | **11項：2PASS／9FAIL，exit1，沒有TODO／skip** |

新增test檔：`review-2b-adversarial.test.mjs`。它是正常safetyexpectations，不用TODO
偽裝驗收PASS；其失敗就是本review要留下的可重現contract。原80不因這些新expectations
而失敗，但日後glob `video-studio/*.test.mjs`會包含它，修正後應全部正常PASS。

| Review test | 實際結果 |
|---|---|
| Copied engine manifest tamper | FAIL：4mockrequests，modifiedcopy可materialize；expected0 |
| Pinned drift during first request | FAIL：2requests，expected1 |
| Receipt content checksum | FAIL：tamperedtemporaryDBcontent仍4requests，expected0 |
| Re-audit / old accepted bundle | FAIL：approvedmilestone，expectednewawaitingreview |
| Durable response-before-ledger crash | PASS：unknown、不沿舊receipt重送 |
| Expiry after first response | FAIL：4requests，expected1 |
| Nested alignment after approval | FAIL：productionReadytrue，expectedfalse |
| Concurrent Accept / final substitution | PASS：second409、changedfinalfalse/404 |
| Incomplete publication marker | FAIL：COMMITTED，expectedBROKEN（fake repo only） |
| Stationary→backwards camera | FAIL：noCAMERA_REVERSAL（pure evidence only） |
| Issued receipt restart gap | FAIL：同 execution 無法安全 resume，且 confirmation replay 不排程 |

Tests沒有修改productionbehavior。所有副本／DB／clockchanges只在reviewtemporarytest
環境；globaltestclockfinally還原，沒有對frozenassets做faultinjection。
原roottracked修改只有css/style.css與js/app.js，两者SHA256與開工前一致、未stage/revert。
ignoredQAscreenshots由browserregression更新，不是canonical影片資產。Index保持空。

## 6. 八個決策答案與下一步

1. **是否安全第一次真ElevenLabsrequest？目前不批准。** 修R2B-01/03/04/05、nested
   dependency dispatch/resume checks、issuedrestartgap，並做零付費preflight後再review。
   正常doubleclick／unknown／retry防護已成立，未重現正常UIduplicatecharge。
2. **是否安全P6自動到MP4？目前不批准。** Normalfixturechain成功，但executionclosure
   integrity與nestedartifactfreshness未完整。修P0/P1後允許無解BLOCK，不能保證任意
   文章一次完成，也不能人工JSON補洞。
3. **是否安全humanapproval？目前不批准current-contract。** R2B-02 readiness錯誤與
   R2B-06 oldbundle必修；正常finalsubstitution／olddecision／missingacks已會拒絕。
4. **Promotion是否安全？不批准啟用。** R2B-07＋publicationhardening是post-P6blocker；
   enabled=false時不阻止隔離P6 production／review，freeze仍不屬於2B。
5. **每句一block是P6blocker？不是。** Layout／rhythm差異可用P6第一次人工驗證。
6. **Visualpolicy是否只需calibration？數值是；gatecoverage不全是。** R2B-08與viewport
   occupancy等需codehardening／明示限制，不把它們說成改幾個數字即可。它們不是
   本次C的付費／approval根因，無需先frozen數值才測P6。
7. **第一次P6前owner需決定什麼？** 修正驗收後於Studio選真文章、series/episode/level、
   vocab、Hook（目前須真中文）、完整Quizsnapshot、Outro、translations或明確none、
   audio preset、proposedtiming/visualpolicy；確認UTF16requestbudget≠billing、零auto
   paidretry與unknown需新consent。保持promotion關閉，不能默認accept／freeze。
8. **是否需要shared-template revision？本次必修不需要。** 最小scope在Studio的
   candidate/hash/paidguard/artifactgraph/review/recovery；ReadingCue不動。若要求無中文
   Hook或發現renderercontract本身須改，另提revision與P2/P3/P4regressions，不暗改。

建議下一輪單獨修P0/P1（R2B-01至06與09）並將相應review-onlyassertions轉PASS；不要在這輪修code或
先用P6試付費。Promotion與visualcoverage的P2項目分開排程，不藉它們擴大必修scope。
