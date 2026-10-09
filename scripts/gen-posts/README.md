# gen-posts — 用 Claude API 批次產生 toEfu 串文與單字資料

離線工具，和網站程式分開。**只寫到 `out/`，不會改 `js/data/`。** API 金鑰只讀環境變數 `ANTHROPIC_API_KEY`，不寫入任何檔案。

## 安裝

```powershell
cd scripts\gen-posts
npm install
$env:ANTHROPIC_API_KEY = "sk-ant-..."     # 只在這個視窗有效
```

## 單字表 CSV

```
word,pos,zh,band
kitchen,n,廚房,1
```

`band` = 難度 1–10。預設 1–3 簡單(easy)、4–6 中等(medium)、7–10 進階(advanced)，可用 `--easy-max` / `--medium-max` 調整。
網站 `js/data/` 已有的字預設會略過（`--include-existing` 才會重做）。

## 兩支指令

| 指令 | 產生什麼 | 輸出 |
|---|---|---|
| `node gen.mjs` | 串文：每則用 2–3 個字，整篇依難度分級 | `out/*.js`（`window.POSTS.push(...)`） |
| `node vocab.mjs` | 單字資料：`pos / zh / level / ex / exZh` | `out/*.js`（`Object.assign(window.VOCAB, ...)`） |

共同參數：`--mode sync|batch`、`--max-cost 美元`（累計，續跑也算）、`--model`（預設 `claude-sonnet-5-5`）、`--retries`、`--dry-run`（只看計畫與估價）、`--mock`（離線測流程）、`--fresh`、`--chunk-size`。

## 大量產生（一萬字）的建議流程

1. **先試跑**（約 200 字、幾美元）：
   ```powershell
   node gen.mjs --words pilot.csv --out out/pilot.js --review --mode batch --max-cost 5 --chunk-size 40
   node vocab.mjs --words pilot.csv --out out/pilot-vocab.js --mode batch --max-cost 1
   ```
   看 `out/pilot.report.json`（改寫率、被拒原因、`inspect` 抽查名單）和內容品質。
2. **全量**（Batch API 半價，慢慢跑沒關係）：
   ```powershell
   node gen.mjs --words all.csv --out out/all.js --review --mode batch --max-cost 80 --chunk-size 40
   node vocab.mjs --words all.csv --out out/all-vocab.js --mode batch --max-cost 15 --chunk-size 500
   ```
3. Batch 送出後可以關掉視窗。**再執行同一行指令**就會接著等／收結果，不會重複付費。
4. 抽查報告裡的 `inspect` 名單，沒問題再合併進網站（合併是手動步驟，不在這個工具裡）。

估價（用小樣本推算，實際會有出入）：一萬字約 4,000 則串文；Batch + review 約 $25–30，單字資料約 $3。

## 品質機制

- 格式：`[[word]]` / `[[word|變化形]]`、只標指定的字、每個字都要出現、變化形不能和原字相同。
- 分級：依難度分 easy / medium / advanced，限制每段長度與每句字數，review 時再檢查非目標字是否太難。
- 內容：不得出現目標字的中文意思；角色口吻與設定要符合；不說教式結尾；不寫沒把握的數字史實。
- 多樣性：每則隨機給一個場景提示；與站上現有串文和本次已接受串文比對 4-gram 相似度，太像就重寫（`--sim-threshold`）。
- `--review`：每批寫完後由模型以「嚴格編輯」逐字檢查，有問題才改寫，改寫版本仍須通過驗證。
- 失敗重試、可續跑、輸出寫完後再驗證一次。

## 合併進網站前（還沒做）

- `check-data.js` 目前只接受單字 `level` 1–3，需放寬到 1–10。
- 單字資料不含 KK 音標，合併後要跑 `scripts/make-kk.mjs`。
- 一萬字約 4,000 則串文，網站目前一次載入全部 `batch-*.js`，量大時要改成分批載入。
