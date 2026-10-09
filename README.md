# toEfu 🧈📚

手機優先、社群動態牆形式的英文單字學習 App，吉祥物是一塊豆腐。單字表有國小國中、高中、多益、雅思、托福五種入口（動態牆的串文目前以托福字為主）。
20 個虛擬角色（外星實習生、貓咪執行長、1885 年的時空旅人、會噴發的火山、圖書館幽靈……）發了 **468 則**好笑的串文，裡面自然融入 **1,300 個托福單字**（Soy Milk / Tofu / Natto 三級；難度來自統一的模型評分，見 `scripts/import-scores.py`，涵蓋 18 個托福常考題材）。

介面全英文（沉浸式學習），只有單字解釋與翻譯是中文。

## 功能

| | |
|---|---|
| **For you / Following** | For you 每 10 則約 3 則來自追蹤的角色、3 則來自喜歡的題材、4 則來自其他人，同一個角色不會連續出現；偏好的程度優先。滑到底自動載入，全部看完重新洗牌 |
| **角色互相留言** | 78 則串文底下有其他角色的留言（共 183 則，`js/data/convos.js`），可翻譯、單字可點；動態牆上會顯示「XX and 2 others replied」 |
| **每日一字** | For you 最上方的 Word of the day 卡片（KK、發音、例句、一鍵加入複習），可收合 |
| **介面語言** | 新手設定一律中英雙語；Settings → Interface language 可切換 English／English + 中文（串文內容維持英文） |
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
| **乾淨的個人主頁** | 像社群媒體一樣只有頭像、自我介紹和串文；分頁有 Threads、Replies、Reposts、Liked、Saved、Badges（14 個豆腐徽章） |
| **轉發／引用** | 每則串文的 🔁：**Repost** 直接轉發、**Quote** 加上自己的話引用（原文以小卡片顯示）。轉發會出現在你主頁的 Reposts 分頁，以及追蹤你的人的 Following 動態（「XX reposted」） |
| **Replies 分頁** | 主頁分頁：Threads / Replies / Reposts / Liked / Saved / Badges。Replies 列出你留過的每則言，上面附原串文 |
| **分享** | 每則串文都有分享鍵（紙飛機），手機會跳出 LINE／IG／訊息等分享選單，電腦則複製連結；Profile 的 **Invite friends** 分享整個網站。朋友點開分享的串文會先直接看到那一則，底下有「Join toEfu」和「Get the app」，加入後 iPhone 會接著教他加到主畫面 |
| **檢舉** | 別人的串文右上角 **⋯**、別人的留言旁 **Report** → 選原因。檢舉存在 Firestore `reports`，只有你在 Firebase 主控台看得到 |
| **刪除帳號** | Settings → **Delete my account**：刪除自己的串文、留言、按讚、轉發、收藏、個人資料和 Google 登入（沒登入時是清除這台裝置的資料） |
| **隱私權／條款** | `privacy.html`、`terms.html`；Settings 和登入畫面都有連結 |
| **Settings** | 每日目標、朗讀速度、通知、加到主畫面、動態偏好、追蹤名單都收在主頁的 ⚙️ Settings 裡 |
| **先登入再設定** | 已設定 Firebase 時，第一次打開會先請你用 Google 登入；帳號裡已有偏好就不用再選程度 |
| **編輯個人資料** | 上傳照片（自動裁成正方形並壓縮）或選 emoji、暱稱、帳號、自我介紹、托福目標分數；改完後舊貼文與留言也會跟著更新 |
| **PWA（加到主畫面）** | 可以離線開啟；Android 會出現「Install」按鈕，iPhone 會顯示一步步的「加入主畫面」教學 |
| **推播通知** | 有人回覆你的串文、每天晚上 8 點的按讚摘要、早上 9 點的複習提醒（有字到期才發，可以個別關掉） |

## 資料存在哪裡？兩種模式

