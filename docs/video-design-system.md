# toEfu 單字情境短影音：設計規範與製作說明

## 目前確認的 short-video template reference（2026-10-11）

目前 reference implementation 是 [p2-v4.2-outro-music.mp4](../outputs/p2-v4.2-outro-music.mp4)，保留此可播放版本，不覆寫。詳細實作與驗證紀錄見 [Template Status](p2-v4.2-outro/REVIEW.md#template-status)。本節是目前已確認方向；下方早期規範、feed revisions、舊 voice 指令及案例保留為歷史紀錄，不能視為現行 reference 已完成跨 episode 或自動語音驗證的證據。

**CLEAR > RHYTHMIC > DECORATIVE。** 模板提供結構與視覺語言，每篇節奏仍依內容與聲音調整。

| 固定方向 | 用途 |
|---|---|
| White social-post surface | 串文與主要內容 |
| Warm neutral outer environment | 外部環境與次要背景 |
| Deep navy | Reading progress／navigation／「現在看這裡」；一般朗讀以深藍 underline 引導 |
| Yellow | Vocabulary／key memory／correct answer／「這個要記住」；不持續同時螢光標記一般朗讀文字 |
| Arthur | English story + English examples |
| Ling | Chinese vocabulary meaning |

已驗證的 viewing flow：

```text
Hook → Post reading → vocabulary yellow handoff
→ Chinese meaning → English example → return to story
→ Quiz → answer reveal → short Outro
```

Handoff 從深藍閱讀底線到 target word，轉為黃色 focus，展開詞義與例句，收回後恢復同一篇串文的深藍閱讀。Outro 從 Quiz／answer 自然延續同一白色內容視窗；吉祥物與動畫應有導引功能。

P2 的具體 timing、story length、vocabulary 數量、Hook animation、Quiz duration、Outro duration 都是 episode 設定，不能寫成所有 episode 的固定規則。題型、CTA 與情境動畫也保持可調。配樂與答對音效保留於目前 reference，不將本篇 BPM、gain 或音效時長提升為全域規則。

| 驗證項目 | 目前狀態 |
|---|---|
| P2 visual language | validated（使用者確認） |
| Voice quality | validated（Arthur／Ling 目前聲音） |
| Template architecture | partially validated（P2 結構已抽離，尚未跨篇驗證） |
| ElevenLabs automated voice pipeline | not yet validated |
| Cross-episode reuse | not yet validated |

下一步順序：Claude Code 完成 ElevenLabs voice automation → Codex review → 使用一個全新 episode 做 template stress test。此順序是後續安排，本輪只記錄，不執行。

Reference SHA256：`09b4cc3739ea15d251914f00b78fbf9416c713a7154f8fe9bbcf24d32fc55bd6`。

## 早期設計與製作紀錄

**影片的樣子**：觀眾在看一篇有趣的英文貼文 → 讀到一個不會的字 → 那個字從句子裡被「抽出來」學會 → 回到同一篇貼文繼續看 → 又學一個 → 最後發現整篇都看懂了。
它不是「Hook → 貼文頁 → 單字頁 → 測驗頁」的簡報。

外觀（版面、字型、顏色、字幕、吉祥物、動畫）全部集中在 `scripts/video/`，每一集只需要一份 JSON。

```
node scripts/make-video.mjs init p2 --ep 1                    # 從 App 資料產生草稿 scripts/video/episodes/p2.json
node scripts/make-video.mjs scripts/video/episodes/p2.json    # 輸出 videos/p2.mp4（1080×1920, 30fps）
   --preview          半尺寸、15fps 的快速預覽
   --stills 1,8,14    只輸出這幾秒的 PNG，檢查版面
   --phone            以 360×640 輸出（手機實際看到的大小）：檢查「不用放大就看得清楚」
   --audit            每 0.2 秒檢查：文字超出安全區、溢出、小於字級下限、元素重疊
   --beats            印出節拍表：畫面上每一次「資訊狀態改變」的時間
   --voice <dir>      加入旁白（見第 9 節）
```

## 1. 影片結構：一條連續的內容流

```
HOOK
  ↓
讀 chunk 1
  ↓
讀 chunk 2 ── 遇到單字 A ──→ 單字 A 從句子抽出 → 字卡（逐層揭露）→ 單字飛回原位
  ↓                                                              （同一篇貼文，繼續往下）
讀 chunk 3 ── 遇到單字 B ──→ 單字 B 從句子抽出 → 字卡（逐層揭露）→ 單字飛回原位
  ↓
快速回顧（≤ 2 秒，單字依學習順序打勾）
  ↓
測驗（用貼文原句挖空）
  ↓
結尾（✓ 單字 ＋ 吉祥物說一句），沒有 logo 頁
```

| 段落 | 元件 | 內容 |
|---|---|---|
| Hook | `IntroHook` | 貼文裡最有反差的一句英文，大字（120→76px），重點字黃色螢光筆掃入，下方一句中文引導。第一格就是完整畫面。 |
| 串流 | `ThreadScene` | 貼文切成 chunk（一句，或長句的一個子句，約 2–3 行大字）。一次只有一段在「念」；念完整欄上移，前一段變淡留在上方（像同一篇貼文在往上滑）。作者標頭不重複出現。 |
| 單字抽出 | `WordHandoff` | 單字所在的 chunk 念完，周圍文字降到 12% 亮度，被教的字保持亮著、放大並飛到字卡；學完飛回句子原位，貼文恢復繼續。 |
| 字卡 | `VocabularyCard` | **每個被教的單字都用同一張字卡**。在淡出的貼文上展開，隨資訊出現而變高。main 多停約 0.3 秒，而且它的 context 會念出來。 |
| 回顧 | `Recap` | 靜音、不超過 2 秒：✓ 單字＋中文，按學習順序一個接一個打勾。不是第二次字卡。 |
| 測驗 | `QuizScene` | 預設是「貼文原句挖空，選英文單字」；舊 JSON 的中文意思題仍然可用。 |
| 結尾 | `Ending` | ✓ 單字，可選的下一篇預告，吉祥物說結語。品牌是標頭那顆小標籤，不另做結束頁。 |

**`main` 單字的用途**：決定 Hook 用哪個字、測驗考哪個字、字卡多停約 0.3 秒並念出 context（其他字的 context 只顯示、不念）。它**不再**決定誰有完整字卡。

### 時間軸怎麼產生

`plan.mjs` 依 `thread.show`（要顯示的句子）和 `teach`（要教的字）自動建立：

1. 句子 → chunk（`text.mjs: chunkSentence`，優先在逗號／冒號／破折號切，每段 ≤ 13 字、≤ 84 字元）。
2. 每個 teach 單字歸入它**第一次出現的 chunk**；同一 chunk 有兩個字就依出現順序處理。
3. 時間線：念 chunk →（若有）字卡 → 念下一個 chunk …
4. 任何 teach 單字不在顯示的句子裡，會直接報錯，不會偷偷丟掉。

所有節奏數字集中在 `plan.mjs` 的 `PACE`；動畫時間在 `motion.js`。

### 長度

| 長度 | 處理 |
|---|---|
| 24–32 秒 | 理想 |
| 20–36 秒 | 可接受（36 秒以上指令會提醒） |
| > 40 秒 | 強烈警告：減少 `thread.show`、少教幾個字，或拆成兩集 |

教的單字數：2 個最佳；3 個可以；4 個只有句子很短時；5 個以上建議拆集（`init` 與驗證都會提示）。**不會自動刪除你指定的單字。**

## 2. 版面（畫布 1080 × 1920）

來源：`scripts/video/layout.js`。

```
y    0 – 200   平台頂部介面（帳號、搜尋）：留空
y  196 – 252   標頭：系列名稱（左）＋ EP 編號（右），整支影片都在
y  330 – 1240  主要區：串流、字卡、測驗
y 1262 – 1502  吉祥物（左，240px）；字幕在它右側（沒有吉祥物時置中，y 1300 起）
y 1560 – 1920  平台說明文字與按鈕：留空
x  > 948       按讚／留言／分享按鈕：不放文字
左右邊界 84px（右側 132px）
```

任何時刻，視線只該有一個焦點：串流只有「正在念的那段」是全亮；字卡打開時，貼文退到背景。

## 3. 設計變數與字級

來源：`scripts/video/tokens.css`（顏色、字型、字級、圓角、間距）。

色彩只有一個強調色：**黃色只用在重點字、念到的字、正確答案**。其他是墨色與紙色，不用漸層、發光、厚重陰影。

字型（Google Fonts，離線時退回系統字型）：單字本身 DM Serif Display；英文 DM Sans；中文 Noto Sans TC。

**字級**（畫布 px。起始值 → 下限；1080px 縮成手機 360px 寬時除以 3）：

| 元素 | 起始 | 下限 | 備註 |
|---|---|---|---|
| Hook 英文 | 120 | 76 | |
| 貼文／串流 | 64 | 52 | 先切 chunk，再縮字 |
| 字卡單字 | 180 | 110（片語換兩行 130→80） | |
| 中文意思 | 72 | 56 | 最多 2 行；括號補充另起一行 34px |
| context／例句 | 54 | 44 | |
| context 中文 | 44 | — | 空間不夠就不顯示 |
| 中文字幕 | 46 | — | |
| 吉祥物／引導 | 50 | — | |
| 測驗題目（句子） | 64 | 48 | |
| 測驗選項 | 64 | 48 | |
| 標籤（詞性、分級、標頭） | 24–30 | — | 不搶主要內容 |

**原則：放不下時，先減少畫面資訊，不是縮字。** 順序是：分 chunk → 減少同時顯示的句子 → 合理換行 → 刪掉低優先資訊 → 最後才縮字（到下限為止）。`--audit` 會檢查任何文字低於下限。

## 4. 字卡規則（`VocabularyCard`）

逐層揭露，**不要一次出現所有資訊**：

| 步驟 | 內容 | 時機 |
|---|---|---|
| 1 | **單字**（從句子飛來，serif 大字，黃色螢光筆） | 抽出時 |
| 2 | 詞性 · 音標 · **中文意思**（＋括號補充）· 分級小標籤 | 念到中文意思時 |
| 3 | **context**（短句，單字亮黃色，逐字念）＋中文（空間夠才顯示） | 念到 context 時 |

資訊優先順序（空間不夠時從最後面開始丟）：
1. 單字 2. 中文核心意思 3. 詞性 4. 原文／短例句 5. KK 音標 6. 例句中文 7. 分級

字卡一開始只有單字那麼高，隨資訊出現往下長高；字卡高度上限是主要區底端（y 1240），不會碰到吉祥物。

**context 的來源**（`words.<key>.ctx`，可手改）：
- 手寫的 `ctx` 最優先；
- 否則用貼文裡剛讀過的短語（例如 `completely arbitrary`、`allocate 90% of the company budget`）；
- 擷不出來才用字典例句。main 單字若例句不超過 5 個字就用例句，因為它的 context 會被念出來，必須短。

**誰會念 context**：main 字卡念出來（多一層）；其他字卡的 context **只顯示、逐字很快地亮過去，旁白不念**（`plan.json` 裡標記 `silent`，`make-voice.py` 會略過）。這樣每張字卡才能壓在目標時間內：旁白本來就要念單字與中文意思，再念一句 context 就會超過預算。

**時間**（p2 實測，估算語速）：非 main 字卡 3.6 秒（目標 2.5–3.5）；main 字卡 4.4 秒（目標 3.5–4.5）。含 0.4 秒飛出與 0.35 秒飛回。實際長度以旁白為準。

## 5. 串流規則（`ThreadScene`）

- 一次只有一段「現在念的」全亮；前一段 30%，更早的 10%，還沒念到的看不到。
- 整欄只往上走（每段至少上移 40px），不會往下跳。
- 第一段靠近作者標頭，之後固定在閱讀線（主要區中間偏下）。
- 跳過的句子用 `…` 表示（顯示、不念）。
- 中文翻譯：以「當句」為單位顯示在下方（只有英中句數對得上的貼文才有）。
- 不顯示手機狀態列、按鈕、導覽列。

## 6. 字幕、吉祥物、動畫

**字幕**（`Subtitle`）：只有「有說、但畫面上還沒有」的字才用字幕。沒有深色底框，直接用墨色字。中文以詞為單位高亮與換行（不會把「意思」拆在兩行）。

| 變體 | 用在 |
|---|---|
| `guide` | Hook 的中文引導（置中） |
| `translation` | 串流中當句的中文（置中、灰色） |
| `mascot` | 吉祥物的話：測驗題目、結語（吉祥物右側） |

**吉祥物**（`Mascot`）：固定在左下，不移動；只在有任務時出現，**Hook 與一般串流閱讀不出現**。
- 出現時機：最後一張字卡的後半段起；若最後一張字卡之後貼文還在念，就等貼文念完（回顧開始）才出現。之後留到結尾。
- 說話時嘴巴開合，身體隨（平滑後的）音量輕輕點頭；測驗倒數時是 `think` 姿勢。
- 目前只有一張角色素材（`icon.svg`），表情由程式繪製。

**動畫**（`motion.js`）：

| 名稱 | 值 | 用在 |
|---|---|---|
| `fast` / `base` / `slow` | 0.18 / 0.3 / 0.5 s | 小提示 / 一般進場 / Hook 螢光筆 |
| `fade` | 0.22 s | 場景間淡入淡出 |
| `lift` | 0.4 s | 單字離開句子、落到字卡 |
| `settle` | 0.35 s | 單字回到句子原位 |
| `dim` | 0.3 s | 貼文退到背景 |
| `scroll` | 0.5 s | 串流上移到下一段 |

動畫只做這幾件事：整欄輕輕上移、螢光筆掃過、單字抽出／飛回、字卡逐層出現、測驗答案填入。沒有彈跳、旋轉、花俏轉場。每一格都由 `renderFrame(t)` 依時間計算，所以輸出時間一致、可重現。

## 7. 測驗（`QuizScene`）

| 類型 | 畫面 | 條件 |
|---|---|---|
| `context`（新，`init` 預設） | 貼文裡含主要單字的那一段，單字挖空；三個**英文**選項。公布答案時空格被黃色填上，句子恢復完整。 | 單字以原形出現在句中（變形字會洩漏答案，改用 `meaning`）。片語單字也用 `meaning`。 |
| `meaning`（舊格式） | 單字大字＋三個中文意思 | 沒有 `quiz.type` 的舊 JSON 自動用這個 |

思考時間約 1.5 秒；只有一條細的進度條（沒有倒數數字）；吉祥物用 `think` 姿勢。

## 8. 結尾與 CTA

結尾不是獨立的 logo 頁：✓ 單字（學習順序）＋（有 `outro.teaserZh` 時）下一篇預告＋吉祥物說一句。標頭的系列標籤從頭到尾都在，那就是品牌。

**一集只有一個行動**（`cta.type`）：
- `comment`（預設）：吉祥物在測驗時請觀眾留言答案；結尾不再放任何行動。
- `link`：測驗不問留言；結尾顯示網址（`series.json` 的 `url`）和 `cta.text`。

## 9. 每集資料（`scripts/video/episodes/<id>.json`）

`init` 會填好全部欄位；你只需要修改文案。舊格式的 JSON 不用改就能渲染。

| 欄位 | 說明 |
|---|---|
| `id`, `episode` | 檔名與 EP 編號（`episode` 可為 `null`，標頭就不顯示 EP） |
| `author` | 發文角色：`name`、`handle`、`avatar`（emoji）、`color`、`topic` |
| `thread.sentences` | 整篇貼文逐句拆開：`en`（重點字用 `[[word]]` 標記，詞組用 `[[a_b_c\|shown form]]`）與 `zh`（對不上時為 `null`） |
| `thread.show` | 要顯示哪幾句，例如 `[0, 2]`；不連續時中間顯示「…」 |
| `thread.source` | 來源標示（小字）。本專案的串文是 App 自己的角色原創內容；若用第三方平台的真實貼文，請填來源並確認使用權。 |
| `main` | 主要單字（Hook 與測驗用） |
| `teach` | 要教的字，`teach[0]` 必須是 `main`。**每個字都必須出現在 `thread.show` 的句子裡**。 |
| `words.<key>` | `pos`、`zh`（可用全形括號寫補充）、`level`（1–3）、`ex`、`exZh`、`kk`；**新增（可選）**：`ctx`（字卡上的短 context）、`ctxZh` |
| `hook.text` | 開場那句英文（截取子句時前面加 `… `）；`hook.guideZh`：中文引導。`init` 預設用該句的中文（≤ 12 字），否則用「這句你看得懂嗎？」。手寫一句更有內容感的更好，例如「90% 預算拿去買紙箱？」。 |
| `quiz` | `type`（`context` 或 `meaning`）、`options`（3 個）、`answer`（0/1/2）、`promptZh`；`context` 另有 `sentence`（用 `____` 表示空格） |
| `cta` | `type`：`comment` 或 `link`；`text` |
| `outro` | `closingZh`、`teaserZh`（下一篇預告；`null` 時吉祥物說「明天見！」） |

## 10. 新增一集

1. `node scripts/make-video.mjs init <串文 id> --ep <編號>`（可加 `--main <單字>`）。
   - 串文 id：TOEFL 是 `p1`…`p468`；其他單字表是 `elem-01`、`hs-01`、`toeic-01`、`ielts-01`…
2. 打開 JSON，檢查／修改：`hook.text` 與 `hook.guideZh`、`thread.show`、`words`（中文、`ctx`）、`quiz`（干擾項是否合理）、`outro.teaserZh`。
3. `--beats` 看節奏、`--audit` 看版面、`--phone --stills 1,8,14` 看手機大小。
4. （可選）旁白：
   ```
   pip install edge-tts
   python3 scripts/make-voice.py videos/<id>.plan.json videos/<id>-voice
   node scripts/make-video.mjs scripts/video/episodes/<id>.json --voice videos/<id>-voice
   ```
   有旁白時，字幕、嘴巴與時間軸都改用真實音檔的長度與音量。
5. 輸出：`node scripts/make-video.mjs scripts/video/episodes/<id>.json`。

需要 Playwright（`npm i -D playwright`，或設 `PLAYWRIGHT_MODULE`）、`ffmpeg`／`ffprobe`，以及連網載入 Google Fonts。

## 11. 檔案

```
scripts/video/
  tokens.css  styles.css  layout.js  motion.js       設計變數／樣式／版面區域／動畫參數
  core.js  speech.js  text-zh.js                     工具（文字自動縮放）／說話音量／中文括號拆分
  components/
    IntroHook  ThreadScene  WordHandoff  VocabularyCard
    Recap  QuizScene  Ending  Subtitle  Mascot  KaraokeText
  VideoTemplate.js  scene.html                       組合／逐格渲染頁（含 audit）
  plan.mjs  episode.mjs  text.mjs                    JSON → 時間軸／草稿與驗證／斷句、chunk、context
  series.json  episodes/                             系列名稱與標語／每集 JSON
scripts/make-video.mjs  scripts/make-voice.py        指令入口／旁白
```

## 12. 品質檢查

`--audit` 每 0.2 秒檢查並回報：文字超出安全區（x 84–948、y 220–1560）、文字超出它的框、字級低於下限、元素重疊。回報「no problems found」才算過。
另外請人工確認：
- 0.5 秒內知道該看哪一行；畫面上只有一個主要焦點。
- `--phone` 的 360×640 畫面不用放大就看得清楚。
- 重點字在貼文、字卡、測驗是同一個字、同一個意思；所有教的字都真的在貼文出現過（指令會驗證）。
- 學完一個字會回到同一篇貼文，不是跳到下一頁。
- 英文與中文意思正確；`init` 自動產生的 context 與測驗干擾項要看過；聽一遍旁白。

### 已測試的案例

用最終版程式實測（`--audit` 全部通過；沒有旁白時長度用估算語速）：

| 串文 | 測試重點 | 長度 |
|---|---|---|
| `p2` | 標準：2 個字、contextual quiz | 29.2 秒 |
| `p2`（只教 1 個字） | 一個字就教一個 | 25.2 秒 |
| `p2`（舊格式 JSON） | 沒有任何新欄位，中文意思題 | 31.3 秒 |
| `p49` | 37 字的單一句子、中英混合 | 28.8 秒 |
| `ielts-087` | 80 字貼文、沒有 KK 音標 | 29.6 秒 |
| `elem-01` | 國小國中單字表 | 31.6 秒 |
| `toeic-079` | 23 字元的片語、長例句 | 35.9 秒 |
| `p348` | 一篇 5 個單字（教 3 個） | 34.9 秒 |
| `p462` | 30 字中文解釋、3 個字、長句 | 40.2 秒（強烈警告：建議拆集） |

## 13. 尚未完成與限制

- **旁白尚未用真人聲音驗證**：`make-voice.py` 需要連網（edge-tts），本環境連不到，只用合成音檔驗證過「音檔長度 → 時間軸 → 音軌」這條路。中文 TTS 念英文單字的自然度需要你聽。
- **沒有背景音樂與音效。**
- **長度是估算**：沒有旁白時用固定語速估算（接近正常 TTS 的速度，略保守）；多字、長句的串文會超過 32 秒。
- **非 main 字卡的 context 不念**：這是為了壓在時間內的取捨。若你想每個 context 都念，把 `plan.mjs` 裡 `line("host", "en", ctxTokens, …, { silent: !isMain })` 的 `silent` 改成 `false`（每張字卡約多 1–2 秒）。
- **contextual quiz 的干擾項**是從單字表依詞性與等級自動挑的，可能出現近義字；變形字與片語單字不支援，會退回中文意思題。
- **中文翻譯字幕**只在英中句數對得上時顯示（約 85% 的貼文）；其餘要在 JSON 手動補 `zh`。
- **`init` 的鉤子引導是草稿**：預設用該句的中文（太長就用通用句），手寫更好。
- **吉祥物只有一張素材。** 表情由程式繪製，沒有哭、笑、驚訝等多種表情。
- **字型需要連網。** 離線時退回系統字型，版面不會壞，但字會變。
- **回顧與結尾沒有旁白**（回顧靜音；結尾只有吉祥物一句）。

---

## Update: feed model (current)

The video is one tall **feed column** that a camera scrolls through (`scripts/video/Feed.js`). Every part is a feed item
(`components/FeedItems.js`): `hook → post → word card → post (continued) → word card → recap → quiz (dark) → ending (+ next-post teaser)`.
Nothing cross-fades in the middle of the screen: items slide up (swipe 0.55 s), only the viewport's top/bottom edges fade (CSS mask),
and the next item's top edge always peeks in at the bottom.

**Colour states** (`tokens.css`): feed = warm paper `#FFF8EC`; vocabulary card = white with a muted blue-gray (`--c-learn`) used only for
EXAMPLE / FROM THIS POST / POS / pronunciation; quiz = dark `#20242C` with the correct answer in yellow `#FFD66B`. Yellow stays the vocabulary highlight.

**Card content**: word, POS + pronunciation, zh meaning, EXAMPLE (full sentence, spoken, karaoke) + example zh, FROM THIS POST (short phrase from the post, word marked).
The white frame grows as each part is revealed.

**Alignment**: feed/card left-aligned; quiz and ending centered.

**Episode JSON additions**: `hook.beats: [{ en, size: xl|l|m|s, zh? }]` (size `s` = display-only, not spoken; legacy `hook.text` still works),
`words.<k>.ex / exZh / ctx` (`ctx` = FROM THIS POST phrase; derived from the post when omitted), `quiz.type: "context"` with `sentence` containing `____`.

**Audit** (`--audit`): skipped while the camera moves; judges only the focused item (+ mascot/subtitle); flags content in the bottom fade zone.
Set `SPEC_DUMP=<file>` to write the full plan (with tokens) for debugging.

### Feed revision 2
- One shared track with a constant gap (`Feed.js` GAP): the tail of the previous item and the head of the next are visible at rest and during every swipe; the focused item is full strength, neighbours are dimmed. `far: true` (recap, quiz) keeps the dark quiz alone on screen.
- Only the word being learned is yellow (card word, the word in the example, FROM THIS POST, post text, recap, quiz answer); the word being spoken uses a neutral tint (`--c-cur`).
- Card hierarchy: word · meaning · EXAMPLE · example zh · small POS/pronunciation · FROM THIS POST. No level badge.
- Hook: `hook.beats[]` supports `big` (giant first token, revealed alone), `caps`, `emoji`.
- `recap: ["I decided to [[allocate]] …"]` (optional hand-written lines); `outro.next: { name, avatar, color, en, zh? }` is the NEXT POST teaser shown at the end of the ending item; the video is cut while it is visible.
- Header (brand + EP) is full strength only until the first scroll, then shrinks and fades; EP disappears.

### p2 V2 review (episode-specific)

The p2 V2 experiment uses `episodes/p2-v2.json` and `renderProfile: p2-v2`. Its CSS, full-first-frame hook, progressive card frame and pacing are scoped to that profile. Other episode defaults are unchanged. See `docs/p2-v2/REVIEW.md` for the rationale and outputs. Do not apply this experiment to other episodes without a separate review.
