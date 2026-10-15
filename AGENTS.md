# AGENTS.md — AI agent 入口（Claude Code / Codex / ChatGPT 通用）

這個 repo 是 toEfu（英文單字學習 App）加上 `scripts/video/` 的短影音系統，以及 `video-studio/`（本機影片工作室 UI）。

**從 GitHub 讀的 agent（例如 ChatGPT）：** 影片系統與 Video Studio 的最新內容在分支 **`p5-validation`**，不在預設分支。截圖、中間音檔、Studio 草稿／run 狀態只存在作者本機、不在 GitHub；細節見 `docs/video/CURRENT_STATE.md` 第 0 節。

## 做影片相關工作時

1. **先讀 `docs/video/CURRENT_STATE.md`**：跨 agent 共用的「目前仍有效」的狀態。
2. 只在任務需要時，才讀它「依任務再讀」表裡指定的檔案；不要先讀整個 repo。
3. **repo 裡的 canonical state 優先於你的記憶或舊聊天。** repo 沒寫的事不要猜，問使用者。

## 一直適用的規則

- **Frozen references 不可隨意修改**：有 `FROZEN.json` 的 episode（P2、P3、P4）及其影片、narration、alignment、音訊資產，不改、不覆寫、不重新 render。用 `node scripts/video/check-freeze.mjs [FROZEN.json]` 檢查。
- **修改共用 template / pipeline 必須做 regression**（`scripts/video/reference/`、`voice/`、`verify-episode.mjs`、render 相關檔案）：跑 P2 / P3 / P4 regression、離線測試，並新增 freeze revision。
- **`scripts/video/reference/ReadingCue.js` 是受保護的契約**，不改。
- `.env` 與 `ELEVENLABS_API_KEY` 絕不顯示、不提交。呼叫 ElevenLabs 會扣費：先 `voice.mjs <id>`（只規劃），使用者同意才加 `--yes`。
- series、seriesEpisode、level、Hook、Quiz 是使用者決定的明確資料，不要從 ID 或檔名推測、不要自己發明。
- 沒有使用者要求，不 commit、不 push、不建 tag。

## Studio 使用者流程品質

- 修復紀錄與可重現的已知案例見 `video-studio/KNOWN_FAILURES.md`；接手 Studio 時按相關案例驗證，不能只測 happy path。
- 「free plan PASS」或「audit PASS」只代表該階段成功，不能宣稱影片製作已完成。處理製作失敗時，沿用可驗證的 sealed 語音，完整跑 assemble → camera → audit → render → mix → verify → review preparation，再說明結果；不為測試增加 ElevenLabs request。
- 原始 take、alignment 與 sealed artifacts 不覆寫；修復建立新的 immutable candidate。驗證門檻不放寬，deterministic failure 不以重按或改無關文字解決。
- 完整機器驗證通過仍需本人看影片／實聽接句，不代替本人接受、freeze 或 promotion。
- 本人已授權 Studio 批次模式自行選文章、系列預留集數、來源 Hook／詞彙／Quiz 與既有視覺／配樂設定；只確認最後影片。批次開始前一次列明精確 envelope 的整批語音上限，明確按開始後才可依該授權執行；免費估算不是付費同意，不自動重試失敗或不明結果。
