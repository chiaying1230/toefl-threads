# AGENTS.md — AI agent 入口（Claude Code / Codex / ChatGPT 通用）

這個 repo 是 toEfu（英文單字學習 App）加上 `scripts/video/` 的短影音系統。

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
