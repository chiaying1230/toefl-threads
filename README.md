# Toefl-Tofu 🧈📚

手機優先、介面像 Threads 的托福單字學習 App，吉祥物是一塊豆腐。
20 個虛擬角色（外星實習生、貓咪執行長、1885 年的時空旅人、會噴發的火山、圖書館幽靈……）發了 **200 則**好笑的串文，裡面自然融入 **404 個托福單字**（Easy / Medium / Hard 三級，涵蓋 18 個托福常考題材）。

介面全英文（沉浸式學習），只有單字解釋與翻譯是中文。

## 功能

| | |
|---|---|
| **For you / Following** | For you 依你的程度、喜歡的題材、追蹤的角色排序；滑到底會自動載入，200 則看完會重新洗牌繼續 |
| **首次設定偏好** | 第一次打開會問程度、題材、要追蹤哪些角色；之後可在 Profile → Feed preferences 修改 |
| **點藍色單字** | 詞性、中文、例句與中譯、🔊 發音、「More threads with this word」 |
| **Translate** | 展開整則貼文的中文翻譯 |
| **發文者主頁** | 點頭像或名字 → 看他的 bio、追蹤人數和所有貼文，可 Follow |
| **留言** | 點留言圖示進入貼文，留言後角色會回覆你（留言中的托福單字也可以點） |
| **動態牆小測驗** | 每 7 則出現一張 Quiz 卡（選中文意思／例句填空），優先考你收藏的字 |
| **每日目標＋連續天數** | 收藏新字、測驗答對、閃卡 Got it 各算 1；右上角進度圈與 🔥 天數，Profile 有 7 天長條圖 |
| **搜尋** | 搜尋單字（英文或中文）、角色、#題材、貼文內容 |
| **Review** | 收藏的單字列表＋閃卡 |
| **New** | 自己發串文，附 Word challenge；發文裡的托福單字會自動變成可點的單字 |
| **朗讀** | 每則貼文有 🔊 按鈕，用英文朗讀（自動略過中文），Profile 可調 Normal / Slow / Very slow |
| **間隔複習 (SRS)** | 收藏的字依記憶曲線排程：答對的隔 1→3→7→14→30→60 天再出現，答錯隔天再考；Review 分頁的紅色數字＝今天該複習的字 |
| **每週排行榜** | 依本週練習點數排名，每週一重置；角色們也會一起比賽，登入後可以和其他使用者比 |
| **豆腐徽章** | 14 個成就（收藏字數、連續天數、答題、發文……），在 Profile 查看 |
| **Liked / Saved 分頁** | Profile 下方分成 Threads、Liked（按讚過的串文）、Saved（收藏的串文） |
| **先登入再設定** | 已設定 Firebase 時，第一次打開會先請你用 Google 登入；帳號裡已有偏好就不用再選程度 |

## 資料存在哪裡？兩種模式

1. **本機模式（預設，免設定）**：所有資料存在該手機的瀏覽器裡。每個人各自使用、互相看不到。
2. **雲端模式（設定 Firebase 後）**：用 Google 帳號登入，按讚、收藏、偏好、連續天數都存在帳號裡（換手機也在），而且**所有使用者看得到彼此的發文、留言與真實讚數**。沒登入的訪客仍可瀏覽與收藏單字（存在自己手機），要按讚、發文、留言時會請他登入。

## 設定帳號與共用（Firebase）

Firebase 專案 `toefl-threads` 已經建好，設定值也已經填進 `js/firebase-config.js`。還剩 2 件事要在 Firebase 網站上點：

**設定檢查頁：** <https://chiaying1230.github.io/toefl-threads/setup.html>
這頁會用 ✅／❌ 告訴你哪一步還沒完成，也附有直接前往 Firebase 對應頁面的連結。

1. **開啟 Google 登入**
   - 打開 <https://console.firebase.google.com/project/toefl-threads/authentication/providers>
   - 按 `Get started` → 選 `Google` → 打開 `Enable` → 選你的 Email → `Save`
   - 再到 `Settings` 分頁 → `Authorized domains` → `Add domain` → 輸入 `chiaying1230.github.io` → `Add`
