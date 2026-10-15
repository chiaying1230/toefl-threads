# Explicit source display-only — Studio wiring

2026-10-13. Studio-only; shared production part/schema/renderer unchanged from r9.

## Form and persisted decision

「原文：畫面保留、不朗讀」列出完整 source paragraphs；不預選任何中文。
勾選需要只顯示的段落，再保存；取消勾選並保存恢復原文朗讀。
目前支援完整段落，不支援自行切半句或任意 selection offsets；含 marked vocabulary
的段落不可排除。需要翻譯的 spoken sentences 會跟著選擇增減；切換保留其他未保存文案。

`draft.decisions.sourceDisplayOnly` 保存完整 snapshot array：

- `version:1`, `contentId`, `sourceHash`
- `from`, `to`（raw source UTF-16 半開區間，不是 marker 展開後位置）
- `text`（exact source substring，含原 emoji）、`textHash`（full SHA-256）

Store 重新對照 request-local source 的完整段落。未知欄位不成為 artifact authority。
Source / text / range / hash 不符回 409 + machine-readable problems，不猜位置、不換 snapshot。
Decision edit 使用既有 revision / coordinator mutation，撤銷舊 receipts/runs/approval。
GET / restore 在 `sourceDisplayReview` 發出 `needs_confirmation`，invalidate compile 及下游，
保存 `DISPLAY_ONLY_SOURCE_STALE`、timestamp，`productionReady:false`。新的 helper 在 engine
fingerprint 中；舊 process 要重啟、舊 artifacts 要重編譯。

## Compiler

先照原文展開 vocabulary markers、取得 sentence ranges；以 exact raw prefix expansion
計算 paragraph 的 expanded ranges，保留其餘 sentences 原 id、offset、forms / note / parts。
僅完整落在已確認段落內的句子排除 narration；若 range 碰到跨段未完成 sentence，
`DISPLAY_ONLY_SENTENCE_BOUNDARY` BLOCK，不拆 TTS 或猜測。未排除的中文繼續 BLOCK。

Confirmed source copy 映射為 `{type:"translation",text:"…"}`，依原文順序接到前一個
spoken block（開頭段落則放到第一個 block 最前）。不建立 narration line、silent timing
unit、speaker、TTS request。裝飾 emoji 依既有 compiler policy 移除，raw snapshot 不改。
顯示時機跟隨該 block；獨立 CTA 停留時間不在本次 scope。
Translation / camera / visibility / layout 幾何仍由既有後續流程處理，不宣稱 render-ready。

## elem-02 evidence

用 local draft `20ee16ed-e72f-4b06-9b4c-0387fc82b0f8` 的 decisions 複製到 TEMP，
在 browser 勾 CTA、保存、執行現行免費 workflow。沒有改寫 live draft 或 source。

- Compiler succeeded；MIXED_STORY_LANGUAGE 消失；Validation PASS；Voice Plan succeeded。
- `hook.zh:null` 原樣保存、PASS。
- 最後的 story block 含 translation「週末你們都去哪了」；所有 narration / plan speech 不含 CTA。
- 13 segments = 11 spoken / 2 silent；0 hits / 11 misses / 0 duplicates；202 estimated UTF-16 chars。
- Arthur: `hookLine` homework due tomorrow.; `story001` Sunday night. homework due tomorrow.;
  `v1Example` I finished my homework before dinner.; `story002` I am sleepy.;
  `v2Example` I feel sleepy after lunch.; `story003` The weekend is gone.;
  `v3Example` I relax at the weekend.; `story004` Where did it go??
- Ling: `v1Meaning` 家庭作業; `v2Meaning` 想睡的; `v3Meaning` 週末。
- question / answer 無聲。Plan-only：generatedThisRun=0、networkRequests=0。

## Regression

- Studio targeted suite 58/58：15 新 source-display cases，加既有 store/compiler/freshness/
  sentence adapter/2A.1 safety/Hook compatibility cases。Literal text、hash、range、contentId、
  version mismatch；真 source 改變但 claimed hash 未改；取消；restart；phrase/multiple/parts。
- Existing paid stale-receipt regression 1/1（fake provider，該案例 provider request 0）。
- Offline video 93/93。
- Existing browser smoke PASS；新 source-display browser smoke PASS：mobile/desktop、保存、
  restart、取消、stale 畫面、未保存翻譯不丟失、外網/provider/key access 0。
- P2–P5 frozen reference groups 全 intact，四個 manifest hashes 與 r9 record 一致；
  25 個 shared r9 files byte-identical。本輪沒有修改 shared、ReadingCue 或 frozen。
  P2 stock checker exit1 仍僅 r8 manifest 對 r9 validator 的已記錄 DRIFT；P3/P4/P5 exit0。
  既有 r9 frame / assemble / verify evidence 沿用，沒有 re-render frozen。
- Live draft、`css/style.css`、`js/app.js` hashes unchanged。

## Scope / remaining gate

最初的本輪接線沒有更動付費路徑，當時仍有旧 `HOOK_ZH_UNSUPPORTED` guard。
後續使用者已授權定向修正並保存真實 CTA 決策；latest paid preflight PASS 與 revision4
證據見 [P6-EXACT-ENVELOPE-PREFLIGHT.md](P6-EXACT-ENVELOPE-PREFLIGHT.md)。
Promotion OFF；未付費、render、freeze、commit/push/tag。
真實 ElevenLabs requests=0；沒有讀 `.env`、取得或使用真 key。

新增：source-display.mjs、source-display.test.mjs、source-display-browser-smoke.mjs、本記錄。
修改：compiler.mjs、store.mjs、workflow.mjs、server.mjs、public/app.js、public/index.html、
hook-cta.test.mjs（未確認 control，不依 owner 未來選擇而失效）、CURRENT_STATE.md。
