# Vocab Threads 🧵📚

一個手機優先、介面像 Threads 的托福單字學習網頁 App。
13 個虛擬角色（外星實習生、貓咪執行長、1885 年的時空旅人、網路阿嬤……）發了 30 則好笑的貼文，裡面自然融入 65 個托福單字。

介面全英文（沉浸式學習），只有單字解釋與翻譯是中文。

## 功能

- **動態牆**：30 則貼文，可以依難度（Easy / Medium / Hard）和語言（English only / Mixed）篩選
- **點藍色單字**：跳出詞性、中文解釋、例句與中譯，🔊 可以聽發音
- **Translate**：展開整則貼文的中文翻譯
- **按讚 ❤️、收藏 🔖**：收藏貼文時，裡面的單字會自動加入複習清單
- **Review**：單字列表（可展開例句、回到原貼文、移除）＋ 閃卡模式
- **New**：自己發串文，附「Word challenge」隨機給你 3 個單字造句；發文裡的托福單字會自動變成可以點的單字
- **Profile**：修改名稱、帳號與頭像，查看自己的貼文

所有資料都存在瀏覽器的 localStorage，不需要伺服器、不需要登入。
（注意：資料只存在「那一支手機的那個瀏覽器」裡，換裝置或清除瀏覽資料就會重置。）

## 檔案結構

```
index.html            頁面骨架
css/style.css         樣式（自動跟隨手機的深色／淺色模式）
js/data.js            角色、單字、30 則貼文（想新增內容就改這裡）
js/app.js             所有互動邏輯
icon.svg / apple-touch-icon.png   網站圖示
```

### 怎麼新增貼文或單字

打開 `js/data.js`：

1. 在 `VOCAB` 加入單字，例如
   `resilient: { pos: "adj.", zh: "有韌性的", level: 2, ex: "英文例句", exZh: "中文翻譯" }`
2. 在 `POSTS` 加入貼文，在內文用 `[[resilient]]` 標記單字；
   如果貼文裡的字形不同，就寫 `[[resilient|resiliently]]`。
3. 貼文的難度會依照單字的 `level` 自動計算。

## 用 GitHub Pages 免費發佈

1. 把這個分支合併到 `main`（或是在下面第 3 步直接選這個分支）。
2. 到 GitHub 上的 repo 頁面 → **Settings** → 左側 **Pages**。
3. **Build and deployment** → Source 選 **Deploy from a branch**，
   Branch 選 `main`、資料夾選 `/ (root)`，按 **Save**。
4. 等 1～2 分鐘，重新整理頁面，上方會出現網址：
   `https://chiaying1230.github.io/toefl-threads/`
5. 用手機打開這個網址即可。

> GitHub Pages 免費方案需要 repo 是 **Public**。如果 repo 是 Private，需要到 Settings → General 最下面把它改成 Public（或使用付費方案）。

### 加到手機主畫面（像 App 一樣開）

- **iPhone（Safari）**：分享按鈕 → 「加入主畫面」
- **Android（Chrome）**：右上角 ⋮ → 「加到主畫面」

## 在電腦上本機預覽

直接雙擊 `index.html` 就能開，或在資料夾裡執行：

```bash
python3 -m http.server 8000
```

然後打開 http://localhost:8000
