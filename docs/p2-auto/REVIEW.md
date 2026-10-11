# P2 auto pipeline — Phase 4.5 (audio mix layer) regression

測試版本（獨立檔案，沒有覆寫任何 reference）：

- `outputs/p2-auto-pipeline-music.mp4` — 自動 pipeline 旁白 + 94 BPM 配樂 + 答對提示音，30.400 秒。
- `outputs/p2-auto-pipeline.mp4` — 同一支影片，只有旁白（Phase 4 版本，未動）。

Reference `outputs/p2-v4.2-outro-music.mp4` SHA256 `09b4cc37…55bd6`，未改變。

## 新增的 reusable 層

`scripts/video/audio-mix.mjs`：讀 episode JSON 的 `music` / `soundEffects`，用核准版的同一組 ffmpeg 濾鏡混音；影片串流 stream-copy，
旁白增益 1（amix normalize=0）。沒有設定時不混音，輸出就是純旁白影片。時間用 `{line, word, edge, delay}` 參照 plan，路徑與秒數都不寫死。
`render-episode.mjs` 在 episode 有設定時渲染後自動呼叫它（`--narration-only` 可跳過）。

## 驗證（`mix-verification.json`）

| 項目 | 結果 |
|---|---|
| 影片串流與純旁白版完全相同 | pass |
| 長度不被音樂改變 | 30.400 → 30.400 秒 |
| 無 clipping | 峰值 −4.02 dBFS（核准版 −2.88） |
| 旁白在混音中保持原樣 | 與原旁白 SNR 39.3 dB（只剩 AAC 編碼雜訊） |
| 音樂低於旁白 | 每一句至少低 17.4 dB（最大值在 Ling 詞義句，其餘低 22–28 dB） |
| 答對提示音時間 | 觸發 26.749 s，混音檔中 26.750 s |

## Regression 對照核准版

以核准版 P2 V4.2 的原始輸入（`p2-v4.2-outro.mp4`、`p2-v42-outro.json`、V4.2 plan／narration）跑新層：
濾鏡字串與 `add-p2-music.py` 逐字相同（僅 effect 標籤編號 `[cue]`→`[cue0]`），輸出音訊與 `p2-v4.2-outro-music.mp4`
解碼後逐樣本一致，峰值同為 −2.88 dBFS。見 `mix-regression/mix-verification.json`。

## 兩種完整渲染

- 無 music / SFX 設定：與第一次純旁白渲染的影片串流、音訊逐位元相同。
- 有設定（整合流程）：音訊與單獨混音版逐樣本相同。影片位元與第一次渲染不同，PSNR 平均 41.0 dB、最低 39.8 dB（視覺相同，
  推測為編碼差異，未驗證原因）。
