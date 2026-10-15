# Milestone 1 validation — 2026-10-12

最新結果：Milestone 2B.1 safety fixes（2026-10-12），詳見 [MILESTONE-2B.1.md](MILESTONE-2B.1.md)：Studio 99 tests（97 pass、0 fail、2 todo = REVIEW-2B 的 P2 項目）；2A.1 safety 15/15；offline 92/92；兩個 browser smoke PASS；P2–P5 check-freeze intact。

以下為 Milestone 2B（2026-10-12）紀錄。

- Studio tests 80/80（2A 原 39 + 2B 41：付費邊界 19、camera / audit 5、promotion 10、pipeline 7）；offline audio-mix + voice 92/92。
- 2B browser smoke PASS：fixture + 本機 mock provider（沒有任何外部請求、沒有 API key）→ 決策確認 → 免費預覽 → 確認（double click 仍只有一個 execution、4 個 mock requests）→ 真實 assemble / camera / audit / render / mix / verify → 人工驗收（每個勾選都必要）→ approved；手機 / 桌面無 overflow、無 page error。2A browser smoke 仍 PASS。
- 三種 fixture（單字、詞組、兩個詞彙含句尾教學）完整跑到 awaiting_human_review；review sheet 人工檢視畫面合理。
- P2 / P3 / P4 / P5 check-freeze intact；ReadingCue.js、scripts/video、frozen assets、css/style.css、js/app.js 未改。沒有付費、P6、freeze、commit、push、tag、merge。

以下為 2A / M1 歷史紀錄。

- Studio API / compiler / workflow tests：`node --test --test-isolation=none video-studio/studio.test.mjs video-studio/production.test.mjs`。M1 與 2A 共 14 項，涵蓋單字、phrase / source forms、multi vocabulary、同句兩次 interruption / 整句一次 TTS、中文 Hook PASS、無中文或空白 Hook FAIL（輸出 null、不塞空白）、validation failure 停 plan、readonly cache counts / speaker assignments、workflow stages / server 重啟、partial draft、source live drift、decision edit invalidation、artifact tamper、engine restart、interrupted step、workspace path guard、origin / static allowlist。全部 PASS。
- Existing offline suite：audio-mix + voice 共 92/92 PASS。Sandbox 的 CLI spawn smoke 初次被 EPERM 阻擋，auto-review 允許 subprocess 後通過；只執行既有 offline tests / mock client / 免費 CLI plan，沒有付費或 reference render。
- 實際 Edge UI smoke：M1 選擇保存 → 無中文 Hook validation FAIL 與 reload persistence → 填明確中文並保存 → compiler / validation PASS / free plan → reload 恢復 voice_planned。手機 390×844、桌面 1280×900、展開 failed / succeeded JSON detail 都無橫向 overflow；無 pageerror，無外部 network requests。選的是 `p1` readonly source 的暫存 draft，不指定 P6；phrase real source 額外 dry-run 在 memory / temporary stores，不寫 canonical。
- 所有 production JSON / reports 僅在 isolated state / temporary test workspace；測試 state cleanup，QA 截圖在 ignored state/qa。没有 narration WAV / alignment / manifest / MP4 輸出。
- P2 / P3 / P4 / P5 開始與完成後各跑 check-freeze，均 exit 0、intact；shared template / ReadingCue / validator / planner 原始碼未改；沒有 freeze、commit、push、tag、merge。
- 工作期間發現 root `css/style.css`、`js/app.js` 另有修改；本輪工具未寫入這兩檔，保留未處理。Studio 的改動只在 `video-studio/`。
- 本 milestone 的 productionReady 永遠 false：camera / visibility / Outro / layout / timing / seams 尚未完成。未開始 2B。

---

- Branch：`p5-validation`；開始時 tracked working tree 無差異，有既有 untracked production 中間檔，未更動。
- `node --test --test-isolation=none video-studio/studio.test.mjs`：3/3 PASS。驗證 real source adapter、levels override、詞組、canonical legacy 編號建議、partial / configured draft、磁碟 store 重啟、HTTP server 重啟、revision 衝突、source drift、錯誤 vocabulary / level / Quiz、origin / static allowlist、付費 / freeze endpoint 不可用。
- `node video-studio/browser-smoke.mjs`：PASS。使用暫存 `p1` draft（不是製作 P6），實際 Edge 操作 checkbox / Hook / Quiz / metadata、保存後 reload 恢復；390×844 與 1280×900 無橫向 overflow、無 pageerror。檢視 mobile screenshot；表單內容與 radios / checkboxes 可讀。QA PNG 在 ignored `state/qa/`，不納入 canonical 或交付資產。
- 瀏覽器子程序需要 sandbox escalation，auto-review 已允許；沒有跑 renderer。
- P2 / P3 / P4 / P5 `check-freeze` 開始與完成後皆 exit 0、intact。工具文字固定稱 P2，但實際逐一傳入四份 FROZEN 檔。
- `git diff --stat` 空白：沒有改 tracked files，只有新增 `video-studio/`；ignored state 不進 Git。
- 無 shared template / ReadingCue / voice / renderer / verify 改動，因此未 re-render frozen references 或跑 template regression。未呼叫 ElevenLabs，未 freeze、commit、push、tag、merge。

限制：Hook provider 是原文擷取，非 AI 精修；Quiz 干擾項需人工審查。第一階段沒有 narrator / episode compiler、voice plan、production runner、MP4、approve / freeze，也沒有實體手機 LAN 存取。測試不代表完整 production pipeline 驗收。
