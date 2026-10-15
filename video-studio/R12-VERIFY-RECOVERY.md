# ielts-017：r12 免費回復

2026-10-14。已用原本付費語音完成正式影片，等待本人觀看／實聽；未接受或發布。

原 draft `fddd18eb-fcc2-41c1-af2f-76349cce05ed` revision2；failed run `967f7699-6345-4e45-9e2e-900cbc415af8`，candidate `0f8bd1af-7b6a-44b4-943a-4bdeb2e6d4ea`。

`hookLine` / `story001` / `story003` 的尾 slack 是 75 / 75 / 65ms。原始取樣格量到 50ms，因 35ms head trim 後的播放格差半格，播放器在弱尾端量到不同 voiced bounds。Sealed engine / inputs / voice / outputs 完整性均通過，不能靠重錄或修改無關文字修正。

r12 在既有 final PCM / source grid 檢查之外，補 playback grid 檢查；只處理超過既有 60ms 的 slack，保留 source-grid speech，alignment 僅 exact sample offset rebase/clamp。不能安全修正則 BLOCK。threshold、tolerance、renderer、ReadingCue、voice request contract 不改。外置 revision 在 `docs/video/revisions/r12-playback-grid-trim.json`。

回歸：102 項 offline PASS；P2–P5 plan / WAV byte-identical，4 支現存正式 MP4 verify PASS。P2/P3/P4 逐幀比較 PASS；P4 初次 3 格既知片尾 mascot 位元不穩，單獨 repeat 0 differ，原 log 保留、baseline 不改。P5 本輪沒有另跑全幀比較，依 renderer byte hash / plan / WAV parity 與 verify。P2 兩個已由 owner 刪除的舊 reference 仍缺失，不把 stock integrity 宣稱全 PASS。

正式新 run `de64c6b6-bd57-40d1-99e4-c8d0e51fc07e`，candidate `d6acd540-86fc-4f02-8cac-65770de24901`：8 個製作步驟成功，verify12/12、mix6/6、16 聲音行時間 PASS、max tail55ms，所有原始 decisions 與 revision 不變。免費預覽14 hit /0 miss /2 silent；新增 receipt/execution/attempt/network request/paid characters=0，Promotion OFF。State awaiting_review，productionReady false；人工接縫品質未代為確認。

共用 pipeline 更新的回復功能先前只比較 Studio helper hash，漏掉 engine closure 的真實差異；已補 `engineDrift`，並加入 shared-update-only 的隔離測試。同版本失敗仍不能無限重建，完整 sealed 音訊驗證仍是必要條件。

正式影片：`http://127.0.0.1:8140/api/drafts/fddd18eb-fcc2-41c1-af2f-76349cce05ed/production/media/final`。診斷、回歸、隔離完整 replay、正式零付費證據保存在本次工作區 `audit/current-verify-diagnosis.json`、`verify-grid-evidence.json`、`r12-frozen-*`、`r12-free-replay/report.json`、`r12-live-result.json`。
