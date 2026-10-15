const $ = id => document.getElementById(id);
let contents = [], detail = null, draft = null, dirty = false, quizChoices = new Map(), refreshRequired = false, savedForm = null, saveError = null;
let lastHookId = null;
let saving = false;
const hookEdits = new Map();
let sourceDisplayChoices = new Map(), translationEdits = {};
function message(text) { $('message').textContent = text; }
async function api(url, method = 'GET', body) {
  const res = await fetch(url, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await res.json(); if (!res.ok) { const e = Error(data.error.message); e.status = res.status; throw e; } return data;
}
/** The decisions the form currently expresses (exactly what 保存 sends). */
function formDecisions() {
  const hook = document.querySelector('input[name=hook]:checked')?.value, quiz = document.querySelector('input[name=quiz]:checked')?.value;
  return { series: $('series').value || null, seriesEpisode: $('episode').value ? Number($('episode').value) : null, level: $('min').value && $('max').value ? { min: Number($('min').value), max: Number($('max').value) } : null, vocabulary: [...document.querySelectorAll('input[name=vocab]:checked')].map(i => i.value), hook: hook ? { candidateId: hook, text: $('hook-text').value, zh: $('hook-zh').value || null } : null, quiz: quiz ? quizChoices.get(quiz) : null, meaningSpeech: readMeaningSpeech(), meaningDisplay: readMeaningDisplay(), sourceDisplayOnly: readSourceDisplayOnly(), ...(readStoryChinese() ? { storyChinese: readStoryChinese() } : {}), production: readProductionDecisions() };
}
// dirty = the form differs from the form as rendered from the persisted draft (re-taken after every load / successful save)
function snapshot() { savedForm = JSON.stringify(formDecisions()); dirty = false; $('save').disabled = true; window.StudioWizard?.bind(draft, dirty); }
function markDirty() { dirty = savedForm === null || JSON.stringify(formDecisions()) !== savedForm; $('save').disabled = !dirty; renderProduction(); window.StudioWizard?.bind(draft, dirty); }
function guard() { return !dirty || confirm('有尚未保存的修改，確定離開這份草稿？'); }
function choices(container, items, type, name, selected, describe) {
  container.replaceChildren();
  for (const item of items) {
    const label = document.createElement('label'); label.className = 'choice';
    const input = document.createElement('input'); input.type = type; input.name = name; input.value = item.id || item.key; input.checked = selected.includes(input.value);
    label.append(input, document.createTextNode(describe(item)));
    container.append(label);
  }
}
function renderList() {
  const current = $('content').value;
  $('content').replaceChildren(new Option('選擇文章', ''));
  const query = $('search').value.toLowerCase();
  for (const c of contents.filter(c => (!$('pack').value || c.pack === $('pack').value) && `${c.id} ${c.excerpt}`.toLowerCase().includes(query))) $('content').add(new Option(`${c.id} · ${c.topic}${c.frozen ? ' · Frozen' : ''} · ${c.excerpt.slice(0, 45)}`, c.id));
  $('content').value = current;
}
async function loadContent(id) {
  detail = await api(`/api/contents/${encodeURIComponent(id)}`);
  $('article').textContent = `${detail.record.author?.name || detail.record.post.author} · ${detail.record.post.topic}\n\n${detail.record.post.text}\n\n${detail.record.post.zh || ''}`;
  $('source-warning').textContent = [detail.frozen ? '這篇文章已有正式影片；你仍可建立獨立草稿試做。' : '', /[\u3400-\u9fff]/u.test(detail.record.post.text) ? '原文有中文，請在製作前確認哪些段落要朗讀。' : '', /\p{Extended_Pictographic}/u.test(detail.record.post.text) ? '原文有表情符號；製作前請確認畫面文字。' : ''].filter(Boolean).join(' ');
  $('create').disabled = false;
}
function renderQuizzes(saved = null) {
  const keys = [...document.querySelectorAll('input[name=vocab]:checked')].map(i => i.value);
  const items = []; quizChoices = new Map();
  if (saved && keys.includes(saved.key)) {
    quizChoices.set('saved-snapshot', saved);
    items.push({ ...saved, id: 'saved-snapshot', label: '上次保存的題目 · ' });
  }
  for (const q of detail.candidates.quizzes.filter(q => keys.includes(q.key))) {
    if (saved?.candidateHash === q.candidateHash) continue;
    const id = `candidate-${q.candidateHash}`;
    quizChoices.set(id, { ...q, candidateId: q.id }); items.push({ ...q, id, label: saved ? '最新候選（需明確重新選取）· ' : '' });
  }
  choices($('quizzes'), items, 'radio', 'quiz', saved && keys.includes(saved.key) ? ['saved-snapshot'] : [], q => `${q.label}${q.word}：${q.options.map((o, i) => `${'ABC'[i]}. ${o}`).join(' / ')}（答案 ${'ABC'[q.answer]}）`);
  if (!$('quizzes').children.length) $('quizzes').textContent = '請先勾選詞彙。沒有完整來源例句或足夠干擾項的詞彙暫不推薦題目。';
}
function renderEditor() {
  refreshRequired = false;
  const d = draft.decisions;
  $('editor').hidden = false;
  $('series').value = d.series || ''; $('episode').value = d.seriesEpisode || ''; $('min').value = d.level?.min || ''; $('max').value = d.level?.max || '';
  const s = detail.suggestions;
  $('suggestions').textContent = `工作室會記住每個系列的集數。這支是「${d.series || s.series}」第 ${d.seriesEpisode || s.seriesEpisode} 集；新影片會接著編號，也可以手動修改。建議難度 ${s.level?.min ?? '?'} 到 ${s.level?.max ?? '?'}。`;
  choices($('vocabulary'), detail.record.vocabulary, 'checkbox', 'vocab', d.vocabulary, v => `${v.word} · ${v.pos || ''} · ${v.zh || '來源詞義缺漏'} · L${v.level || '?'} — ${v.ex || '來源例句缺漏'}`);
  choices($('hooks'), detail.candidates.hooks, 'radio', 'hook', d.hook ? [d.hook.candidateId] : [], h => h.text);
  $('hook-text').value = d.hook?.text || '';
  $('hook-zh').value = d.hook?.zh || '';
  hookEdits.clear(); lastHookId = d.hook?.candidateId || null;
  renderQuizzes(d.quiz);
  renderMeaningSpeech(d.meaningSpeech || {}, d.meaningDisplay || {});
  $('story-chinese').checked = d.storyChinese?.mode === 'subtitle'; $('story-chinese-seconds').value = d.storyChinese?.seconds || 2;
  renderSourceDisplay(d.sourceDisplayOnly || []);
  renderProductionDecisions(d.production || null);
  snapshot();
  $('draft-status').textContent = `${draft.contentId} · 第 ${draft.revision} 次保存 · ${new Date(draft.updatedAt).toLocaleString()}`;
  $('progress').value = ['draft', 'configured', 'compiled', 'validated', 'voice_planned'].indexOf(draft.status) + 1;
  renderProduction();
  window.StudioProduction?.show(draft);
  if (draft.sourceHash !== detail.record.sourceHash) message('來源已變更，這份草稿無法再保存；請建立新草稿。');
}
async function refreshDrafts() {
  const data = await api('/api/drafts'); const selected = draft?.id || $('drafts').value;
  $('drafts').replaceChildren(new Option('選擇草稿', ''));
  for (const d of data.drafts) $('drafts').add(new Option(`${d.contentId} · ${d.status} · ${new Date(d.updatedAt).toLocaleString()} · ${d.id.slice(0, 8)}`, d.id));
  $('drafts').value = selected;
}
async function resume(id) {
  draft = await api(`/api/drafts/${id}`); await loadContent(draft.contentId); $('content').value = draft.contentId; dirty = false; renderEditor(); localStorage.setItem('videoStudioDraft', draft.id); message(draft.sourceHash === detail.record.sourceHash ? '已載入上次保存的草稿。' : '文章原文已變，這份草稿不能繼續製作；請建立新草稿。');
}
function action(fn) { return async e => { try { await fn(e); } catch (error) { if (error.status === 409 && draft) { refreshRequired = true; renderProduction(); } message(error.message); } }; }
$('pack').onchange = renderList; $('search').oninput = renderList;
$('content').onchange = action(async () => { if (!guard()) { $('content').value = draft?.contentId || ''; return; } if (!$('content').value) return; await loadContent($('content').value); draft = null; dirty = false; $('editor').hidden = true; window.StudioWizard?.bind(null, false); message('文章已載入，按「建立新草稿」開始。'); });
$('create').onclick = action(async () => { if (!guard()) return; draft = await api('/api/drafts', 'POST', { contentId: detail.record.post.id, sourceHash: detail.record.sourceHash }); renderEditor(); dirty = false; localStorage.setItem('videoStudioDraft', draft.id); await refreshDrafts(); message('新草稿已保存到磁碟。'); });
$('resume').onclick = action(async () => { if ($('drafts').value && guard()) await resume($('drafts').value); });
$('use-suggestions').onclick = () => { const s = detail.suggestions; $('series').value = s.series; $('episode').value = draft.decisions.series === s.series && draft.decisions.seriesEpisode ? draft.decisions.seriesEpisode : s.seriesEpisode; $('min').value = s.level?.min || ''; $('max').value = s.level?.max || ''; markDirty(); message('已採用建議，請保存。'); };
$('series').addEventListener('change', () => { const series=$('series').value; $('episode').value=series===draft.decisions.series&&draft.decisions.seriesEpisode?draft.decisions.seriesEpisode:detail.seriesProgress?.[series]?.nextEpisode||''; markDirty(); });
// the 2B panel's review / confirmation controls are actions, not draft decisions
$('editor').oninput = e => { if (e.target.closest('#p2b')) return; if (e.target.closest('#meaning-speech')) updateMeaningWarnings(); markDirty(); if (e.target.closest('#pd-fields') || e.target.id === 'pd-enabled') updateProductionDecisionHints(); };
$('hooks').onchange = e => { const selected = e.target.value; if (!selected) return; if (lastHookId) hookEdits.set(lastHookId, $('hook-text').value); $('hook-text').value = hookEdits.get(selected) || detail.candidates.hooks.find(h => h.id === selected).text; lastHookId = selected; markDirty(); };
$('vocabulary').onchange = () => { const speech = readMeaningSpeech(), display = readMeaningDisplay(), quiz = quizChoices.get(document.querySelector('input[name=quiz]:checked')?.value); renderQuizzes(quiz); renderMeaningSpeech(speech, display); markDirty(); };
async function saveDraft() {
  if (saving) throw Error('正在保存，請稍候。');
  saving = true; $('editor').inert = true;
  $('save').disabled = true;
  try {
    draft = await api(`/api/drafts/${draft.id}`, 'PUT', { revision: draft.revision, decisions: formDecisions() }); saveError = null; renderEditor(); await refreshDrafts(); message('已保存到磁碟；關閉瀏覽器或重啟 Studio 後可繼續。');
  } catch (error) { saveError = error.message; renderProduction(); throw error; }
  finally { saving = false; $('editor').inert = false; $('save').disabled = !dirty; window.StudioWizard?.bind(draft, dirty); }
}
$('editor').onsubmit = action(async e => { e.preventDefault(); await saveDraft(); });
window.StudioEditor = { save: saveDraft, async reloadCurrent() { draft = await api(`/api/drafts/${draft.id}`); await loadContent(draft.contentId); renderEditor(); await refreshDrafts(); }, validateStep(step) {
  if (step === 'words' && (!$('series').value || !$('episode').value || !$('min').value || !$('max').value || !document.querySelector('input[name=vocab]:checked'))) return '請確認系列、集數、難度，並至少選一個教學單字。';
  if (step === 'meaning' && [...document.querySelectorAll('#meaning-speech [data-role=display]')].some(x => !x.value.trim())) return '畫面詞義不能空白，請填寫後繼續。';
  if (step === 'source' && $('story-chinese').checked && (!$('story-chinese-seconds').checkValidity())) return '每段中文字幕的停留時間請填 1 到 8 秒。';
  if (step === 'hook' && (!document.querySelector('input[name=hook]:checked') || !$('hook-text').value.trim())) return '請選一個開場句，並填寫開場英文。';
  if (step === 'quiz' && !document.querySelector('input[name=quiz]:checked')) return '請先選一個測驗題目。';
  if (step === 'settings' && (!$('pd-enabled').checked || !$('pd-policy').checked || !$('pd-timings').checked)) return '請開啟影片設定，並在「畫面節奏」確認版面與時間安排。';
  return null;
} };
const AUDIO_LABELS = { 'reference-music-v1': '使用預設配樂與答對音效', none: '只有旁白，不加配樂或音效' };
const sameSourceRange = (a, b) => ['version', 'contentId', 'sourceHash', 'from', 'to', 'text', 'textHash'].every(k => a?.[k] === b[k]);
function readSourceDisplayOnly() { return [...document.querySelectorAll('input[name=source-display]:checked')].map(i => sourceDisplayChoices.get(i.value)); }
function readStoryChinese() { return $('story-chinese').checked ? { mode: 'subtitle', seconds: Number($('story-chinese-seconds').value) } : null; }
function renderSourceDisplay(saved) {
  sourceDisplayChoices = new Map(); $('source-display').replaceChildren();
  const available = detail.displayOnlyCandidates || [];
  const items = [...saved.map((r, i) => ({ range: r, id: `saved-range-${i}`, checked: true })), ...available.filter(r => !saved.some(s => sameSourceRange(s, r))).map(r => ({ range: r, id: `source-range-${r.from}`, checked: false }))];
  for (const { range, id, checked } of items) {
    sourceDisplayChoices.set(id, range);
    const l = document.createElement('label'); l.className = 'choice';
    const input = document.createElement('input'); input.type = 'checkbox'; input.name = 'source-display'; input.value = id; input.checked = checked; input.disabled = !checked && /\[\[|\]\]/.test(range.text);
    const stale = !available.some(c => sameSourceRange(range, c));
    l.append(input, document.createTextNode(`${stale ? '這段需要重新確認 · ' : ''}畫面保留、不朗讀：${range.text}`)); $('source-display').append(l);
  }
  updateSourceDisplayStatus();
}
function updateSourceDisplayStatus() {
  const selected = readSourceDisplayOnly(), stale = selected.some(r => !detail.displayOnlyCandidates.some(c => sameSourceRange(r, c)));
  $('story-chinese-timing').hidden = !$('story-chinese').checked;
  updateHookReadingHint();
  $('source-display-status').textContent = stale ? '原文已變，請取消舊選擇並重新確認；若文章整體變更，請建立新草稿。' : $('story-chinese').checked ? `原文中文不朗讀，每段停留 ${$('story-chinese-seconds').value} 秒；英文與詞義教學照常朗讀。保存後生效。` : selected.length ? `已選 ${selected.length} 段只顯示、不朗讀；保存後生效。` : '原文含中文時，勾選上面的「中文只顯示成字幕」才能繼續製作。';
}
function updateHookReadingHint() {
  const text = $('hook-text').value;
  $('hook-reading-hint').textContent = /\p{Script=Han}/u.test(text) ? ($('story-chinese').checked ? `開場中文留在畫面，先停留 ${$('story-chinese-seconds').value} 秒，再只朗讀英文。` : '開場含中文：到「原文朗讀」勾選中文只顯示，中文就會留在畫面，英文才會朗讀。') : '開場畫面文字會使用英文旁白朗讀。';
}
$('hook-text').addEventListener('input', updateHookReadingHint);
$('hooks').addEventListener('change', updateHookReadingHint);
function renderSentenceTranslations() {
  const selected = readSourceDisplayOnly().filter(r => detail.displayOnlyCandidates.some(c => sameSourceRange(r, c)));
  const proposal = $('story-chinese').checked ? detail.subtitleProposal || detail.productionProposal : detail.productionProposal;
  $('pd-sentences').replaceChildren();
  for (const s of ($('story-chinese').checked ? detail.subtitleSentences || detail.sentences : detail.sentences).filter(s => !selected.some(r => r.from === s.displayOnlyRangeFrom))) {
    const label = document.createElement('label'); label.textContent = `英文原句：${s.text}`;
    const proposed = ($('story-chinese').checked ? detail.subtitleProposal : null)?.translations.items[s.id] || detail.productionProposal.translations.items[s.id];
    const edited = translationEdits[s.id], item = edited?.sourceTextHash === proposed?.sourceTextHash && edited.text?.trim() ? edited : proposed;
    const t = document.createElement('textarea'); t.rows = 2; t.dataset.id = s.id; t.dataset.hash = item.sourceTextHash; t.value = item.text ?? ''; t.placeholder = '自動帶入來源中文；需要時可以修改';
    label.append(t); $('pd-sentences').append(label);
  }
  $('pd-reference').textContent = proposal.translations.prefill?.status === 'mapped' ? `已自動帶入 ${$('pd-sentences').children.length} 句的中文翻譯。${$('story-chinese').checked ? '原文中文直接顯示，不重複翻譯。' : ''}可以直接繼續，需要時再修改文字。` : '這篇的來源中文暫時無法逐句對應。請先選擇不顯示逐句翻譯，原文中文字幕仍會保留。';
}
$('source-display').onchange = () => {
  for (const t of document.querySelectorAll('#pd-sentences textarea')) translationEdits[t.dataset.id] = { text: t.value, sourceTextHash: t.dataset.hash };
  renderSentenceTranslations(); updateSourceDisplayStatus(); markDirty();
};
$('story-chinese').onchange = $('source-display').onchange;
$('story-chinese-seconds').oninput = () => { updateSourceDisplayStatus(); markDirty(); };
function renderProductionDecisions(saved) {
  const p = saved || detail.productionProposal, o = p.outro;
  $('pd-enabled').checked = Boolean(saved);
  for (const [id, value] of [['pd-lead', o.lead], ['pd-cta', o.cta], ['pd-status', o.status], ['pd-phase', o.phase], ['pd-duration', o.duration], ['pd-scroll', o.scrollDuration], ['pd-offset', o.offset]]) $(id).value = value;
  $('pd-audio').replaceChildren();
  for (const [value, label] of Object.entries(AUDIO_LABELS)) { const l = document.createElement('label'); l.className = 'choice'; const i = document.createElement('input'); i.type = 'radio'; i.name = 'pd-audio'; i.value = value; i.checked = p.audio.preset === value; l.append(i, document.createTextNode(label)); $('pd-audio').append(l); }
  for (const r of document.querySelectorAll('input[name=pd-translation]')) r.checked = r.value === p.translations.mode;
  translationEdits = { ...($('story-chinese').checked ? detail.subtitleProposal || detail.productionProposal : detail.productionProposal).translations.items, ...saved?.translations?.items };
  renderSentenceTranslations();
  const policy = detail.productionProposal.policy;
  $('pd-policy-text').textContent = '我同意使用這支影片的建議版面：文字保持可讀，鏡頭不倒退；若畫面檢查失敗，系統會停下來讓我修改。';
  $('pd-timings-text').textContent = '我同意使用這支影片的建議節奏：句間停頓、單字教學和測驗時間。';
  $('pd-policy').checked = Boolean(saved); $('pd-timings').checked = Boolean(saved);
  updateProductionDecisionHints();
}
function updateProductionDecisionHints() {
  $('pd-fields').hidden = !$('pd-enabled').checked;
  const cue = Number($('pd-duration').value) - Number($('pd-scroll').value) - 0.45;
  $('pd-cue').textContent = `吉祥物會停留到接近片尾結束（依目前片尾長度，自動安排 ${cue.toFixed(2)} 秒）。`;
  $('pd-sentences').hidden = document.querySelector('input[name=pd-translation]:checked')?.value !== 'per-sentence';
}
function readProductionDecisions() {
  if (!$('pd-enabled').checked) return null;
  const policy = detail.productionProposal.policy, mode = document.querySelector('input[name=pd-translation]:checked')?.value || null;
  return {
    version: detail.productionProposal.version,
    outro: { lead: $('pd-lead').value, cta: $('pd-cta').value, status: $('pd-status').value, phase: $('pd-phase').value, duration: Number($('pd-duration').value), scrollDuration: Number($('pd-scroll').value), offset: Number($('pd-offset').value) },
    audio: { preset: document.querySelector('input[name=pd-audio]:checked')?.value || null },
    translations: { mode, items: mode === 'per-sentence' ? Object.fromEntries([...document.querySelectorAll('#pd-sentences textarea')].map(t => [t.dataset.id, { text: t.value, sourceTextHash: t.dataset.hash }])) : {} },
    confirmations: { visualPolicyVersion: $('pd-policy').checked ? policy.version : null, timingsVersion: $('pd-timings').checked ? detail.timingsVersion : null },
  };
}
function readMeaningSpeech() { return Object.fromEntries([...document.querySelectorAll('#meaning-speech textarea[data-role=spoken]')].map(i => [i.dataset.key, i.value])); }
function readMeaningDisplay() { return Object.fromEntries([...document.querySelectorAll('#meaning-speech textarea[data-role=display]')].map(i => [i.dataset.key, i.value])); }
function updateMeaningWarnings() {
  for (const row of document.querySelectorAll('.meaning-row')) {
    const spoken = row.querySelector('[data-role=spoken]'), display = row.querySelector('[data-role=display]'), source = row.dataset.source;
    row.querySelector('.meaning-warning').textContent = (spoken.value.trim() || source) !== display.value.trim() ? '⚠ 畫面文字和朗讀文字不同。請確認這是你要的結果。' : '畫面與朗讀一致。';
  }
}
function renderMeaningSpeech(values, displayValues = {}) {
  $('meaning-speech').replaceChildren();
  const keys = [...document.querySelectorAll('input[name=vocab]:checked')].map(i => i.value);
  for (const v of detail.record.vocabulary.filter(v => keys.includes(v.key))) {
    const row = document.createElement('div'); row.className = 'meaning-row'; row.dataset.source = v.zh;
    const title = document.createElement('h3'); title.textContent = `${v.word} · 來源詞義：${v.zh}`;
    const fields = document.createElement('div'); fields.className = 'row';
    const shownLabel = document.createElement('label'); shownLabel.textContent = '畫面顯示文字';
    const shown = document.createElement('textarea'); shown.rows = 2; shown.dataset.key = v.key; shown.dataset.role = 'display'; shown.value = displayValues[v.key] || v.zh; shownLabel.append(shown);
    const spokenLabel = document.createElement('label'); spokenLabel.textContent = 'Ling 朗讀文字';
    const spoken = document.createElement('textarea'); spoken.rows = 2; spoken.dataset.key = v.key; spoken.dataset.role = 'spoken'; spoken.value = values[v.key] || ''; spoken.placeholder = `留空就唸來源詞義：${v.zh}`; spokenLabel.append(spoken);
    fields.append(shownLabel, spokenLabel);
    const warning = document.createElement('p'); warning.className = 'meaning-warning'; warning.setAttribute('role', 'status');
    const sync = document.createElement('button'); sync.type = 'button'; sync.textContent = '讓畫面文字與朗讀一致'; sync.onclick = () => { shown.value = spoken.value.trim() || v.zh; updateMeaningWarnings(); markDirty(); };
    row.append(title, fields, warning, sync); $('meaning-speech').append(row);
  }
  updateMeaningWarnings();
}
function resultIssues(container, title, values) {
  if (!values?.length) return;
  const heading = document.createElement('strong'); heading.textContent = title; container.append(heading);
  const list = document.createElement('ul');
  for (const value of values) { const li = document.createElement('li'); li.textContent = value.message; list.append(li); }
  container.append(list);
}
function renderProduction() {
  if (!draft) return;
  if (refreshRequired) {
    $('production-summary').textContent = '資料已失效或有保存衝突；請用「載入草稿」恢復 authoritative state，舊 production 結果不可使用。';
    $('production-notice').textContent = '保留未保存表單，沒有自動改寫選擇。重新載入後確認來源 / Quiz。';
    for (const id of ['run-production', 'compile', 'validate', 'voice-plan']) $(id).disabled = true;
    $('production-results').replaceChildren(); $('voice-summary').replaceChildren(); $('artifact-links').replaceChildren();
    return;
  }
  const names = { compile: '整理影片內容', validation: '檢查內容', voicePlan: '計算語音需求' };
  const step = name => draft.steps?.find(s => s.name === name);
  const complete = Boolean(draft.decisions.series && draft.decisions.seriesEpisode && draft.decisions.level && draft.decisions.vocabulary.length && draft.decisions.hook && draft.decisions.quiz);
  const sourceStale = draft.sourceHash !== detail.record.sourceHash;
  const quizStale = draft.quizReview?.status === 'needs_confirmation';
  const displayStale = draft.sourceDisplayReview?.status === 'needs_confirmation';
  const stale = sourceStale || draft.workflow?.status === 'stale';
  $('production-summary').textContent = `內容設定 ${complete ? '✓' : '待完成'} · ${Object.keys(names).map(k => `${names[k]} ${step(k)?.status === 'succeeded' ? '✓' : step(k)?.status === 'failed' ? '需要修改' : '尚未執行'}`).join(' · ')}`;
  const disabled = dirty || !complete || sourceStale || quizStale || displayStale;
  $('run-production').disabled = disabled; $('compile').disabled = disabled;
  $('validate').disabled = disabled || stale || step('compile')?.status !== 'succeeded';
  $('voice-plan').disabled = disabled || stale || step('validation')?.status !== 'succeeded';
  $('production-notice').textContent = displayStale ? '原文顯示設定已過期。請重新檢查要顯示的段落並保存。' : quizStale ? '測驗題的來源或選項已變更。請重新選題並保存。' : dirty ? `有未保存修改；先保存，才能繼續免費檢查。${saveError ? `上次保存失敗：${saveError}` : ''}` : stale ? '內容或製作設定已改變。請重新執行免費檢查；若文章原文已改，請建立新草稿。' : draft.workflow?.failedStep ? `停在「${names[draft.workflow.failedStep] || draft.workflow.failedStep}」。請查看下方原因並修改。` : '完成免費檢查後，會清楚列出是否需要產生新語音。';
  $('production-results').replaceChildren();
  for (const entry of draft.steps || []) {
    const box = document.createElement('details'); box.open = entry.status === 'failed';
    const summary = document.createElement('summary'); summary.textContent = `${names[entry.name] || entry.name} · ${entry.result?.verdict || entry.status} · ${entry.finishedAt ? new Date(entry.finishedAt).toLocaleString() : '執行中'}`; box.append(summary);
    const r = entry.result || {};
    resultIssues(box, '需要處理', r.errors); resultIssues(box, '尚未完成的設定', (r.blocked || []).map(x => x.code === 'MIXED_STORY_LANGUAGE' ? { ...x, message: '到「原文朗讀」勾選「中文只顯示成字幕」，設定停留秒數並保存，再回來執行免費檢查。' } : x)); resultIssues(box, '請留意', r.warnings);
    const later = (r.unresolved || []).filter(x => ['camera', 'audit', 'review'].includes(x.resolvedBy));
    resultIssues(box, '尚未完成的設定', (r.unresolved || []).filter(x => !later.includes(x)));
    if (later.length) { const p = document.createElement('p'); p.textContent = '影片產生後，系統會自動檢查文字是否完整入鏡；最後再請你看影片、聽接句。目前不用處理這些項目。'; box.append(p); }
    const raw = document.createElement('details'); raw.append(document.createElement('summary')); raw.firstChild.textContent = '技術資料'; const pre = document.createElement('pre'); pre.textContent = JSON.stringify(entry, null, 2); raw.append(pre); box.append(raw); $('production-results').append(box);
  }
  $('voice-summary').replaceChildren();
  const plan = step('voicePlan')?.status === 'succeeded' ? step('voicePlan').result : null;
  if (plan) {
    const description = document.createElement('p'); description.textContent = `免費初步規劃：${plan.counts.miss ? `最多可能需要 ${plan.counts.miss} 段新語音，約 ${plan.charsToGenerate} 個字元。` : '目前看來所有語音都能沿用。'}這一步沒有送出請求。若你先前選過重錄版本，請再按下方「免費查看這次需要多少新語音」，系統會核對封存音訊後顯示準確的請求數。`; $('voice-summary').append(description);
    const more = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = '查看每段語音與計算方式'; more.append(summary);
    const list = document.createElement('ul');
    for (const s of plan.segments) { const li = document.createElement('li'); li.textContent = `${s.id} · ${s.status === 'miss' ? '需要新語音' : s.status === 'hit' ? '沿用既有語音' : s.status === 'silent' ? '不朗讀' : s.status} · ${s.chars} 字元`; list.append(li); }
    more.append(list); const technical = document.createElement('p'); technical.textContent = plan.cacheMeaning; more.append(technical); $('voice-summary').append(more);
  }
  $('artifact-links').replaceChildren();
  for (const name of Object.keys(draft.artifacts || {})) {
    const link = document.createElement('a'); link.href = `/api/drafts/${draft.id}/artifacts/${name}`; link.target = '_blank'; link.rel = 'noopener'; link.textContent = `查看 ${name} JSON`; $('artifact-links').append(link, document.createElement('br'));
  }
}
for (const [button, operation] of [['run-production', 'run'], ['compile', 'compile'], ['validate', 'validation'], ['voice-plan', 'voicePlan']]) {
  $(button).onclick = action(async () => {
    if (dirty) { message('請先保存修改。'); return; }
    for (const id of ['run-production', 'compile', 'validate', 'voice-plan']) $(id).disabled = true;
    message('正在編譯 / 驗證 / 免費規劃；不生成語音…');
    try {
      draft = await api(`/api/drafts/${draft.id}/workflow`, 'POST', { revision: draft.revision, action: operation });
      await loadContent(draft.contentId); renderEditor(); await refreshDrafts();
      message(draft.workflow?.failedStep ? '免費檢查停住了。請看下方原因，修改後再試。' : '免費檢查完成，尚未產生語音。請查看下方需求，再決定是否繼續。');
    } finally { renderProduction(); }
  });
}
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
action(async () => { contents = (await api('/api/contents')).contents; renderList(); await refreshDrafts(); const query=new URLSearchParams(location.search),last = query.get('draft')||localStorage.getItem('videoStudioDraft'); if (last && [...$('drafts').options].some(o => o.value === last)) {await resume(last);if(query.has('review'))window.StudioWizard?.show('review');} else message(`已載入 ${contents.length} 篇真實文章。`); })();