2. **建立資料庫並貼上規則**
   - 打開 <https://console.firebase.google.com/project/toefl-threads/firestore>
   - 按 `Create database` → 位置選 `asia-east1 (Taiwan)` → 選 `Start in production mode` → `Create`
   - 建好後到 `Rules` 分頁，全部刪掉，貼上規則 → 按 `Publish`
   - 規則可以從設定檢查頁的「複製 Firestore 規則」按鈕取得（內容就是本 repo 的 `firestore.rules`）

完成後打開設定檢查頁，看到全部 ✅ 就可以了。

> **更新規則：** 規則偶爾會因為新功能而更新（例如每週排行榜）。如果檢查頁顯示「⑤ 安全規則需要更新」，就用檢查頁上的按鈕複製新規則，貼到 Firestore → Rules → **Publish**。

**為什麼有人每次都要重新登入？** 最常見的原因是從 LINE、Instagram、Facebook 裡直接點開連結。這些 App 內建的瀏覽器常常不保存登入狀態。App 現在會自動偵測：LINE 會自動跳到手機的瀏覽器，其他 App 會顯示提示，請改用 Safari／Chrome 開啟。無痕模式也不會保存登入。

**最後用兩支手機測一次：** 兩支手機分別用不同的 Google 帳號登入（或用一般視窗＋無痕視窗）。A 發文、按讚、留言，B 重新整理後應該看得到。

免費的 Spark 方案不用信用卡，小型使用綽綽有餘。這些設定值本來就是公開的，安全性由 `firestore.rules` 控管。

> 限制：目前沒有檢舉／審核功能，每個人只能刪除自己的內容。

## 檔案結構

```
index.html                 頁面骨架
css/style.css              樣式（自動跟隨深色／淺色模式）
js/data/characters.js      20 個角色、題材清單、角色的留言回覆
js/data/batch-1.js … 5.js  單字與貼文（每批約 40 則）
js/core.js                 文字渲染、單字偵測、排序、測驗、每日目標計算
js/store.js                儲存層（本機 localStorage / Firebase）
js/app.js                  所有畫面與互動
js/firebase-config.js      Firebase 設定（改成 null 就回到本機模式）
setup.html                 Firebase 設定檢查頁
firestore.rules            Firestore 安全規則
scripts/check-data.js      檢查內容有沒有打錯
```

## 新增更多串文或單字

在 `js/data/` 新增 `batch-6.js`（複製 `batch-5.js` 的格式），並在 `index.html` 最下面的 `batch-5.js` 後加一行 `<script src="js/data/batch-6.js"></script>`。

- 單字：`resilient: { pos: "adj.", zh: "有韌性的", level: 2, ex: "英文例句", exZh: "中文翻譯" }`
- 貼文：`{ id: "p201", author: "zorp", topic: "Astronomy", text: "…[[resilient]]…", zh: "中文翻譯" }`
  - 字形不同時寫 `[[resilient|resiliently]]`
  - `author` 要是 `characters.js` 裡的角色，`topic` 要是 `TOPICS` 裡的題材
  - 貼文難度會依單字的 `level` 自動計算

改完在電腦執行 `node scripts/check-data.js`，它會告訴你有沒有拼錯的單字、缺少的翻譯、重複的 id。

## 用 GitHub Pages 免費發佈

1. repo → **Settings → Pages → Build and deployment**
2. Source 選 **Deploy from a branch**，Branch 選要發佈的分支（例如 `main`）、資料夾 `/ (root)` → **Save**
3. 1～2 分鐘後網址是 `https://chiaying1230.github.io/toefl-threads/`
4. 手機加入主畫面：iPhone Safari 分享 →「加入主畫面」；Android Chrome ⋮ →「加到主畫面」

> 免費的 GitHub Pages 需要 repo 是 **Public**。

## 本機預覽

```bash
python3 -m http.server 8000
```
然後打開 http://localhost:8000