1. **本機模式（預設，免設定）**：所有資料存在該手機的瀏覽器裡。每個人各自使用、互相看不到。
2. **雲端模式（設定 Firebase 後）**：用 Google 帳號登入，按讚、收藏、偏好、連續天數都存在帳號裡（換手機也在），而且**所有使用者看得到彼此的發文、留言與真實讚數**。沒登入的訪客仍可瀏覽與收藏單字（存在自己手機），要按讚、發文、留言時會請他登入。

## 設定帳號與共用（Firebase）

Firebase 專案 `toefl-threads` 已經建好，設定值也已經填進 `js/firebase-config.js`。還剩 2 件事要在 Firebase 網站上點：

**設定檢查頁：** <https://toefu.app/setup.html>
這頁會用 ✅／❌ 告訴你哪一步還沒完成，也附有直接前往 Firebase 對應頁面的連結。

1. **開啟 Google 登入**
   - 打開 <https://console.firebase.google.com/project/toefl-threads/authentication/providers>
   - 按 `Get started` → 選 `Google` → 打開 `Enable` → 選你的 Email → `Save`
   - 再到 `Settings` 分頁 → `Authorized domains` → `Add domain` → 輸入 `toefu.app` → `Add`，再加一次 `www.toefu.app`
2. **建立資料庫並貼上規則**
   - 打開 <https://console.firebase.google.com/project/toefl-threads/firestore>
   - 按 `Create database` → 位置選 `asia-east1 (Taiwan)` → 選 `Start in production mode` → `Create`
   - 建好後到 `Rules` 分頁，全部刪掉，貼上規則 → 按 `Publish`
   - 規則可以從設定檢查頁的「複製 Firestore 規則」按鈕取得（內容就是本 repo 的 `firestore.rules`）

完成後打開設定檢查頁，看到全部 ✅ 就可以了。

> **更新規則：** 規則偶爾會因為新功能而更新。如果檢查頁顯示「⑤ 安全規則需要更新」，就用檢查頁上的按鈕複製新規則，貼到 Firestore → Rules → **Publish**。

## 推播通知設定（一次性，約 5 分鐘）

推播由 GitHub Actions 每 30 分鐘執行一次 `scripts/notify/send.js` 來發送，免費、不用架伺服器。

1. **推播金鑰（VAPID）**：Firebase → ⚙️ Project settings → **Cloud Messaging** 分頁 → 最下面 **Web Push certificates** → **Generate key pair** → 把出現的一長串金鑰貼給 Claude（或自己填進 `js/firebase-config.js` 的 `FIREBASE_VAPID_KEY`）。這把金鑰本來就是公開的。
2. **服務帳戶金鑰（這把是秘密，不要貼到聊天室或程式碼裡）**：
   - Firebase → ⚙️ Project settings → **Service accounts** → **Generate new private key** → 會下載一個 `.json` 檔。**不要把這個檔案放進專案資料夾**（`.gitignore` 已經擋下常見的金鑰檔名，但還是放在別處最安全），貼進 GitHub Secret 後就可以刪掉。
   - GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**
   - Name 填 `FIREBASE_SERVICE_ACCOUNT`，Secret 貼上整個 `.json` 檔的內容 → **Add secret**。
3. 到 repo 的 **Actions** 分頁 → 左邊 **Push notifications** → **Run workflow**，跑一次確認是綠色 ✅。
4. 手機打開 App → Profile → ⚙️ Settings → **🔔 Turn on notifications**。iPhone 需要 iOS 16.4 以上，而且要先「加入主畫面」，再從主畫面的豆腐圖示打開。

> 注意：GitHub 會在 repo 連續 60 天沒有任何更新時暫停排程，到 Actions 分頁按一下啟用即可。
>
> GitHub 的排程雖然設成每 30 分鐘，忙碌時常常延遲，實際上可能幾小時才跑一次，所以回覆通知會晚一點到。想立刻測試：Actions → **Push notifications** → **Run workflow**，紀錄最後一行的 `people with notifications on` 就是目前開啟通知的人數。
>
> **開不了通知？** Settings 的通知卡片會顯示失敗原因和錯誤碼（例如沒允許通知、手機註冊失敗、存不進帳號），截圖給 Claude 即可。開啟成功時手機會馬上跳出一則測試通知，卡片上也有「Send a test notification」可以再測。

