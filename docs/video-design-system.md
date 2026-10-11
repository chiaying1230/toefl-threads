# toEfu 單字情境短影音：設計規範與製作說明

一支影片 = 一篇串文裡的一個情境 + 一個主要單字（外加同篇其他單字的小卡）。
外觀（版面、字型、顏色、字幕、吉祥物、動畫）全部集中在 `scripts/video/`，每一集只需要一份 JSON。

```
node scripts/make-video.mjs init p2 --ep 1                       # 從 App 資料產生草稿 scripts/video/episodes/p2.json
node scripts/make-video.mjs scripts/video/episodes/p2.json       # 輸出 videos/p2.mp4（1080×1920）
node scripts/make-video.mjs scripts/video/episodes/p2.json --preview      # 半尺寸、15fps 的快速預覽
node scripts/make-video.mjs scripts/video/episodes/p2.json --stills 1,8,14   # 只輸出這幾秒的 PNG，檢查版面
```

## 1. 影片結構

| 段落 | 元件 | 內容 | 預設時長 |
|---|---|---|---|
| A 開場 | `IntroHook` | 貼文裡最有反差的一句英文（大字、重點字黃色螢光筆掃入）＋一句中文引導字幕。第一格就是完整畫面，沒有淡入、沒有 App 首頁、沒有 logo。 | 約 3 秒 |
| B 情境 | `ThreadScene` | 只留下理解情境需要的句子（用 … 省略中間），作者逐字念出，下方出現當句中文。緩慢推近，不停在靜態畫面。最後鏡頭推向主要單字。 | 8–11 秒 |
| 轉場 | （`ThreadScene` 尾端） | 卡片外框與其他文字淡掉，主要單字浮在紙面上，飛進單字卡的單字位置。同一個動作，不是跳到另一個系統。 | 0.9 秒 |
| C 教學 | `VocabularyCard` | 主要單字（衬線大字）→ 詞性／分級 → 中文意思 → 例句（逐字亮）→ 例句中文。 | 約 7 秒 |
| C′ 小卡 | `AlsoWords` | 同篇其他單字：一行一個（單字・中文）。只出現在情境裡看得到的字。 | 每字約 2.5 秒；沒有就省略 |
| D 互動 | `QuizScene` | 一題三選一（吉祥物口頭提問），倒數思考時間，再公布答案。 | 約 9 秒 |
| 結尾 | `Outro` | wordmark ＋ 系列標語，吉祥物說結語。 | 約 2.5 秒 |

整體約 30–36 秒，依內容而定。超過 40 秒時指令會提醒你縮短 `thread.show` 或少教幾個字。

**一集只有一個行動**（`cta.type`）：
- `comment`（預設）：吉祥物在測驗時請觀眾留言答案；結尾不再放任何行動。
- `link`：測驗不問留言；結尾顯示網址（`series.json` 的 `url`）和 `cta.text`。
平台不同時請改這個欄位，不要假設每個平台都能放連結。

## 2. 版面（畫布 1080 × 1920）

來源：`scripts/video/layout.js`。所有元件都從這些數字定位。

```
y    0 – 200   平台頂部介面（帳號、搜尋）：留空
y  196 – 252   標頭：系列名稱（左）＋ EP 編號（右）
y  330 – 1240  主要區：貼文卡、單字卡、測驗
y 1300 – 1560  底部區：吉祥物（左，240px）＋ 字幕（吉祥物右側；沒有吉祥物時置中）
y 1560 – 1920  平台說明文字與按鈕：留空
x  > 948       多數平台的按讚／留言／分享按鈕：不放文字
左右邊界 84px（右側 132px）
```

## 3. 設計變數

來源：`scripts/video/tokens.css`。改這裡，所有集數一起變。

| 用途 | 變數 | 值 |
|---|---|---|
| 背景（暖白紙色） | `--c-bg` | `#FFF8EC` |
| 卡片底 | `--c-surface` | `#FFFFFF` |
| 主要文字 | `--c-text` | `#231F1C` |
| 次要文字 | `--c-text-2` | `#7B7067` |
| 還沒念到的字、提示 | `--c-text-3` | `#B8AB9C` |
| 重點色（沿用 App 的豆腐圖示黃） | `--c-accent` | `#FFD66B` |
| 目前念到的一般字 | `--c-accent-soft` | `#FFEDB5` |
| 邊框 | `--c-border` | `#EADFCB` |

只有一個強調色：**黃色只用在重點字、目前念到的字、正確答案**。其他一律是墨色與紙色，不用漸層、發光、厚重陰影。

字型（Google Fonts，離線時退回系統字型）：
- 單字本身：DM Serif Display（`--font-heading`）
- 英文內文、UI：DM Sans（`--font-body`）
- 中文：Noto Sans TC（`--font-zh`）

字級（畫布 px）：

