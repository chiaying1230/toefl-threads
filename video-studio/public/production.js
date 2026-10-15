// 2B production panel: free preflight → explicit paid confirmation → local production steps → human review.
// The server decides every status; this page only displays it and sends explicit human actions.
(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
  const MILESTONES = ['voice_planned', 'voice_confirmed', 'voice_generating', 'voice_generated', 'assembled', 'camera_fitted', 'audited', 'rendered', 'mixed', 'verified', 'awaiting_human_review', 'approved'];
  const STEP_NAMES = { voice: '產生語音', assemble: '組合語音與字幕', camera: '安排鏡頭畫面', audit: '逐格檢查畫面', render: '製作影片', mix: '加入配樂與音效', verify: '檢查影片', review: '準備人工驗收' };
  const STATE_NAMES = { preflight: '免費預檢中', awaiting_confirmation: '等你確認語音費用', voice_planned: '語音已規劃', voice_confirmed: '語音已確認', voice_generating: '語音產生中', awaiting_take_selection: '請比較新舊語音', ready: '準備製作影片', awaiting_review: '請檢查影片', blocked: '需要修改', failed: '製作失敗', interrupted: '製作中斷', changes_requested: '需要修改', stale: '內容已變更', approved: '已接受' };
  let session = null, draftRef = null, view = null, preview = null, idempotency = null, timer = null, busy = false, promotionPreview = null;
  const key = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  async function call(url, method = 'GET', body) {
    session ||= await (await fetch('/api/session')).json();
    const res = await fetch(url, { method, headers: body ? { 'content-type': 'application/json', 'x-studio-csrf': session.csrf } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json();
    if (!res.ok) { const e = Error(data.error?.message || res.statusText); e.status = res.status; e.problems = data.error?.problems; throw e; }
    return data;
  }
  const base = () => `/api/drafts/${draftRef.id}/production`;
  function note(text) { $('p2b-message').textContent = text; $('message').textContent = text; }
  function pageItems(container, items, label) {
    if (items.length < 2) return;
    let index = 0; const nav = el('div', null, 'item-navigation');
    const prev = el('button', '上一項', 'secondary'), count = el('span'), next = el('button', '下一項', 'secondary'); prev.type = next.type = 'button'; nav.append(prev, count, next); container.before(nav);
    const show = () => { items.forEach((n, i) => n.hidden = i !== index); count.textContent = `${label} ${index + 1} / ${items.length}`; prev.disabled = index === 0; next.disabled = index === items.length - 1; };
    prev.onclick = () => { index--; show(); }; next.onclick = () => { index++; show(); }; show();
    container.showItem = node => { const selected = items.indexOf(node); if (selected >= 0) { index = selected; show(); } };
  }
  function issues(container, title, list) {
    if (!list?.length) return;
    container.append(el('strong', title));
    const ul = el('ul'); for (const i of list) { const label = [i.code, i.path].filter(Boolean).join(' · '); ul.append(el('li', `${label ? `${label}：` : ''}${i.message || JSON.stringify(i)}`)); } container.append(ul);
  }
  async function act(fn) { if (busy) return; busy = true; render(); try { await fn(); } catch (e) { note(e.message); if (e.problems) issues($('p2b-actions'), '原因', e.problems); } finally { busy = false; await refresh(); } }

  function renderEnvelope(container) {
    const env = view?.envelope; if (!env) return;
    // once this envelope has been confirmed it is history: shown collapsed, never as "nothing sent yet"
    const confirmed = (view.executions || []).length > 0 && view.run.state !== 'awaiting_confirmation';
    const box = el(confirmed ? 'details' : 'div', null, 'envelope');
    box.append(el(confirmed ? 'summary' : 'h3', confirmed ? '已確認的付費請求（這次 run 的 envelope）' : env.recovery ? '恢復付費確認（新的授權）' : '付費前確認（免費預覽，尚未送出任何請求）'));
    if (env.recovery?.warning) box.append(el('p', `⚠ ${env.recovery.warning}`, 'danger'));
    if (env.retake) {
      box.append(el('h4', `重錄一段語音：${env.retake.rejected.segmentId}`));
      box.append(el('p', `${env.retake.rejected.text}：${env.retake.rejected.reason}`));
      box.append(el('p', env.retake.note, 'warning'));
      box.append(el('p', `其餘 ${env.retake.reuse.length} 段會沿用，不會重複產生。`));
    }
    else if (env.recovery?.note) box.append(el('p', env.recovery.note, 'warning'));
    const c = env.counts;
    box.append(el('p', c.miss ? `這次若確認，會送出 ${env.requests.length} 段新語音；其餘 ${c.hit} 段沿用，不會重複產生。` : '這次全部語音都能沿用，無須付費產生新語音。', 'next-action'));
    box.append(el('p', `最多送出 ${env.budget.maxSubmittedChars} 個字元、${env.budget.maxRequests} 次請求；實際扣額由語音服務決定。`, 'warning'));
    const budgetDetail = el('details'); budgetDetail.append(el('summary', '查看計算方式與重試規則'), el('p', `語音共 ${env.segments.length} 段；沿用 ${c.hit} 段、新增 ${c.miss} 段、不朗讀 ${c.silent} 段。預計送出 ${env.estimatedUniqueTextChars} 個字元，單次最多 ${env.maxRequestChars} 個。`), el('p', `自動付費重試 ${env.retryPolicy.additionalPaidAttemptsPerHash} 次。結果不明時會停止，請你重新確認。`), el('p', env.billingDisclaimer)); box.append(budgetDetail);
    // one card per request: the exact text that will be sent is the main thing to read before paying
    const list = el('ol', null, 'requests');
    for (const r of env.requests) {
      const li = el('li');
      li.append(el('strong', `${r.segmentIds.join(', ')} · ${r.speaker} · ${r.chars} 字元`));
      if (r.partIds.length) li.append(el('div', `整句只送一次；之後切成 ${r.partIds.join(' + ')}`, 'detail'));
      li.append(el('blockquote', r.text));
      const voiceDetail = el('details'); voiceDetail.append(el('summary', '查看語音設定'), el('p', `voice ${r.voiceId} · ${r.model} · language_code ${r.languageCode ?? '未指定'} · ${JSON.stringify(r.settings)}`)); li.append(voiceDetail);
      list.append(li);
    }
    box.append(list);
    pageItems(list, [...list.children], '核對語音');
    if (env.pinned.length) box.append(el('p', `已確認可沿用 ${env.pinned.length} 段既有語音，不會重新產生。`));
    if (env.quarantined.length) box.append(el('p', `有 ${env.quarantined.length} 段既有語音無法驗證，已列入新增請求。請核對上方費用。`, 'warning'));
    if (view.readiness.canGenerate && preview?.challenge && preview.run?.runId === view.run.runId) {
      const confirmation = el('section', null, 'voice-confirmation'); confirmation.append(el('h4', '下一步：確認這次語音需求'), el('p', `最多 ${env.budget.maxRequests} 次請求、${env.budget.maxSubmittedChars} 個字元。請核對語音內容，再勾選以下項目。`));
      const remaining = el('p', null, 'confirmation-status'); remaining.setAttribute('role', 'status');
      const acks = [['ack-retry', '如果產生失敗，系統會停下，不會自動重送扣額。'], ['ack-billing', '我知道實際扣額以 ElevenLabs 為準，這裡顯示的是字元估計。'], ...(env.recovery?.warning ? [['ack-double', '我知道先前請求可能已扣額，重新送出可能再扣一次。']] : [])];
      const updateConfirm = () => { const missing = acks.filter(([id]) => !$(id)?.checked).length; $('p2b-confirm').disabled = busy || missing > 0; remaining.textContent = missing ? `還有 ${missing} 項需要確認；勾選後即可繼續。` : '已確認，可以產生語音。'; };
      for (const [id, text] of acks) { const l = el('label', null, 'confirmation-check'), i = el('input'); i.type = 'checkbox'; i.id = id; i.onchange = updateConfirm; l.append(i, document.createTextNode(text)); confirmation.append(l); }
      const b = el('button', `確認產生語音（最多 ${env.budget.maxSubmittedChars} 字元、${env.budget.maxRequests} 次請求）`, 'paid'); b.id = 'p2b-confirm'; b.type = 'button'; b.disabled = true;
      b.onclick = () => act(async () => {
        idempotency ||= key(); // a double click / retry sends the same key → the same execution
        await call(`${base()}/confirm`, 'POST', { runId: view.run.runId, challenge: preview.challenge.challenge, idempotencyKey: idempotency, budget: env.budget, acknowledgements: { noAutomaticRetry: true, estimateIsNotBilling: true, ...(env.recovery?.warning ? { possibleDoubleCharge: true } : {}) } });
        note('已確認；語音產生中。重新整理頁面不會重送。');
      });
      remaining.textContent = `請勾選上面 ${acks.length} 項，即可繼續。`; confirmation.append(remaining, b); box.insertBefore(confirmation, budgetDetail);
    } else if (view.run.state === 'awaiting_confirmation') box.append(el('p', '確認碼只在預覽當下有效；請重新產生免費預覽後再確認。', 'warning'));
    container.append(box);
  }
  function renderLedger(container) {
    for (const e of view?.executions || []) {
      const box = el('details'); box.open = e.status !== 'completed';
      box.append(el('summary', `付費 execution #${e.sequence} · ${e.status} · receipt ${e.receiptStatus} · 已保留 ${e.reservedChars}/${e.budget.maxSubmittedChars} characters · 網路請求 ${e.networkAttempts}`));
      const ul = el('ul');
      for (const a of e.attempts) ul.append(el('li', `${a.segmentHash.slice(0, 8)} · ${a.status}${a.httpStatus ? ` · HTTP ${a.httpStatus}` : ''}${a.providerRequestId ? ` · request ${a.providerRequestId}` : ''} · ${a.reservedChars} chars · provider 實際計費：未知${a.error ? ` · ${a.error.message}` : ''}`));
      box.append(ul); container.append(box);
    }
  }
  function renderSteps(container) {
    for (const s of view?.steps || []) {
      const box = el('details'); box.open = ['failed', 'blocked', 'interrupted'].includes(s.status) && s.current !== false;
      box.append(el('summary', `${STEP_NAMES[s.step] || s.step} · ${s.status}${s.current ? ' · 目前有效' : ''} · ${s.finishedAt ? new Date(s.finishedAt).toLocaleString() : '執行中'}`));
      issues(box, 'Errors', s.errors); issues(box, 'Warnings（需人工確認）', s.warnings);
      if (s.report) { const raw = el('details'); raw.append(el('summary', '查看技術報告'), el('pre', JSON.stringify(s.report, null, 2))); box.append(raw); }
      container.append(box);
    }
  }
  function renderFailureRecovery(container) {
    if (!['blocked', 'failed'].includes(view?.run?.state)) return;
    const failed = [...(view?.steps || [])].reverse().find(s => ['failed','blocked'].includes(s.status));
    if (!failed || !['camera','audit'].includes(failed.step)) return;
    const issue = failed.errors?.[0], iterations = issue?.detail?.iterations || [];
    const latest = iterations.at(-1);
    const hard = latest?.hard || issue?.detail?.hard || [];
    const first = [...hard].filter(x => x.t != null).sort((a, b) => a.t - b.t)[0];
    const box = el('div', null, 'failure-card');
    box.append(el('h3', '畫面檢查停住了'));
    box.append(el('p', first ? `影片第 ${Number(first.t).toFixed(2)} 秒（第 ${first.frame} 格）有內容沒有完整出現在畫面內。` : '目前的文字與語音長度讓鏡頭無法排出完整可讀的畫面。'));
    if (first?.message) box.append(el('p', `受影響的內容：${first.message}`));
    if (first?.detail?.rect && Number.isFinite(first.detail.T)) box.append(el('p', `當時內容的位置：${first.detail.rect[0]}–${first.detail.rect[1]}；鏡頭位置：${first.detail.T}。這些數字僅供定位，不需要你手動填寫。`));
    if (iterations.length) box.append(el('p', `系統已試過 ${iterations.length} 種排法，仍未通過。`));
    box.append(el('p', '目前顯示的是最後一次嘗試仍未通過的畫面。若問題是鏡頭提前移動或文字在轉場被切掉，需要修正鏡頭排程；不必為此縮短文字或重錄語音。既有語音會保留。', 'next-action'));
    if (view?.retryBlocker) box.append(el('p', '相同內容已確定失敗，已停止重複執行。', 'danger'));
    const details = el('details'); details.append(el('summary', '查看每次嘗試與失敗細節'));
    if (iterations.length) { const list = el('ol'); for (const attempt of iterations) { const hard = attempt.hard || [], firstHard = hard[0]; list.append(el('li', `第 ${Number(attempt.iteration) + 1} 次：記錄 ${hard.length} 項畫面問題${firstHard ? `；${firstHard.t == null ? '' : `最早在 ${Number(firstHard.t).toFixed(2)} 秒，`}${firstHard.message || firstHard.code}` : ''}`)); } details.append(list); }
    const raw = el('details'); raw.append(el('summary', '技術資料'), el('pre', JSON.stringify(issue?.detail || issue || {}, null, 2))); details.append(raw); box.append(details);
    container.append(box);
  }
  function renderComplete(container) {
    if (!view?.readiness.productionReady || view.review?.status !== 'accepted') return;
    const card = el('div', null, 'completion-card'), heading = el('div', null, 'completion-heading');
    heading.append(el('span', '✓', 'completion-check'), el('h2', '影片已完成'), el('p', `${draftRef.contentId} 的這個版本已通過你的驗收。`)); card.append(heading);
    const actions = el('div', null, 'completion-actions'), download = el('a', '下載 MP4', 'button-link primary'); download.href = `${base()}/media/final?download=1`; download.download = `${draftRef.contentId}.mp4`;
    const play = el('button', '播放完成影片', 'secondary'); play.type = 'button';
    const video = el('video'); video.controls = true; video.preload = 'metadata'; video.src = `${base()}/media/final`; video.hidden = true; video.id = 'completed-video'; play.onclick = () => { video.hidden = !video.hidden; if (!video.hidden) video.play().catch(() => {}); else video.pause(); };
    actions.append(download, play); card.append(actions, video);
    const location = el('div', null, 'completion-location'); location.append(el('h3', '影片保存在哪裡？'), el('p', '影片已保存在本機 Studio。按「下載 MP4」可以另存一份，下載位置依你的瀏覽器設定。'));
    const saved = el('input'); saved.readOnly = true; saved.setAttribute('aria-label', 'Studio 影片保存位置'); saved.value = '正在確認保存位置…'; saved.id = 'completed-path';
    const copy = el('button', '複製保存位置', 'secondary'); copy.type = 'button'; copy.disabled = true; const status = el('p', null, 'detail'); status.setAttribute('role', 'status');
    copy.onclick = async () => { try { await navigator.clipboard.writeText(saved.value); status.textContent = '位置已複製，可以貼到檔案總管開啟。'; } catch { saved.focus(); saved.select(); status.textContent = '請複製上方選取的位置，再貼到檔案總管。'; } };
    location.append(saved, copy, status); card.append(location);
    const again = el('button', '開始下一支影片', 'secondary'); again.type = 'button'; again.onclick = () => window.StudioWizard?.show('article'); card.append(again); container.append(card);
    const expected = view.run.runId;
    call(`${base()}/result`).then(result => { if (view?.run.runId !== expected || !container.contains(card)) return; saved.value = result.savedPath; copy.disabled = false; download.download = result.fileName; status.textContent = `${result.fileName} · ${(result.bytes / 1024 / 1024).toFixed(1)} MB`; }).catch(() => { if (!container.contains(card)) return; saved.value = '保存位置暫時無法讀取'; status.textContent = '影片仍可播放或下載；請重新整理頁面再讀取位置。'; });
  }
  function renderReview(container) {
    const r = view?.review; if (!r || view.run.milestone === 'approved' && r.status === 'accepted' && !r.seams) return;
    if (r.status === 'accepted' && view.readiness.productionReady) { const box = el('div', null, 'empty-state'); box.append(el('h3', '這個版本已完成驗收'), el('p', '確認紀錄已保存，不需要再勾選。')); const done = el('button', '查看完成影片與保存位置'); done.type = 'button'; done.onclick = () => window.StudioWizard?.show('complete'); box.append(done); container.append(box); return; }
    const box = el('div', null, 'review');
    box.append(el('h3', r.status === 'accepted' ? '這個版本已接受' : r.status === 'changes_requested' ? '已記錄需要修改' : '看完影片，決定是否完成'));
    const tabs = el('div', null, 'setting-tabs'), panels = ['播放影片', '聽接句', '檢查畫面', '完成檢查'].map(() => el('div', null, 'review-panel'));
    const selectPanel = index => { panels.forEach((p, i) => p.hidden = i !== index && i !== 3); [...tabs.children].forEach((b, i) => { b.classList.toggle('active', i === index); b.setAttribute('aria-pressed', String(i === index)); }); };
    ['播放影片', '接句重聽（選用）', '檢查紀錄（選用）'].forEach((name, index) => { const b = el('button', name); b.type = 'button'; b.onclick = () => selectPanel(index); tabs.append(b); });
    box.append(tabs, ...panels); selectPanel(0);
    const [watchPanel, seamPanel, visualPanel, decisionPanel] = panels;
    const video = el('video'); video.controls = true; video.preload = 'metadata'; video.src = `${base()}/media/final`; video.id = 'p2b-video'; watchPanel.append(video);
    const sheet = el('a', '另開關鍵畫面對照圖'); sheet.href = `${base()}/media/review-sheet`; sheet.target = '_blank'; sheet.rel = 'noopener'; watchPanel.append(sheet, el('p', '看完並聽過影片，覺得文字、畫面和聲音都沒問題，就按「看完了，沒問題」。不需要逐項勾選。'));
    const open = r.status === 'open';
    const check = (group, id, text) => el('p', text, 'choice');
    seamPanel.append(el('p', '聽教學前後的接句，確認回到故事時自然流暢。'));
    if (!r.seams.length) seamPanel.append(el('p', '這支影片沒有需要額外檢查的接句。'));
    const seams = el('div'); seamPanel.append(seams);
    for (const s of r.seams) {
      const item = el('div', null, 'seam');
      item.append(el('p', `${s.segment}：「${s.after}」→ 教學 →「${s.before}」· cut ${s.cutAt.toFixed(3)}s · quiet ratio ${s.ratio}${s.warning ? ` · ⚠ ${s.warning}` : ''}`));
      for (const c of s.clips.clips) { const l = el('label', c.kind === 'whole' ? '整句原始 take（切開前，完整一句）' : `${{ handoff: '進入教學前', resume: '回到故事' }[c.kind]}（narration ${c.from}–${c.to}s）`); const a = el('audio'); a.controls = true; a.preload = 'none'; a.src = `${base()}/media/seam-${s.clips.index}-${c.kind}`; l.append(a); item.append(l); }
      for (const [label, t] of [['影片中：進入教學', s.clips.finalTimes.handoffEnd - 2], ['影片中：回到故事', s.clips.finalTimes.resumeStart - 0.5]]) { const b = el('button', label); b.type = 'button'; b.onclick = () => { selectPanel(0); const v = $('p2b-video'); v.currentTime = Math.max(0, t); v.play().catch(() => {}); }; item.append(b); }
      seams.append(item);
    }
    pageItems(seams, [...seams.children], '接句');
    visualPanel.append(el('p', '這些是看影片時可留意的地方，不需要逐項勾選。'));
    const checks = el('div'); visualPanel.append(checks);
    for (const v of r.visualChecklist) checks.append(check('visual', v.id, v.text));
    for (const w of r.warnings) checks.append(check('warnings', w.id, `${w.t != null ? `第 ${w.t.toFixed(2)} 秒：` : ''}${w.message}`));
    pageItems(checks, [...checks.children], '檢查項目');
    const completion = el('p'); decisionPanel.append(completion);
    const m = el('details'); m.append(el('summary', '查看自動檢查與版本資料'), el('p', `版本 ${view.run.revision} · ${r.bundleHash.slice(0, 19)}…`), el('pre', JSON.stringify(r.machine, null, 2))); decisionPanel.append(m);
    if (open) {
      const accept = el('button', '看完了，沒問題', 'primary'); accept.type = 'button'; accept.id = 'p2b-accept'; accept.disabled = busy;
      accept.onclick = () => act(async () => {
        const acks = { seams: {}, visual: {}, warnings: {}, reviewMode: 'whole-video', wholeVideoReviewed: true };
        for (const [group, items] of [['seams', r.seams], ['visual', r.visualChecklist], ['warnings', r.warnings]]) for (const item of items) acks[group][item.id] = true;
        await call(`${base()}/review`, 'POST', { runId: view.run.runId, bundleHash: r.bundleHash, decision: 'accept', acknowledgements: acks, comment: $('p2b-comment').value, idempotencyKey: key() });
        note('影片已完成驗收，接下來可以播放或下載 MP4。');
      });
      const comment = el('textarea'); comment.id = 'p2b-comment'; comment.rows = 2; comment.placeholder = '備註（選填）';
      const changes = el('details', null, 'changes'); changes.append(el('summary', '影片需要修改'));
      const category = el('select'); for (const [value, text] of Object.entries({hook:'開場',seam:'接句',camera:'鏡頭',card:'詞卡',quiz:'測驗',outro:'片尾',audio:'聲音',other:'其他'})) category.add(new Option(text, value)); category.id = 'p2b-category';
      const at = el('input'); at.type = 'number'; at.step = '0.1'; at.min = '0'; at.placeholder = '時間點（秒，選填）'; at.id = 'p2b-at';
      const text = el('textarea'); text.rows = 2; text.id = 'p2b-notes'; text.placeholder = '需要修改的地方';
      const reject = el('button', '需要修改'); reject.type = 'button';
      reject.onclick = () => act(async () => {
        await call(`${base()}/review`, 'POST', { runId: view.run.runId, bundleHash: r.bundleHash, decision: 'changes', notes: [{ category: category.value, t: at.value ? Number(at.value) : null, text: text.value }], idempotencyKey: key() });
        note('已記錄問題。請回到對應步驟修改並保存，再做免費檢查；可沿用的語音不會重新產生。');
      });
      changes.append(el('h4', '需要修改'), category, at, text, reject);
      decisionPanel.append(comment, accept, changes);
    }
    completion.textContent = '確認後會進入完成頁，顯示下載按鈕與影片保存位置。';
    container.append(box);
  }
  function renderPromotion(container) {
    if (view.run?.milestone !== 'approved') return;
    if (!session?.promotionEnabled) return;
    const box = el('div', null, 'promotion');
    box.append(el('h3', 'Canonical promotion（另一個授權）'));
    if (!session?.promotionEnabled) { box.append(el('p', '這個版本已完成檢查。公開或凍結的操作目前未開放。')); container.append(box); return; }
    const b = el('button', '預覽 promotion（不寫入）'); b.type = 'button';
    b.onclick = () => act(async () => { promotionPreview = await call(`${base()}/promotion/preview`, 'POST', {}); });
    box.append(b);
    if (promotionPreview) {
      const p = promotionPreview.preview;
      box.append(el('pre', p.targets.map(t => `${t.action.padEnd(7)} ${t.canonical}${t.reason ? ` (${t.reason})` : ''}`).join('\n')));
      issues(box, '問題', p.problems); for (const r of p.risks) box.append(el('p', r, 'warning'));
      if (p.ok) {
        const go = el('button', '確認 promotion（不是 freeze）'); go.type = 'button';
        go.onclick = () => act(async () => { await call(`${base()}/promotion/confirm`, 'POST', { bundleHash: promotionPreview.bundleHash, challenge: promotionPreview.challenge.challenge, acknowledgements: { notAtomic: true, notFreeze: true } }); promotionPreview = null; note('Promotion committed。'); });
        box.append(go);
      }
    }
    container.append(box);
  }
  function render() {
    if (!draftRef) return;
    window.StudioWizard?.production(view);
    for (const id of ['p2b-actions', 'p2b-envelope', 'p2b-ledger', 'p2b-steps', 'p2b-review', 'p2b-promotion', 'p2b-complete']) $(id).replaceChildren();
    if (draftRef.status !== 'voice_planned') { $('p2b-summary').textContent = '請先到「免費檢查」步驟，確認內容可製作。'; return; }
    const run = view?.run, actions = $('p2b-actions');
    const timingFailure = run?.reason?.some(r => r.code === 'VERIFY_FAILED' && r.message.includes('voiced span'));
    const voiceDone = view?.steps?.some(s => s.step === 'voice' && s.status === 'succeeded' && s.current);
    if (run && (voiceDone || !run.running) && $('p2b-message').textContent.includes('語音產生中')) note(run.state === 'awaiting_review' ? '影片已完成機器檢查，請播放影片並實聽接句。' : run.running ? '語音已產生並保留，正在免費製作影片。' : '語音已產生並保留。請查看目前製作結果與下一步。');
    document.querySelector('[data-step=voice]')?.classList.toggle('awaiting-payment', run?.state === 'awaiting_confirmation' && preview?.challenge && preview.run?.runId === run.runId);
    $('p2b-summary').textContent = run ? `${STATE_NAMES[run.state] || '製作中'}${run.running ? '…' : ''}${view.readiness.productionReady ? ' · 可以進入下一步' : ''}` : '尚未查看語音需求。';
    $('p2b-progress').value = run ? MILESTONES.indexOf(run.milestone) + 1 : 0;
    if (run?.reason?.length) issues(actions, run.state === 'blocked' ? '已停止（需要人工處理）' : '狀態原因', timingFailure ? run.reason.map(r => r.code === 'VERIFY_FAILED' ? { message: '影片的旁白時間沒有對齊，製作已停止。已付費語音保留；可使用修正後的製作程式免費重建。' } : r) : run.reason);
    if (view?.retryBlocker) issues(actions, timingFailure ? '已停止重複執行' : '這份內容需要先修改才能重試', [timingFailure ? { message: '相同資料重跑不會修好。請保留目前語音，套用製作修正後免費重建影片。' } : view.retryBlocker]);
    if (view?.invalidation?.nextActions?.length) issues(actions, '下一步（舊 run 不會恢復；productionReady = false）', view.invalidation.nextActions);
    if (view?.preflight?.parity?.problems?.length) issues(actions, '時間參照 parity', view.preflight.parity.problems);
    const button = (text, fn, disabled = false) => { const b = el('button', text); b.type = 'button'; b.disabled = busy || disabled; b.onclick = () => act(fn); actions.append(b); return b; };
    if (view?.recovery?.restartRequired) actions.append(el('p', '製作修正已安裝。請先重新啟動 Studio，再回到這個步驟免費重建；已產生的語音會保留。', 'next-action'));
    if (view?.recovery?.canRebuildAfterUpdate) button('套用製作修正，免費重建影片', async () => { preview = await call(`${base()}/rebuild-after-update`, 'POST', { runId: run.runId, revision: draftRef.revision }); await window.StudioEditor?.reloadCurrent(); note(preview.envelope?.requests.length ? '目前有語音無法沿用；尚未送出任何請求，請核對需求。' : '已沿用現有語音，正在免費重建影片。'); });
    const terminal = !run || ['stale', 'superseded', 'changes_requested', 'blocked'].includes(run.state) && !(view.executions || []).some(e => ['failed', 'blocked', 'interrupted', 'expired', 'issued'].includes(e.status));
    if (!run || terminal || ['awaiting_confirmation', 'preflight'].includes(run.state) && !run.running) button('免費查看這次需要多少新語音', async () => { idempotency = null; preview = await call(`${base()}/preview`, 'POST', { revision: draftRef.revision }); note(preview.challenge ? '請檢查下列請求與成本，再明確確認。' : preview.notice || (preview.envelope && preview.envelope.requests.length === 0 ? '既有語音都能沿用；不需要付費確認。' : '製作檢查停住了，尚未確認語音能否沿用。請查看下方原因。')); });
    const last = view?.executions?.at(-1);
    if (run && !run.running && last && ['issued', 'failed', 'interrupted'].includes(last.status) && !last.attempts.some(a => a.status === 'unknown')) button(last.status === 'issued' ? '開始已確認的語音產生（同一授權，重新驗證後執行）' : '續跑語音（同一授權，只送從未嘗試的段落）', async () => { await call(`${base()}/resume-voice`, 'POST', { runId: run.runId }); });
    if (run && !run.running && last && ['failed', 'blocked', 'interrupted', 'expired'].includes(last.status)) button(last.status === 'expired' && !last.networkAttempts ? '授權已過期：建立新的確認（沒有任何請求送出過）' : '恢復付費（建立新的確認；先前請求可能已扣額）', async () => { idempotency = null; preview = await call(`${base()}/preview`, 'POST', { revision: draftRef.revision, recoveryRunId: run.runId }); });
    if (run && !run.running && view.readiness.canRender && ['failed', 'interrupted', 'blocked'].includes(run.state)) button('續跑本機步驟（免費）', async () => { await call(`${base()}/resume`, 'POST', { runId: run.runId }); }, Boolean(view.retryBlocker));
    renderFailureRecovery(actions);
    if (run && !run.running && ['blocked','failed'].includes(run.state) && view.envelope?.retake) button('換回原本語音與舊影片，重新檢查', async () => { await call(`${base()}/restore-take`, 'POST', { runId: run.runId, takeId: view.envelope.retake.takeId }); note('已換回原本語音，請重新檢查舊影片。'); });
    renderEnvelope($('p2b-envelope')); renderLedger($('p2b-ledger')); renderSteps($('p2b-steps')); renderReview($('p2b-review')); renderPromotion($('p2b-promotion')); renderComplete($('p2b-complete'));
    if (run?.state === 'awaiting_take_selection') {
      const compare = el('div', null, 'take-compare'); compare.append(el('h3', '先試聽，再選用語音'));
      for (const [role, label] of [['take-old','原本的語音'],['take-new','新產生的語音']]) { const l = el('label', label), duration = el('span', ' · 讀取長度中…'); const a = el('audio'); a.controls = true; a.preload = 'metadata'; a.src = `${base()}/media/${role}`; a.onloadedmetadata = () => { duration.textContent = Number.isFinite(a.duration) ? ` · ${a.duration.toFixed(2)} 秒` : ' · 長度未知'; }; a.onerror = () => { duration.textContent = ' · 無法播放，請勿選用'; }; l.append(duration,a); compare.append(l); }
      compare.append(el('p', '請聽發音並比較長短。選用新語音後，系統會免費重做影片並再次要求人工檢查。')); actions.append(compare);
      button('選用新語音並免費重做影片', async () => { await call(`${base()}/select-take`, 'POST', { runId: run.runId, takeId: view.envelope.retake.takeId }); });
      button('保留原本語音，重新檢查舊影片', async () => { await call(`${base()}/restore-take`, 'POST', { runId: run.runId, takeId: view.envelope.retake.takeId }); note('已切回原本語音，請重新檢查影片。'); });
    }
    if (run && !run.running && run.state === 'awaiting_review' && view.envelope?.retake && view.review?.status === 'open') button('改回原本語音，重新檢查舊影片', async () => { await call(`${base()}/restore-take`, 'POST', { runId: run.runId, takeId: view.envelope.retake.takeId }); note('已切回原本語音，請重新檢查影片。'); });
    if (run && !run.running && view.review?.status === 'open' && view.readiness.canReview) {
      const select = el('select'); select.id = 'p2b-retake-segment';
      for (const s of view.envelope.segments.filter(s => !s.silent)) select.add(new Option(`${s.id}「${s.text}」`, s.id));
      const reason = el('textarea'); reason.id = 'p2b-retake-reason'; reason.placeholder = '拒絕這個 take 的原因（必填）';
      actions.append(el('h4', '有一段語音不滿意？'), select, reason);
      button('重錄這一段：先免費查看需求', async () => { idempotency = null; preview = await call(`${base()}/retake`, 'POST', { baseRunId: run.runId, segmentId: select.value, revision: draftRef.revision, reject: true, reason: reason.value }); });
    }
  }
  async function refresh() {
    if (!draftRef) return;
    const expectedDraft = draftRef.id;
    try { const result = await call(base()); if (draftRef?.id !== expectedDraft) return; view = result; } catch (e) { if (draftRef?.id !== expectedDraft) return; note(e.message); }
    render();
    clearTimeout(timer);
    if (view?.run?.running || view?.run?.state === 'running') timer = setTimeout(refresh, 2000);
  }
  window.StudioProduction = { show(draft) { const changed = draftRef?.id !== draft?.id || draftRef?.revision !== draft?.revision; draftRef = draft; if (changed) { preview = null; idempotency = null; promotionPreview = null; } refresh(); } };
})();
