# /quiz 測驗頁資料庫規格(待實作,先存檔)

為 /quiz 測驗頁接上資料庫,排名要即時更新。沿用現有的 Firebase 專案,不新增服務。

## 1. 成績(Firestore: `quizRuns`,每完成一次測驗一筆,文件 ID 由前端產生)

欄位:`date`(使用者當地日期)、`createdAt`(伺服器時間)、`device`(隨機匿名代號,存 localStorage)、
`attempt_no`、`is_best`、`self_estimate`、`challenge{rival_vocab, rival_sec, won}`、
`vocab`、`theta`、`correct`、`total_ms`、
`answers[15]{n, word, level, result(correct|wrong|skip|timeout), picked, options[4](該題畫面上四個選項,依顯示順序), ms, hid}`、`source`、`qv`。
`hid`(布林):作答這題期間頁面曾被切到背景(`visibilitychange`),為 true 時這題的 `ms` 不可信。
`qv`(字串,最長 20):題庫版本,`js/data/quiz-questions.js` 的 `window.QUIZ_QV`,由 `build-quiz-data.mjs` 對玩家看得到的題目內容(字、等級、角色、題幹、詞性、正解、干擾項,不含 `dtypes`)取 SHA-256 前 8 碼。分析時用 `qv` 判斷是哪個題庫版本。舊文件沒有 `hid`、`qv`,所有新欄位都可缺省。

`attempt_no` 是這個裝置累計的第幾次挑戰,`is_best` 與這個裝置的歷史最佳比較;兩者存在 localStorage(`quizPlays`、`quizBest`),讀寫失敗(隱私模式、被清除)時退回只存在記憶體,行為同舊版。前 3 題內放棄不算一次。
**舊資料不修補**:修正前寫入的 quizRuns(`qv` 為 5145ab15 以前,以及 5145ab15 但在這次修正部署之前寫入的),`attempt_no` 只代表同一次開啟頁面內的次數,`is_best` 也只和同一次開啟頁面內的成績比較,所以同一個 device 會有多筆 `attempt_no` 為 1。題庫沒變時 `qv` 不會變,要區分新舊資料請用 `createdAt` 的部署時間點。
`quizStats/words` 只計 `attempt_no` 為 1 的成績:修正後等於每個 device 的第一次挑戰;修正前的資料則包含每次開啟頁面的第一次。
不存任何個人資料。測驗頁必須初始化 App Check(與主站相同的金鑰)。

## 2. 即時統計(Firestore: `quizStats/all` 與 `quizStats/day-YYYY-MM-DD`)

每一次完成的挑戰都計入排名(包含同一個人的舊成績)。

每份文件用扁平欄位記錄分布:欄位名稱由「單字量每 100 字一格」加「耗時區間」組成,
值是筆數;另有 `n`(總筆數)與 `last`(最近一筆成績的文件 ID)。

前端完成測驗時的順序:
a. 先讀 all 與當日文件,算出百分比、名次、今日名次(把自己這一筆加上去)。
b. 用同一個 batch 寫入:建立 quizRuns 文件、all 對應欄位加 1 且 n 加 1、當日文件同樣加 1。

寫入失敗不影響成績顯示;讀取失敗時隱藏排名區塊。
總筆數未滿 200 時顯示「這是第 N 筆挑戰成績,目前排第 M 名」。
分片數量做成常數(先設 1),之後流量大時可改成多份文件分散寫入。

## 3. 安全規則(加在 `firestore.rules`,並更新 `setup.html` 的複製內容)

**quizRuns**:任何人可 create;不可 read / update / delete。
驗證:欄位只能是上列名稱;vocab 為 0–11000 的整數;total_ms 介於 5000 與 200000;
answers 長度為 15(規則無法逐項檢查,`hid` 不驗證);qv 若存在為長度 ≤20 的字串;createdAt 等於 request.time。

**quizNotes**:任何人可 create;不可 read / update / delete。文件 ID 必須是 `{run}_{word}`(同一次測驗同一個字只能有一筆)。
欄位白名單 `run, device, word, picked, result, ms, reason, other_word, createdAt`;reason 只能是 sure、torn、lookalike、affix、forgot、guess、misclick;
`other_word` 只有 reason 為 lookalike 時才能存在(1–30 字元);result 為 correct 或 wrong;`run` 指向的 quizRuns 必須已存在,且其 device 與 note 的 device 相同;
所有字串有長度上限;createdAt 等於 request.time。規則版本 rules-v9。

