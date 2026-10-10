# /quiz 測驗頁資料庫規格(待實作,先存檔)

為 /quiz 測驗頁接上資料庫,排名要即時更新。沿用現有的 Firebase 專案,不新增服務。

## 1. 成績(Firestore: `quizRuns`,每完成一次測驗一筆,文件 ID 由前端產生)

欄位:`date`(使用者當地日期)、`createdAt`(伺服器時間)、`device`(隨機匿名代號,存 localStorage)、
`attempt_no`、`is_best`、`self_estimate`、`challenge{rival_vocab, rival_sec, won}`、
`vocab`、`theta`、`correct`、`total_ms`、
`answers[15]{n, word, level, result(correct|wrong|skip|timeout), picked, ms}`、`source`。
不存任何個人資料。測驗頁必須初始化 App Check(與主站相同的金鑰)。

## 2. 即時統計(Firestore: `quizStats/all` 與 `quizStats/day-YYYY-MM-DD`)

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
驗證:欄位只能是上列名稱;vocab 為 0–13000 的整數;total_ms 介於 5000 與 200000;
answers 長度為 15;createdAt 等於 request.time。

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

## 5. 漏斗事件(Firebase Analytics)

`quiz_view`、`quiz_start`、`quiz_abandon(at_question)`、`quiz_complete(vocab)`、
`share_threads`、`share_other`、`saw_three_posts`、`login_click`。

## 6. 隱私權頁面

加一句:測驗會匿名記錄作答結果,用於排名與改善題目。