| 元素 | 大小 | 字重 | 備註 |
|---|---|---|---|
| 開場英文句 | 108 → 60 自動縮放 | 800 | 行高 1.16，最多 650px 高 |
| 開場引導／吉祥物字幕 | 48 | 700 | |
| 貼文內文 | 50 → 40 自動縮放 | 500 | 行高 1.46 |
| 主要單字 | 168 → 88，放不下就換兩行 116 → 60 | 400 衬線 | |
| 中文意思 | 76 → 44 | 900 | 最多 2 行；括號補充另起一行 32px |
| 例句 | 46 → 32 | 600 | 最多 3 行 |
| 例句中文 | 38 → 30 | 500 | |
| 中文翻譯字幕 | 40 | 500 | `text-wrap: balance` |
| 測驗選項 | 56 → 38 | 900 | |
| 標頭、標籤 | 28–30 | 700 | |

## 4. 字幕規範（`Subtitle`）

只有「有說、但畫面上還沒有的字」才用字幕。貼文和例句本身就在畫面上逐字亮，不再重複一份。

| 變體 | 用在 | 樣式 |
|---|---|---|
| `guide` | 開場引導句 | 置中、墨色 48px / 700 |
| `translation` | 情境中當句的中文 | 置中、灰色 40px / 500 |
| `mascot` | 吉祥物的話（測驗題目、答案、結語） | 吉祥物右側、靠左、48px / 700 |

- 沒有深色圓角框：背景本來就是紙色，直接用墨色字。
- 逐字（中文以詞為單位）高亮：念到的字黃色底、念過的墨色、未念的灰色。
- 一次只顯示一句，最多 3 行；位置在底部區，不遮住主要區。

## 5. 吉祥物規範（`Mascot`）

- 固定位置：左下，240px，不移動。
- 只在有任務時出現：講解單字（C）、提問（D）、結語。**開場與情境不出現**。
- 說話時嘴巴開合，身體隨（平滑後的）音量輕輕點頭；不抖動、不彈跳。
- 姿勢只有兩種：`talk`（預設）、`think`（測驗倒數時，眼睛看右上、頭微傾）。
- 目前只有一張角色素材（`icon.svg`），表情由程式畫出；沒有假設有其他動畫素材。

## 6. 動畫規範

來源：`scripts/video/motion.js`，所有時間與緩動集中在這裡。

| 名稱 | 值 | 用在 |
|---|---|---|
| `DUR.fast` | 0.18 s | 標籤、小提示 |
| `DUR.base` | 0.30 s | 大多數進場（淡入＋上移 22px） |
| `DUR.slow` | 0.50 s | 開場螢光筆掃入 |
| `DUR.fade` | 0.22 s | 場景之間的淡入淡出 |
| `DUR.handoffZoom` / `handoffMove` | 0.45 s / 0.45 s | 貼文 → 單字卡的轉場 |
| 緩動 | `ease.out`（三次方）、`ease.inOut` | |

只有三種轉場：**直接出現**（開場）、**淡入淡出**（場景之間）、**單字飛入**（貼文 → 單字卡）。
每一格都由 `renderFrame(t)` 依時間計算，不依賴即時播放，所以輸出時間一致、可重現。

## 7. 元件

```
scripts/video/
  tokens.css  styles.css        設計變數／元件樣式
  layout.js   motion.js         版面區域／動畫參數
  core.js     speech.js         工具（文字自動縮放）／說話音量（嘴巴用）
  components/
    IntroHook.js  ThreadScene.js  VocabularyCard.js  AlsoWords.js
    QuizScene.js  Outro.js  Subtitle.js  Mascot.js  KaraokeText.js
  VideoTemplate.js              把元件依序組起來
  scene.html                    逐格渲染用的頁面
  plan.mjs                      JSON → 時間軸（所有節奏數字在 PACE）
  episode.mjs  text.mjs         從 App 資料產生草稿、驗證、斷句與分詞
  series.json                   系列名稱、標語、網址
  episodes/                     每集一份 JSON
scripts/make-video.mjs          指令入口（渲染、合成音軌）
scripts/make-voice.py           用 edge-tts 產生旁白 mp3
```

## 8. 每集資料（`scripts/video/episodes/<id>.json`）

`init` 會替你填好全部欄位；你只需要修改文案。

