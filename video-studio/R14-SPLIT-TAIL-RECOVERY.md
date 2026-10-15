# hs-016 切片句尾空白：r14 免費回復

2026-10-14 本人回報影片驗證失敗。不是畫面文案或 provider 需要重錄。

原 draft `e7e98f79-7176-4f3e-8e5a-03bbac2e392c`，hs-016 revision2；原 run `a9e43b1e-239e-4dec-a995-84943a09c909`、candidate `67bffc1f-e95e-40ed-8cbf-de69564d42a6`。9 段聲音只有 `story004En1Part2` 不合格：onset slack20ms，tail slack200ms，既有上限60ms。

r12 最終 fade／PCM 檢查只處理沒有 parts 的段落。句子切成 parts 後仍用舊 waveform trim 邊界；最後短暫訊號被 edge fade 移除，片尾因而多留空白。r14 對每個切片的最終 PCM 檢查相同界線；只有超標才套用同一 trimClip 與 exact sample rebase/clamp。正常片段音訊不改，原 MP3／alignment／cut evidence 不覆寫，聲音文字與 request hashes 不變。不能安全修正仍 BLOCK。

7 組真實封存聲音在隔離重播完成 assemble → camera → audit → render → mix → verify，11 checks PASS。正式新 run `ddbedecb-e15b-49b4-b074-b99c541cf2df`、candidate `2f290027-3e2a-4573-99d0-b66e167a444e` 也完成全流程與 review preparation：verify11/11、mix6/6、9 acoustic lines PASS，問題片段 tail50ms、整支最長55ms。state `awaiting_review`；draft decisions／revision unchanged，receipt／execution／attempt／network request／reserved chars aggregates 前後相同。免費預覽8 hit、0 miss、5 silent，新增 provider requests0。

影片由該 draft 的 `production/media/final` 播放；本人看完並聽過後按一次「看完了，沒問題」即可進完成頁。未代本人接受、freeze、promotion、commit、push 或 tag。

回歸包含新增 split-tail fading transient case，共103項離線測試 PASS；P2–P5 plan與WAV逐byte相同。逐幀結果與凍結 hashes 的最終證據見 `docs/video/revisions/r14-split-final-pcm.json`。P2 兩個 owner 已刪除的舊 reference 仍缺失，不宣稱 stock 完整資產檢查全部通過。