**為什麼有人每次都要重新登入？** 最常見的原因是從 LINE、Instagram、Facebook 裡直接點開連結。這些 App 內建的瀏覽器常常不保存登入狀態。App 現在會自動偵測：LINE 會自動跳到手機的瀏覽器，其他 App 會顯示提示，請改用 Safari／Chrome 開啟。無痕模式也不會保存登入。

**最後用兩支手機測一次：** 兩支手機分別用不同的 Google 帳號登入（或用一般視窗＋無痕視窗）。A 發文、按讚、留言，B 重新整理後應該看得到。

免費的 Spark 方案不用信用卡，小型使用綽綽有餘。這些設定值本來就是公開的，安全性由 `firestore.rules` 控管（見下方「安全性」）。

## 安全性

### 規則已經做的事（`firestore.rules`）

- **欄位白名單與長度上限**：串文、留言、轉發、檢舉都只能有固定的欄位，名稱 ≤ 40 字、帳號 ≤ 24 字、串文 ≤ 500 字、留言 ≤ 300 字。推播通知裡出現的名字和內容因此也有上限。
- **防刷讚／刷轉發**：每人每則只能有一筆 `likes/{uid}_{串文}`、`reposts/{uid}_{串文}` 紀錄，計數器只能跟著紀錄的新增／刪除一起 ±1。
- **頻率限制**：每人每 30 秒最多發一則串文、每 10 秒最多一則留言、每 10 秒最多一次檢舉（記錄在 `limits/{uid}`）。
- 私人資料（`users`、`likes`、`pushTokens`）只有本人讀得到；`reports` 只有你在主控台看得到。

### 要在後台做的設定（建議依序完成）

1. **限制 API 金鑰只能從你的網站使用**
   - 打開 <https://console.cloud.google.com/apis/credentials?project=toefl-threads>
   - 點 **API keys** 底下的 **Browser key (auto created by Firebase)**（就是 `js/firebase-config.js` 裡那把）
   - **Application restrictions** 選 **Websites**，加入：
     - `https://toefu.app/*`
     - `https://www.toefu.app/*`
     - `https://toefl-threads.firebaseapp.com/*`（Google 登入視窗需要）
     - `http://localhost:*/*`（本機預覽用，不需要可省略）
   - **API restrictions** 選 **Restrict key**，勾選：Identity Toolkit API、Token Service API、Cloud Firestore API、Firebase Installations API、Firebase Cloud Messaging API、Firebase App Check API → **Save**
   - 等 5 分鐘後打開網站，確認登入、發文、按讚都正常。
2. **啟用 App Check（擋掉不是從你網站發出的請求）**
   - 打開 <https://console.firebase.google.com/project/toefl-threads/appcheck> → **Apps** → 你的網頁 App，選 **reCAPTCHA Enterprise**（目前使用）或 **reCAPTCHA v3**
   - 金鑰的網域清單要有 `toefu.app` 和 `www.toefu.app`（本機測試再加 `localhost`）
   - 把 **Site key** 填進 `js/firebase-config.js` 的 `FIREBASE_APPCHECK_KEY`（公開的，可以放進程式），`FIREBASE_APPCHECK_PROVIDER` 填 `"enterprise"` 或 `"v3"`。v3 還要把 **Secret key** 貼回 Firebase（不要放進程式）
   - reCAPTCHA Enterprise 每月有免費額度，小網站通常用不完；Google Cloud 可能要求綁定帳單帳戶
   - 上線後先在 App Check → **APIs** 看 1～2 天的流量，確認幾乎都是「Verified requests」，再對 **Cloud Firestore** 按 **Enforce**。太早 Enforce 會讓還開著舊版網頁的人暫時無法使用。