| 欄位 | 說明 |
|---|---|
| `id`, `episode` | 檔名與 EP 編號（`episode` 可為 `null`，標頭就不顯示 EP） |
| `author` | 發文角色：`name`、`handle`、`avatar`（emoji）、`color`、`topic` |
| `thread.sentences` | 整篇貼文逐句拆開：`en`（重點字用 `[[word]]` 標記，詞組用 `[[a_b_c\|shown form]]`）與 `zh`（對不上時為 `null`，不顯示中文字幕） |
| `thread.show` | 要顯示哪幾句，例如 `[0, 2]`。不連續時中間自動顯示「…」。 |
| `thread.source` | 來源標示（會以小字顯示在卡片底部）。本專案的串文是 App 自己的角色原創內容；如果改用第三方平台的真實貼文，請在這裡填來源並確認使用權。 |
| `main` | 主要單字（必須在 `words` 裡） |
| `teach` | 要教的字，`teach[0]` 必須是 `main`；其餘會做成小卡。**每個字都必須出現在 `thread.show` 的句子裡**，否則指令會報錯。 |
| `words.<key>` | `pos`、`zh`（可用全形括號寫補充說明）、`level`（1–3）、`ex`、`exZh`、`kk`（沒有就不顯示） |
| `hook.text` | 開場的那一句英文（可截取子句；截取時前面加 `… `）。要包含 `[[main]]`。 |
| `hook.guideZh` | 開場的中文引導，預設「這句英文你看得懂嗎？」 |
| `quiz` | `options`（3 個中文選項）、`answer`（0/1/2）、`promptZh`（`null` 用預設）。預設優先用 App 現有題庫（703 題）。 |
| `cta` | `type`：`comment` 或 `link`；`text`：行動文字 |
| `outro` | `closingZh`、`teaserZh`（`null` 時說「明天見！」；`link` 時說 `cta.text`） |

## 9. 新增一集（步驟）

1. `node scripts/make-video.mjs init <串文 id> --ep <編號>`，可加 `--main <單字>` 指定主要單字。
   - 串文 id：TOEFL 是 `p1`…`p468`；其他單字表是 `elem-01`、`hs-01`、`toeic-01`、`ielts-01`…
2. 打開 `scripts/video/episodes/<id>.json`，檢查／修改：
   - `hook.text`：選最有反差的一句。
   - `thread.show`：想要縮短就少放一句。
   - `words`：中文意思與例句。
   - `quiz`：三個選項是否合理、答案是否正確。
3. 預覽：`--preview`，或 `--stills 1,8,14` 看幾格。
4. （可選）旁白：
   ```
   pip install edge-tts
   python3 scripts/make-voice.py videos/<id>.plan.json videos/<id>-voice
   node scripts/make-video.mjs scripts/video/episodes/<id>.json --voice videos/<id>-voice
   ```
   有旁白時，字幕、嘴巴與時間軸都改用真實音檔的長度與音量。
5. 完整輸出：`node scripts/make-video.mjs scripts/video/episodes/<id>.json`。

需要 Playwright（`npm i -D playwright`，或設 `PLAYWRIGHT_MODULE`）、`ffmpeg`／`ffprobe`，以及連網載入 Google Fonts。

## 10. 品質檢查清單

- 開場第一格就是完整、可讀的畫面。
- 重點字在貼文、單字卡、測驗裡是同一個字、同一個意思。
- 所有「教的字」都在畫面上出現過（指令會驗證）。
- 字幕不遮住單字卡；文字不被裁切、不重疊。
- 重要內容都在安全區內（見第 2 節）。
- 輸出為 1080×1920、`yuv420p`、30 fps。
- 英文與中文意思正確；例句符合單字用法（尤其是 `init` 自動產生的測驗干擾項）。
- 聽一遍旁白（中文 TTS 念英文單字的發音要確認）。

## 11. 已測試的極端情況

用最終版程式實測版面（靜態畫面檢查開場、情境、單字卡、測驗；`p2` 另渲染完整影片）：

| 串文 | 測試重點 | 長度 |
|---|---|---|
| `toeic-079` | 23 字元的片語 *a game of cat and mouse*、3 行例句 | 42.2 秒（超過 40 秒，指令會提醒） |
| `p462` | 30 字的中文解釋（含補充說明）、3 個單字、無中文翻譯 | 42.4 秒（同上） |
| `p49` | 37 字的單一句子、中英混合貼文、貼文用換段代替句號 | 33.9 秒 |
| `p348` | 一篇 5 個單字（教 3 個，其餘不在情境句裡） | 36.8 秒 |
| `ielts-087` | 80 字貼文、沒有 KK 音標 | 35.1 秒 |
| `p2` | 標準情況（2 個單字） | 34.4 秒 |

單字多或例句長的串文會超過 35 秒；想縮短就減少 `thread.show` 或 `teach`。

## 12. 尚未完成與限制

- **旁白尚未用真人聲音驗證**：`make-voice.py` 需要連網（edge-tts），本環境連不到，只用合成音檔驗證過「音檔長度 → 時間軸 → 音軌」這條路。
- **沒有背景音樂與音效。**
- **測驗題型只有「選中文意思」。** 沒有填空、聽音等題型。
- **中文翻譯字幕**只在英中句數對得上時顯示（約 85% 的貼文）；其餘要在 JSON 手動補 `zh`。
- **`init` 的鉤子與測驗是自動草稿**：鉤子取主要單字所在的句子，測驗干擾項若不在題庫就依詞性與等級挑選，可能出現近義字；發布前請人工看過。
- **吉祥物只有一張素材。** 表情由程式繪製，沒有哭、笑、驚訝等多種表情。
- **字型需要連網。** 離線時會退回系統字型，版面不會壞，但字會變。
- **渲染速度**：1080×1920、30fps 約 1–2 分鐘一支（視機器而定）。
