# 原文中文字幕（Studio opt-in）

使用者決定：原文的中文不朗讀，畫面照常保留，並留閱讀時間。這不影響 Ling 的中文詞義教學。

「原文朗讀」提供中文只顯示的勾選與每段 1–8 秒停留設定（初始建議 2 秒）。保存為 `decisions.storyChinese = { mode: 'subtitle', seconds: 2 }`，納入原有決策／workflow hash。未勾選的既有草稿保持原來行為。

Compiler 依原文確切位置分開中文與英文，保留詞彙位置、英文 TTS 與教學。中文用既有 translation part 顯示，以獨立 silent narration line 排定閱讀時間；不送 TTS。Studio 的 camera、visibility 和逐幀 audit 同時確認字幕在該 silent line 期間完整可見。共用 renderer、ReadingCue、voice pipeline 與來源資料不改。

只改停留時間會使下游失效並需免費重建，但不改任何 spoken request hash。已選定的 immutable take 可沿用同一 request contract。

驗證：混合段落、段首／段尾中文、同一句中英切換、保存／重開、時間修改、既有 display-only 與英文輸出相容。elem-012 revision 2 的隔離副本通過 shared validator、free voice plan 和實際組合／camera／audit：852 frames，shared issues 0、extended hard 0；兩段旁白停頓各 2 秒，PCM RMS 0。模擬音訊僅供結構與畫面驗證，不能當真人發音品質驗收。

已知 soft warning：隔離 mock timeline 有 5.47 秒下方留白，需要製作後人工看實際影片。沒有把 warning 當成已完成的人工作業。

本功能保留 Studio 原有版本 freshness 檢查；程式更新後舊 workflow 必須重檢，sealed voice 和影片檔不覆寫。沒有放寬 acceptance 或 promotion gate。

逐句翻譯修正（2026-10-14）：原文的中文句尾 `。！？` 與中文來源以相同規則解析，避免把已是中文的句子誤判成沒有句號。`subtitleProposal` 同時接入來源中文預填；「中文只顯示」模式僅列出英文句子的翻譯，原文中文不重複翻譯。elem-012 revision4 已自動保存 4 句翻譯並免費 compile / validation / voice plan PASS；所有 spoken request hashes 與 revision3 相同，新增付費請求 0。手機介面測試確認无需輸入翻譯即可保存、重開與完成免費檢查。只有來源原本有可靠對應中文時自動帶入，不把不相符的來源當成已翻譯。