**quizStats/all、quizStats/day-\***:任何人可 read。
update(以及當日文件的第一次 create)只在以下條件全部成立時允許:
- 只改動三個欄位:一個分布欄位、n、last。
- 分布欄位與 n 都剛好比原值多 1。
- last 指向的 quizRuns 文件在這次 batch 之前不存在、之後存在(用 exists / getAfter 檢查)。
- 被加 1 的欄位名稱,必須等於由那筆成績的 vocab 與 total_ms 推算出的名稱。
- 當日文件的日期與 request.time 相差不超過一天。

quizStats 的其他文件:只可 read。

請為規則寫模擬器測試,至少涵蓋:正常寫入、只加統計不寫成績、一次加 2、改別的欄位。

## 4. 每日校正排程(獨立 workflow,不併入通知的 workflow,每天台灣時間清晨執行一次)

`scripts/quiz/reconcile.js`,使用管理員權限:
- 只讀上次游標之後的新 quizRuns,累加到已驗證的基準(存在 `quizStats/state`)。
- 同一 device 每天最多計入 10 筆,超過的從分布中扣除。
- 用交易把 all 與前一天的當日文件校正為正確值,不可蓋掉校正期間新增的成績。
- 更新 `quizStats/words`:每個單字的出現次數與答對次數(只計 attempt_no 為 1 的成績)。
  每個單字另有 `o`:該題每個錯誤選項被顯示的次數 `s` 與被選的次數 `p`(干擾項誘答力);只計題庫裡該字已知的選項。
- 作答方式回饋(`quizNotes`,見 §7):以獨立的游標(`state.noteCursorAt/noteCursorId`)讀取,同一 device 每天最多計 10 筆(日期用 note 的伺服器日期)。
  每個單字另有 `r`:各 reason 的次數,依 result 分開,欄位名 `<reason>_<result>`,例如 `r.sure_wrong`、`r.sure_correct`。
  不認識的字、reason、result 一律不計。**注意**:問卷偏重答錯的題目,且只問部分裝置,所以 `r` 不是全體作答的比例,要和 `n`、`c` 一起看。

## 5. 漏斗事件(Firebase Analytics)

`quiz_view`、`quiz_start`、`quiz_abandon(at_question)`、`quiz_complete(vocab)`、`quiz_note_shown`、`quiz_note_answer(reason)`、`quiz_note_skip`、
`share_threads`、`share_other`、`saw_three_posts`、`login_click`。

## 6. 隱私權頁面

加一句:測驗會匿名記錄作答結果,用於排名與改善題目。測驗可能會詢問作答方式,同樣匿名記錄。

## 7. 作答方式回饋(`quizNotes`)與干擾項類型

目的:分析中文母語者為什麼選錯。

- 時機:15 題做完、顯示成績與正確答案之前。`quizRuns` 在 `finish()` 當下就開始寫入(不等問卷);`quizNotes` 在 run 寫入成功之後才寫,失敗不影響畫面。
- 對象:`NOTE_RATE`(0.5)由 device 前 8 碼決定,同一裝置固定出現或固定不出現。
- 挑題:result 為 wrong 的題目隨機挑最多 2 題;不足 2 題時,補 1 題 result 為 correct、ms 大於該次中位數(所有實際選了選項的題目)的 1.5 倍、`hid` 不是 true 且 ms 最長的題目。都沒有就不出現。依題號順序顯示。
- 畫面:單字、例句、他選的選項。不顯示正確答案,也不顯示對錯;答對、答錯的題目畫面和選項完全一樣。
- 問題「剛剛這題,你是怎麼選的?」:sure(我會,很確定)、torn(在兩個答案之間猶豫)、lookalike(想到另一個很像的字,可填 `other_word`,最多 30 字元)、
  affix(看字的一部分猜的)、forgot(有印象,但想不起來)、guess(用猜的);較小的按鈕:misclick(按錯了)、略過(不寫入)。
- 文件:`{ run, device, word, picked, result, ms, reason, other_word?, createdAt }`,ID 為 `{run}_{word}`。
- 題庫的干擾項類型 `dtypes`(`data-src/quiz_questions_703.json`,每題長度 3,對應 distractors):sem、l1、form、sound、morph、ctx。
  `js/data/quiz-questions.js` 每列最後多一欄 `dtypes`(前九欄位置不變);`scripts/check-data.js` 檢查長度與合法值。
  `node scripts/quiz-dtype-candidates.mjs` 產生 `data-src/dtype-candidates.csv`(疑似 l1、morph、ctx,含信心高/低與理由),人工確認後再改題庫,不會自動寫回。
