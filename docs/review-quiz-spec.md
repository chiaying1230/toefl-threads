# 複習測驗與 /quiz 入口規格

## 1. /quiz 入口

App 裡有三個入口，都連到 `quiz/?from=<位置>`：

- **首頁**（`from=home`）：在每日一字下方。
  - 還沒測過時（localStorage 沒有 `quizBest`），顯示「How many English words do you know? 15 題・約 3 分鐘」卡片。按 ✕ 後就不再出現（`toefu.quizCardHidden`）。
  - 測過之後改成一行小字「📏 單字量 4,200・再挑戰」。
- **個人頁**（`from=profile`）：統計列多一格「📏 4,200 words」。沒測過時顯示「Test vocabulary size」。
- **複習測驗的結果畫面**（`from=review`）：「想知道總單字量？做完整測驗 →」。

/quiz 和 App 在同一個網域，所以 App 直接讀 /quiz 存的 `quizBest`。`from` 只記在 /quiz 的 `quiz_view` 分析事件（值為 `app_home`、`app_profile`、`app_review`）。`quizRuns.source` 不改，因為它是用來分版本的（見 `quiz-db-spec.md`）。

不放右下角的浮動按鈕，原因有三：
- 底部分頁列中間的「＋」就是發文鍵，再放一顆浮動按鈕容易被誤認成發文鍵。
- 浮動按鈕會擋到串文的回覆列和按讚。
- 大多數人只測一次，常駐的按鈕之後就變成干擾。

## 2. 複習測驗（複習分頁 →「Quiz」）

### 出題
- 題目從今天到期的字出（`dueKeys()`）。沒有到期的字時，可以按「用全部單字出題」。每輪最多 10 題。
- **題庫字**（`window.QUIZ_QUESTIONS`，703 題）：用題庫裡的角色、題幹、正解和三個干擾項，選項順序隨機。題庫檔第一次進入測驗模式時才載入。
- **其他字**：用單字表的例句 `VOCAB[k].ex` 當題幹。干擾項依序從「同詞性、同級」、「同詞性」、「全部」的字裡挑，中文不重複。這類干擾項的類型是 `gen`，不拿來算誘答力。

### 作答
- 每次作答都和閃卡一樣更新間隔複習（`reviewWord`）。答對時 `stats.quiz` 加 1，今日進度（`addActivity`）也加 1。
- 答完立刻顯示對錯、正確答案、例句和發音。

### 「你是怎麼選的？」
- **時機**：按下選項之後、公布答案之前。畫面和 /quiz 一致：只顯示單字、題幹和他選的選項，不顯示正確答案，也不顯示對錯。
- **選項文字**：和 /quiz 完全相同，方便兩邊的資料比較。包括「按錯了」和「略過」，略過不寫入。
- **對象**：用和 /quiz 相同的 `quizDevice` 前 8 碼決定，比例 0.5（`RQ_NOTE_RATE`）。同一台裝置在兩邊的行為一致。
- **頻率**：
  - 答錯的題目：每輪最多問 2 題。
  - 答對、但花的時間超過這一輪前面各題中位數的 1.5 倍（至少要有 3 題可比，頁面沒切到背景）：每輪最多問 1 題。
  - 每台裝置每天最多問 6 次（`toefu.reviewNotesDay`）。
- 和 /quiz 的差別：/quiz 是 15 題做完後才一起挑題問；這裡是每題當下決定要不要問，所以「想很久」只能跟前面已答的題目比。

## 3. 資料（Firestore）

### `reviewRuns`：一輪一筆
欄位：
```
{ device, date, source: "app", qv, correct, answers[1..10], createdAt }
answers[i] = { word, bank, options[4], picked, result, ms, hid, box }
```
- `word` 是單字表的 key，例如 `a_deluge_of`，不是題庫裡的寫法 `a deluge of`。
- `options` 依畫面順序排列，`picked` 是選中的中文。
- `ms` 最多 600000；`hid` 表示作答這題時頁面曾切到背景。
- `box` 是作答**前**的複習階段，0 表示新字或剛答錯過。