3. **開啟 GitHub 秘密掃描**：repo → **Settings → Code security** → 開啟 **Secret scanning** 和 **Push protection**（公開 repo 免費）。之後如果不小心要推送金鑰，GitHub 會直接擋下。
4. **縮小推播用服務帳戶的權限（可選）**：Google Cloud → **IAM & Admin → Service accounts** → 建立新的服務帳戶，只給 **Cloud Datastore User** 和 **Firebase Cloud Messaging API Admin** 兩個角色 → 產生金鑰，取代 GitHub Secret `FIREBASE_SERVICE_ACCOUNT` 的內容 → 刪除原本 `firebase-adminsdk` 帳戶的舊金鑰。
5. **處理檢舉**：Firebase → Firestore → `reports` 集合。看到違規內容，可以直接在主控台刪除那則 `posts` 或 `comments` 文件。

## 檔案結構

```
index.html                 頁面骨架
css/style.css              樣式（自動跟隨深色／淺色模式）
js/data/characters.js      20 個角色、題材清單、角色的留言回覆
js/data/batch-1.js … 13.js 單字與貼文（例句與串文都是為本 App 撰寫）
js/data/kk.js              KK 音標（scripts/make-kk.mjs 產生）
js/data/convos.js          角色在串文底下的互相留言
js/core.js                 文字渲染、單字偵測、排序、測驗、每日目標計算
js/store.js                儲存層（本機 localStorage / Firebase）
js/app.js                  所有畫面與互動
js/firebase-config.js      Firebase 設定（改成 null 就回到本機模式）
setup.html                 Firebase 設定檢查頁
privacy.html, terms.html   隱私權政策、服務條款與社群規則
sw.js                      Service worker（離線、安裝、背景推播）
scripts/notify/            推播發送程式（GitHub Actions 執行）
.github/workflows/         每 30 分鐘發送推播的排程
firestore.rules            Firestore 安全規則
scripts/check-data.js      檢查內容有沒有打錯
```

## 新增更多串文或單字

在 `js/data/` 新增 `batch-14.js`（複製 `batch-13.js` 的格式），並在 `index.html` 最下面的 `batch-13.js` 後加一行 `<script src="js/data/batch-14.js"></script>`（`sw.js` 的清單也要加）。片語的 key 用底線連接，例如 `in_retrospect`，畫面上會顯示成 in retrospect。

- 單字：`resilient: { pos: "adj.", zh: "有韌性的", level: 2, ex: "英文例句", exZh: "中文翻譯" }`
- 貼文：`{ id: "p469", author: "zorp", topic: "Astronomy", text: "…[[resilient]]…", zh: "中文翻譯" }`
  - 字形不同時寫 `[[resilient|resiliently]]`
  - `author` 要是 `characters.js` 裡的角色，`topic` 要是 `TOPICS` 裡的題材
  - 貼文難度會依單字的 `level` 自動計算

改完在電腦執行 `node scripts/check-data.js`，它會告訴你有沒有拼錯的單字、缺少的翻譯、重複的 id。

## 用 GitHub Pages 免費發佈

1. repo → **Settings → Pages → Build and deployment**
2. Source 選 **Deploy from a branch**，Branch 選要發佈的分支、資料夾 `/ (root)` → **Save**。目前這個 repo 只有 `claude/magical-davinci-o7fmqc` 一個分支，網站就是從它發佈的。如果之後想改用 `main`，要先建立 `main` 分支，再回到這裡把 Branch 換成 `main`。
3. 1～2 分鐘後網址是 **<https://toefu.app/>**（自訂網域，見下一節）。舊網址 `chiaying1230.github.io/toefl-threads/` 會自動轉到新網址。
4. 手機加入主畫面：iPhone Safari 分享 →「加入主畫面」；Android Chrome ⋮ →「加到主畫面」

> 免費的 GitHub Pages 需要 repo 是 **Public**。

## 自訂網域 toefu.app（Cloudflare）

網站檔案還是放在 GitHub Pages，Cloudflare 只負責 DNS。repo 根目錄的 `CNAME` 檔（內容是 `toefu.app`）告訴 GitHub 要用這個網域。

