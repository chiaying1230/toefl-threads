# p2 V2 — 獨立觀看體驗 review

基礎版本：`origin/ccr-3d922afa-7bt7wt` / `d30b706`。本次只做 p2 V2，沒有修改 App、安裝依賴、處理其他 episodes 或建立批次系統。

## 判斷與修改

原版已有連續向上滑動的 feed、前後內容露出、兩張一致的白色字卡與深色測驗。它比簡報更接近串流閱讀，但仍是文字主導的學習短片，沒有配音、實拍或音樂。

| 檢查 | 原版問題 | p2 V2 處理 |
|---|---|---|
| 第一秒 Hook | 先逐字出現數字與預算，紙箱反差稍晚才完整 | 第一格即呈現 90%、預算、紙箱與中文反問；Hook 約 1.84 秒後上滑 |
| 手機閱讀 | 未讀文字較淡；例句翻譯 42px，手機等效 14px | 加深未讀文字；例句英文 62px、中文 50px，手機等效約 21px／17px |
| 層級與顏色 | 白卡與紙色背景區隔較弱 | 保留黃色單字標記，增加藍灰字卡邊線；測驗保留深色背景 |
| 字卡一致性 | 兩字共用格式，這點成立 | 保留相同字體、順序、例句、中文、詞性、KK 與貼文用法 |
| 例句與節奏 | 完整例句保留，但大空白卡面先出現 | 兩句英文及翻譯原樣保留；卡面隨意思、例句與用法展開，降低空白面板感 |
| Scene flow | 一條 feed 的上滑方向成立 | 保留同一 track 與 0.55 秒 swipe；只調整字卡 anchor，讓大字有空間 |
| 中文停留 | 貼文中文剛出現，畫面就開始移動 | 句末停留由 0.1 秒增至 0.7 秒；中文於句末 0.15 秒出現，餘下時間加上上滑過程可閱讀 |
| 回顧 | 長篇英文約一秒就往下一段 | 縮成兩句單字應用，給約 2.8 秒回顧時間；不重複做字卡 |
| 測驗與結尾 | 測驗提示較長；下一篇位置較低 | 精簡提示，保留 1.8 秒作答窗；下一篇預告上移並補中文 |

## 輸出與界線

- `p2-v2.mp4`：1080×1920、30fps、H.264／yuv420p，時間軸 35.97 秒；沿用原版無聲形式。
- `p2-v2.still-*.png`：HTML render 的完整尺寸檢查圖。
- `phone/`：360×640 原尺寸檢查圖。
- `sheet-review.png`：最終 MP4 抽幀總覽；`mp4-stills/` 是 MP4 本身抽出的圖片。
- `verification.json`：媒體規格與 QA 結果。
- `review-changes.diff`：相對 Claude 基礎版本的修改 diff，便於區分這輪修改與搬入的原始腳本。

原始 `scripts/video/episodes/p2.json` 未改。V2 使用 `p2-v2.json` 與 `renderProfile: p2-v2`，觀看體驗調整只在這個 profile 啟用。共用 renderer 只增加既有 ffmpeg／ffprobe 的路徑設定及 MP4 faststart。

目前 checkout 原本沒有影片實作，因此只從指定 branch 取入 `scripts/video/`、兩支影片入口與影片設計文件；未切換整個 branch，以免帶入 App 變更。原 MP4 與總覽圖保留在 `baseline/`。

## 重現

本機已存在 Playwright、Edge、ffmpeg／ffprobe。`scripts/video/render-p2-v2.ps1` 只是這支影片的本機入口，記錄它們的路徑，不會下載套件。

```powershell
powershell -ExecutionPolicy Bypass -File scripts/video/render-p2-v2.ps1 -Mode render
powershell -ExecutionPolicy Bypass -File scripts/video/render-p2-v2.ps1 -Mode stills
powershell -ExecutionPolicy Bypass -File scripts/video/render-p2-v2.ps1 -Mode phone
powershell -ExecutionPolicy Bypass -File scripts/video/render-p2-v2.ps1 -Mode audit
```

這些指令依序執行。輸出均在 `docs/p2-v2/`。影片仍是 HTML → Playwright screenshots → ffmpeg，沒有改成其他架構。

## 尚需觀看決定的部分

保留教學字卡與純文字 feed，因此觀看感仍偏「滑貼文學單字」。這輪改善可讀性、首秒內容與連續閱讀，不代表已有真人敘事／配樂短片的節奏。完整例句使全片約 36 秒；是否喜歡這個資訊密度，應以 MP4 實際觀看決定。

## QA result

- Final MP4: 1079 encoded frames, 35.966667 seconds, H.264 / yuv420p / 30fps. Full ffmpeg decode passed with no errors.
- Layout audit: 180 samples passed. Moving frames are skipped by the existing audit; sampled transitions were reviewed visually.
- 14 stills extracted from the MP4 and inspected as a contact sheet; phone hook and example card inspected at 360x640.
- No App changes or dependency installation. All added files are under scripts/ and docs/.