**寫入時機**：
- 一輪結束時寫入。
- 中途離開時（切換模式、換分頁、App 切到背景），尚未寫入的作答有 3 題以上才寫入。之後繼續作答的題目，會成為另一筆紀錄。

### `reviewNotes`：每個原因一筆
- 文件 ID 是 `{run}_{word}`。
- 欄位：`run, device, word, picked, result, ms(≤60000), reason, other_word?, box, createdAt`。
- 對應的 `reviewRuns` 寫入成功後才寫。

### 其他規定
- **匿名**：只存 `quizDevice` 隨機代號，不存 uid（有沒有登入都一樣）。沒有設定 Firebase 時不寫入，也不影響畫面。

## 4. 安全規則（`firestore.rules`，規則版本 rules-v10）

- `reviewRuns`：任何人可以新增，但不能讀、改、刪。
  - 欄位有白名單。
  - `answers` 長度 1–10（規則無法逐項檢查）。
  - `correct` 介於 0 到 answers 長度之間。
  - `date` 格式為 `YYYY-MM-DD`，`createdAt` 必須等於 `request.time`。
- `reviewNotes`：任何人可以新增，但不能讀、改、刪。
  - 欄位有白名單，ID 必須是 `{run}_{word}`。
  - reason 只能是那七種；`other_word` 只有 reason 為 lookalike 時才能存在（1–30 字元）。
  - `box` 是 0–20 的整數。
  - `run` 必須指向已存在的 **reviewRuns**（不是 quizRuns），而且 device 相同。
- 測試在 `scripts/quiz/rules.test.mjs`。

## 5. 每日彙總（`scripts/quiz/reconcile.js`）

- 用獨立的游標讀 `reviewRuns`（`state.rvCursor*`）和 `reviewNotes`（`state.rvNoteCursor*`）。同一裝置每天最多計 10 輪、10 筆原因。
- 結果寫到 `quizStats/reviewWords-<首字母>`。依首字母分成多份文件，避免單一文件超過 1 MB。每個字記：
  - `n` / `c`：出現次數、答對次數。
  - `n0` / `c0`：作答時 box 為 0 的出現次數、答對次數。
  - `o`：只有題庫字才有。每個題庫干擾項被顯示的次數 `s` 和被選的次數 `p`。
  - `r`：各原因的次數，欄位名 `<reason>_<result>`。
- 不認識的字（不在任何單字表）、不認識的選項、原因、結果，一律不計。
- 不寫進 `quizStats/words`，/quiz 的統計不受影響。
- 測試在 `scripts/quiz/reconcile.test.mjs`。

## 6. 分析時要注意

- **母體不同**：複習的字是使用者自己存的，而且同一個人會反覆遇到同一個字，和 /quiz 的母體不同，兩邊要分開看。
  - 要比較「第一次見」和「複習第 N 次」，可以看 `n0`/`c0`，或看原始資料的 `box`。
- **原因資料偏向答錯**：問卷偏重答錯的題目，而且只問一半的裝置，所以 `r` 不是全體作答的比例，要和 `n`、`c` 一起看。
- **干擾項類型**：非題庫字的干擾項是隨機挑的（`gen`），只能看作答原因，不能評估誘答力。題庫字的干擾項類型（dtypes），用 `qv` 對照題庫版本。

## 7. 隱私權頁
已經補上一段：複習測驗會匿名記錄每一輪的作答，有時會詢問作答方式。

## 8. 沒做的部分
- 計畫裡的 `review_*` 和 `quiz_entry_click` 分析事件沒有做。隱私權頁寫明「只有 /quiz 頁有使用統計」，在 App 加分析事件需要先改這個說法。
- 目前各入口被點了幾次，可以從 /quiz 的 `quiz_view` 事件的 `from` 看出來。
