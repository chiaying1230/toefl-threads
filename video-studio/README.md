# Video Studio — milestone 2B

本機 production admin；與 toEfu 使用者 App、已驗證的 renderer 分離。

Windows：雙擊 **Start Video Studio.cmd**，server 啟動後自動打開 `http://127.0.0.1:8140`。關閉該 terminal 視窗可停止 server。需要 PATH 中的 Node（現行環境 Node 24）。工程師也可用 `node video-studio/server.mjs`。

支援：923 篇真實 `js/data` 文章、五個 pack、搜尋、作者與中英原文、vocabulary checkbox、三個原文擷取 Hook 候選與文案修改、meaning Quiz 推薦與人工選擇、明確 metadata、磁碟保存與重新開啟恢復。Milestone 2A 增加 compiler、既有 validator 與免費 voice plan。

候選不是 AI 生成的精修文案。短文章可能候選重複；請自行修改選定 Hook。Quiz 干擾項依詞性 / level 推薦，必須人工確認。任何候選都不預選；metadata 建議只有點擊「採用建議值」或自行填入後才保存為決策。這不是 renderer-ready episode。

`state/drafts/<uuid>.json` 是本機工作記錄（git ignored）。只有按「保存草稿」才保存表單修改；離開未保存內容會提醒。重新啟動 server 後所有 draft 可從選單繼續，同一瀏覽器會自動恢復最後開啟的 draft。換瀏覽器也能選同一份磁碟 draft。不要刪除 state，若要搬機可備份該目錄。

目前綁定 loopback，桌面可用；UI 已做手機尺寸 layout，但**實體手機直接連電腦尚未開通**。後續 LAN 模式須加入存取 token / CSRF、明確 bind 設定及防火牆說明，付費 API 開通前完成。不要直接改成 `0.0.0.0`。

安全邊界：server 只提供三個 UI assets 與 allowlisted API，不提供 repo 靜態檔、不讀 `.env`、不呼叫 TTS 或啟動 pipeline CLI。免費 planner reuse 既有 `planNarration`（其模組含 generation helper，但本系統只呼叫 plan 函式，不提供 synthesize / generate endpoint）。Frozen 內容可探索、保存或編譯於 Studio 隔離 workspace，不能覆寫正式資產。無付費、render、approve、freeze endpoint。

每次 API request 重新讀來源；sourceHash 不符會拒絕保存 / 續跑並作廢舊 artifacts，請建立新 draft。Draft optimistic revision 避免多視窗默默覆寫。保存採同目錄暫存檔 + rename；出錯回傳結構化 error，UI 保留未保存選擇。Compiler / helper 程式變更需重啟 Studio 再編譯；voice config 變更也會使舊 workflow 失效。

操作：保存全部選擇 →「編譯、驗證並免費規劃」，或分別點「只編譯」「驗證」「免費 Voice Plan」。Hook 中文留空是真實的無中文決策，現行 validator 不支援，會 FAIL 並停止 plan。不要填空白 workaround。Ling 唸法欄位只保存人工旁白決策，詞卡仍用來源中文。

Compiler 產生 `narration/<contentId>.json`、`episodes/<contentId>-auto.json`，格式是現有 production schema；實際檔案只在 ignored `state/drafts/workspaces/<uuid>/revision-N/<run-uuid>/`。**不寫正式 scripts/video / docs / outputs**。Episode 的 `/docs/<id>-auto/...` plan / audio 是未來 production target，尚未生成；勿把這些 dry-run JSON 直接送去 render。Artifacts 與 step reports 可在 UI 點連結檢視。

`compiled → validated → voice_planned` 只代表內容 schema / references 與免費 voice plan。Camera、visibility、Outro、layout、timings、接縫仍 unresolved；`productionReady` 一律 false。無付費按鈕，generatedThisRun 一律 0。現有 cache hits 表示 MP3 + alignment 同時存在，不代表本輪生成或音訊內容完整性驗證。

API：原 M1 六個 endpoints 保留；增加 `POST /api/drafts/:uuid/workflow {revision, action:run|compile|validation|voicePlan}` 與 `GET /api/drafts/:uuid/artifacts/:name`（narration / episode / compileReport / validation / voicePlan）。Workflow 失敗也回傳完整持久 draft（HTTP 200），必須看 `steps[].status / result.errors`、`workflow.failedStep`；HTTP 契約 / revision 錯誤用非 2xx `{error:{code,message}}`。Server 決定 status，client 不可提交 steps、approvals 或 frozen 狀態。

驗證：`node --test --test-isolation=none video-studio/studio.test.mjs video-studio/production.test.mjs`。UI smoke：`node video-studio/browser-smoke.mjs`（需要現行 Playwright / Edge 或環境變數指定路徑；只測 Studio，不 render 影片）。本階段 mapping 與限制見 [MILESTONE-2A.md](MILESTONE-2A.md)；初始分析與長期設計見 [ARCHITECTURE.md](ARCHITECTURE.md)。

## Milestone 2B（付費確認 → 製作 → 人工驗收）

詳細契約與限制見 [MILESTONE-2B.md](MILESTONE-2B.md)（設計：[MILESTONE-2B-DESIGN.md](MILESTONE-2B-DESIGN.md)）。

1. 在「5. Production 決策」確認 Outro、配樂、逐句翻譯、visual / timing policy，保存。
2. 「編譯、驗證並免費規劃」到 voice_planned。
3. 「免費：付費前預覽」：顯示每個 request 要唸的文字、speaker、model、characters、cache 命中、預算與重試政策；全部命中時不需要付費。
4. 勾選兩項確認後按「確認產生語音」：只有這一步會呼叫 ElevenLabs（讀 repo-root `.env`，不放進 process.env）。之後 assemble → camera → audit → render → mix → verify 自動在隔離 candidate 內免費執行。
5. 人工驗收：看影片、聽每個接縫、勾選視覺項目與 warnings，按「接受」或「需要修改」。接受不是 promotion、不是 freeze。

Promotion 已實作但預設關閉（`--enable-promotion` 需 owner 另行授權）。2B API：`GET /api/session`、`GET /api/drafts/:id/production`、`POST …/production/{preview,confirm,resume,resume-voice,review}`（需 `x-studio-csrf`）、`GET …/production/media/{final,review-sheet,seam-N-kind}`。狀態在 `state/drafts/production/`（git ignored，含 `coordinator.db`）。

驗證：`node --test --test-isolation=none video-studio/*.test.mjs`；UI：`node video-studio/browser-smoke.mjs`、`node video-studio/browser-smoke-2b.mjs`（fixture + mock provider，不付費）。