1. **Cloudflare → toefu.app → DNS → Records**，新增下面 9 筆。**Proxy status 全部關成 DNS only（灰色雲朵）**，否則 GitHub 發不出 HTTPS 憑證。

   | Type | Name | Content |
   |---|---|---|
   | A | `@` | `185.199.108.153` |
   | A | `@` | `185.199.109.153` |
   | A | `@` | `185.199.110.153` |
   | A | `@` | `185.199.111.153` |
   | AAAA | `@` | `2606:50c0:8000::153` |
   | AAAA | `@` | `2606:50c0:8001::153` |
   | AAAA | `@` | `2606:50c0:8002::153` |
   | AAAA | `@` | `2606:50c0:8003::153` |
   | CNAME | `www` | `chiaying1230.github.io` |

   Cloudflare 新網域預設可能有其他紀錄（例如停放頁），名稱是 `@` 或 `www` 的舊 A／AAAA／CNAME 要先刪掉。
2. **驗證網域（防止被別人搶用）**：GitHub 右上角頭像 → **Settings → Pages → Add a domain** → `toefu.app` → 依畫面在 Cloudflare 加一筆 TXT 紀錄 → **Verify**。
3. **GitHub repo → Settings → Pages → Custom domain** 會顯示 `toefu.app`。等 DNS check 變綠勾、憑證發好（通常幾分鐘，最久 24 小時）後，勾選 **Enforce HTTPS**。`.app` 網域只能用 HTTPS，憑證發好之前網址會打不開，屬正常現象。
4. **Firebase → Authentication → Settings → Authorized domains**：加入 `toefu.app` 和 `www.toefu.app`，Google 登入才能用。
5. 如果限制了 API 金鑰或設了 App Check，網域清單也要加上 `toefu.app`（見「安全性」）。

**換網域對使用者的影響**：瀏覽器把資料依網址分開存，所以新網址是「新的網站」。
- 有登入的人：雲端資料都在，在新網址重新登入一次即可。
- 沒登入的訪客：存在舊網址的收藏不會跟過來。
- 加到主畫面的人：刪掉舊圖示，從新網址重新加入。
- 推播通知：要在新網址重新開啟一次。

## 本機預覽

```bash
python3 -m http.server 8000
```
然後打開 http://localhost:8000

## 商標

TOEFL® 是 ETS 的註冊商標，Threads 是 Meta 的商標；toEfu 與 ETS、Meta 沒有任何關係，也未獲其認可。

## 單字包與難度評分

| | |
|---|---|
| 難度標籤 | Soy Milk（豆漿）/ Tofu（豆腐）/ Natto（納豆），全站同一把尺：`js/data/levels.js` 把 1,300 個托福字重新分級，門檻在 `scripts/scorelib.py`（分數 ≤40 / ≤65） |
| 單字包 | 國小國中 2,029、高中 4,126、多益 822、雅思 5,045、托福 1,300（托福就是 `batch-*.js` 的基本字庫）。`js/data/packs/<id>.js` 在使用者選了之後才載入，已選的包會被 service worker 快取 |
| 用在哪裡 | 每日一字、動態牆小測驗、閃卡、發文挑戰字、搜尋。串文目前仍只有托福字（之後每個入口再各做 100–150 則） |
| 資料來源 | `data-src/full_scores.csv`（Codex 的模型初評，**不是實測難度**）＋ `data-src/review-fixes/`（我逐筆檢查過 Codex 標為 review_required 的 1,118 筆，補上例句、修正詞義或剔除） |

重建流程（不會動到 `batch-*.js`）：

```bash
python3 scripts/import-scores.py     # 重新計算托福字的等級 → js/data/levels.js
python3 scripts/build-packs.py       # 產生 js/data/packs/*.js，報告在 data-src/packs-report.txt
cd /tmp && npm i cmu-pronouncing-dictionary
node scripts/make-kk.mjs /tmp/node_modules   # 補上 KK 音標（kk.js 與各單字包）
node scripts/check-data.js
```
