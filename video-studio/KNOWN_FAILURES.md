# Studio 已知失敗與防止再犯

本檔記錄產品缺口與必要回歸。測試通過不等於使用者已驗收影片。

| 案例 | 原因與修正 | 必要回歸 |
|---|---|---|
| 顯示詞義與發音不一致 | `meaningDisplay` / `meaningSpeech` 分開保存，差異提示與一鍵同步 | display-only 修改沿用選定 immutable take，不重新付費；保存、重開、stale |
| 選語音後鏡頭 6 次仍失敗 | 每次只修一個獨立轉場，耗完嘗試 | 有多個轉場的真實／mock plan 全幀 audit；same failure blocked；新修正免費重建 |
| 完成後仍停在 0/n 確認 | 已接受狀態與檢查表呈現混在一起 | 已接受版本進完成頁，有播放、下載與實際保存位置；不代替使用者接受 |
| 每次要自己記系列集數，elem-02／elem-012撞第1集 | 集數建議只讀 canonical episode，不讀 Studio saved drafts | 新草稿自动预留各系列 next episode；重開／重錄保留原號；手動跳號、同時新建與只改集數測試。elem-012本人授權修#2，保留語音免費重建 |
| 找不到以前影片在哪裡 | 工作室只有當前影片入口 | 頁首「影片資料夾」列出 verified Studio版本與canonical reference，搜尋／播放／下載／實際路徑；封存hash不符不提供入口；不得要求找JSON／CLI |
| 影片列表混在一起且重複舊版本 | 全部run直接展開，沒有上傳分類 | 最新可播放版本去重、預設標題折疊、兩區drag／手機移動按鈕；分類持久化且綁具體版本，新版回未上傳；封存檔保留不破壞依賴 |
| 看完影片仍被要求逐項勾選 | 人工驗收拆成太多必填項目 | 本人按「看完了，沒問題」一次確認整支影片，receipt 記錄 whole-video；接句重聽與檢查紀錄選用；bundle／版本／機器驗證門檻不變 |
| Quiz 每題答案都是 A | 推薦固定把正確詞義放第一個 | 新推薦以內容與詞彙的穩定 seed 分散 A/B/C；正確詞義、feedback 同步；舊已確認排序保留，來源變更仍要求重確認 |
| hs-016 的 mix-ups 時間定位失敗 | renderer／fit helper 對連字號的 normalization 不同 | Studio 用唯一且相容的教學詞當 anchor，再從真實 alignment 的 part end 計算 delay；原文與語音 request 不改，無唯一 anchor 仍 BLOCK |
| toeic-015 的 case: 無法標示 | ReadingCue保留冒號／引號等純顯示標點，但compiler只加入裸字case | 依來源標記的exact range加入完整原token作display alias（如case:）；不改原文／朗讀／受保護ReadingCue。冒號／分號／驚嘆號／問號／引號與非標點字尾拒絕測試，真實草稿free plan PASS；需完整mock畫面驗證實際黃色 |
| 同一標點邊界包含多個教學，批量又只選兩字 | compiler 用 find 只取一個 event，且明確擋重複 cut；batch 截兩字 | 同一 cut 分組、原文排序逐卡教學；cut 只切一次、resume 在整組最後一個教學與換幕結束後，原句仍一次 TTS。真實 plan 綁卡片開啟時間，silent transition 依 close/open/scroll durations 計算；短句不與 Quiz 強行合併。新批次選全部來源單字，缺資料顯示錯誤而非漏教；舊批次的預算／授權不改。toeic-01 三字完整 mock pipeline verify12／mix6 PASS；真草稿免費重檢 voice_planned，全部決策不變、0 新請求。 |
| 延遲 handoff 被驗證器誤判 | verify 的 wordTime 漏讀合法 ref.delay，與 renderer／audio-mix 時間不同 | r13 保持既有門檻，驗證時間納入 delay／edge；hs-016 真實決策假語音完整製作 11 checks PASS；四支 retained frozen 影片重新 verify |
| 前置檢查失敗卻說語音全部沿用 | 無 envelope 被當成零新請求 | 必須取得 envelope 且 requests=0 才顯示全部沿用；尚未規劃顯示尚未確認，不能誤導成免費 |
| 中文原文被送英文旁白 | 缺明確顯示／朗讀分段 | mixed sentence 的 exact ranges、字幕停留時間、英文與詞彙事件完整，字幕期全幀可見；Ling 詞義不受影響 |
| elem-012 翻譯空白 | 中文句號誤判，以及 subtitleProposal 漏接來源預填 | 自動帶入四句英文的中文；原文中文不重複翻譯；手機保存重開 |
| toeic-016 的 wedding 空白 | 中文句號無空格、拆分的新句 id 未映射，純中文的它／牠差異阻擋全部 | exact Chinese anchors 取得婚禮、英文其他句沿用來源翻譯；舊頁面空欄可直接保存，其他未保存決策不覆寫 |
| 混合開場失敗 | 選定畫面文案整段當成英文 TTS | 保留整句畫面、中文停留、只朗讀英文、合法 reveal；pure Chinese 提前顯示可理解的阻擋 |
| 尾端空白導致 VERIFY_FAILED（r10） | fade 後的 waveform bounds 未重新計算 | 最終 PCM 測量、完整真實 take 重建、P2–P5 WAV/plan parity，容許值保持不變 |
| 尾端空白導致 VERIFY_FAILED（r12） | 35ms head trim 使播放的 10ms grid 與原檔相差半格；原檔量 50ms，播放器量 65–75ms | 合成 weak-tail 音訊 + 這次 sealed 音訊；修正後完整 render/mix/verify；102 項離線測試、frozen byte parity 與逐幀 regression |
| hs-016 的切開後句尾留 200ms 空白（r14） | r12 的最終 fade／PCM 檢查只走整段分支，splitSentence 的 parts 漏接；切片 fade 移除最後 transient 後仍保留舊尾界 | 切片只在 final PCM 超出既有 60ms slack 時用同一修正與 exact word rebase；健康切片不改，sealed source 不覆寫；103 offline tests、四支 frozen plan/WAV byte parity、7 真實語音完整免費重建 |
| 共用程式修正後仍不能免費重建 | 回復流程只比較 Studio hash，漏看可信 pipeline closure 差異 | 僅更新隔離 shared assembler、不動 Studio helper hash，仍可重用 sealed voice 完整免費重建；無新差異則相同失敗仍 BLOCK |

相關測試：`story-subtitles.test.mjs`、`source-translation.test.mjs`、`hook-subtitles.test.mjs`、`camera-recovery.test.mjs`、`verify-retry.test.mjs`、`retake.test.mjs`、`wizard-browser-smoke.mjs`，以及 `scripts/video/voice/assemble.test.mjs`。

製作錯誤的回復提示必須區分「內容／take 不適用」與「免費製作程式問題」；後者保留語音並使用新版程式免費重建，不能要求改無關字幕或再次付費。
