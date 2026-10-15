# 批量產生

本人授權自選文章與設定，不需中間逐支確認。入口 `/batch`，工作室及影片資料夾頁首可進入。只選數量與可選系列，免費估算一次後，按開始授權精確整批語音用量。產物集中「待確認」，每支看完按一次「看完了，沒問題」；另有修改草稿入口。

`batch-production.mjs` 僅協調現有 DraftStore、ProductionWorkflow 與 ProductionService，沒有新 TTS client、放寬驗證、繞過 paid receipt 或修改 frozen artifacts。來源與已建立草稿去重，跨系列輪流選擇；明確保存每支series/episode/level/Hook/Quiz與來源決策，再走原有compiler、validation、preflight。

批次記錄在 production/batches 下原子保存，approvalHash 綁每支 draftId、runId、envelopeHash、budget。準備不得讀 key／送新語音；已全部命中的免費run依既有規則可直接免費製作。付費必須本人按整批開始，CSRF驗證及 budgetAccepted=true；逐支使用原有 challenge／confirmReceipt／ledger。排隊逾15分鐘的challenge重簽只針對相同已授權envelope，確保不憑舊預覽換內容／提高費用。每支記executionId，idempotency key固定為batchId＋index。

每支完成後才開始下一支，以免本機renderer ports衝突。某支失敗或provider結果不明，標needs_attention且不重送，繼續其餘影片。重啟時running/preparing批次標interrupted，producing項目不回planned；本人可再按繼續，只處理planned項目。批次執行時拒絕其他單支新付費／重建操作，允許人工驗收。工作室／電腦須保持運行，關閉瀏覽器頁面不影響已開始的工作。

回歸：`node --test video-studio/batch-production.test.mjs`，包含整批授權前0 provider calls/key reads、精確budget、過期challenge、重複開始、provider失敗不重試且下一支繼續、restart不重新dispatch、stale draft及tampered budget在付費前拒絕。隔離手機UI自選→開始→重開→最後驗收通過；完整現行assemble/camera/audit/render/mix/verify以假語音通過10/10與6/6，並停awaiting_review。未代本人在真實批次付費、驗收、freeze或promotion。

2026-10-15 本人補充：新批次 auto-source-all-v2 預設教完每篇全部來源詞彙，按來源順序保存，不截成兩個，也不默默略過資料不完整的詞彙；不完整仍列具體錯誤。舊批次的語音預算、草稿與授權不因政策更新被改寫。多字共用停頓點依原文順序逐張教學，收起前卡再開下一卡；換幕停留只增加免費 silent segments，不分割原整句 TTS。
