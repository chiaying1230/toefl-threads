// Fixed workspace: navigation changes presentation only; draft decisions stay in the same form.
(() => {
  const $ = id => document.getElementById(id);
  const make = (tag, text, cls) => { const node = document.createElement(tag); if (text) node.textContent = text; if (cls) node.className = cls; return node; };
  const main = document.querySelector('main'), form = $('editor');
  const topSections = [...main.children].filter(n => n.tagName === 'SECTION');
  const sections = [...form.children].filter(n => n.tagName === 'SECTION');
  const byTitle = text => sections.find(n => n.querySelector('h2')?.textContent.includes(text));
  const production = $('p2b');
  const reviewPage = make('section', null, 'wizard-page'); reviewPage.append(make('h2', '看影片，確認成果'), make('p', '看完並聽過影片，沒問題就按一次確認。需要修改也可以在這裡記下來。', 'page-intro'), $('p2b-review'), $('p2b-promotion'));
  production.append(reviewPage);
  const completePage = make('section', null, 'wizard-page'), complete = make('div'); complete.id = 'p2b-complete'; completePage.append(complete); production.append(completePage);
  const voicePage = make('section', null, 'wizard-page');
  for (const child of [...production.children]) if (child !== reviewPage && child !== completePage) voicePage.append(child);
  production.prepend(voicePage); production.className = 'production-wrapper';
  const stepDetails = make('details'); stepDetails.append(make('summary', '查看製作進度與檢查紀錄'), $('p2b-steps')); voicePage.append(stepDetails);
  const articlePage = topSections[1]; articlePage.prepend(topSections[0]);
  const saveSection = byTitle('保存與進度');
  const save = $('save'); save.type = 'button'; save.onclick = () => form.requestSubmit();
  const steps = [
    ['article', '文章', '選一篇文章，或繼續上次草稿', articlePage],
    ['words', '教學單字', '挑這支影片要教的單字', byTitle('系列與單字')],
    ['meaning', '詞義文字', '確認觀眾看到的字與旁白唸的字', byTitle('詞義：')],
    ['hook', '開場句', '選一句讓人想繼續看的開頭', byTitle('開場句')],
    ['quiz', '小測驗', '確認題目與答案', byTitle('小測驗')],
    ['source', '原文朗讀', '決定哪些原文只顯示、不朗讀', byTitle('原文：')],
    ['settings', '影片設定', '片尾、配樂、中文翻譯和節奏', byTitle('影片設定')],
    ['free', '免費檢查', '保存內容，檢查能不能製作', byTitle('免費檢查')],
    ['voice', '語音與製作', '先看語音需求，再決定是否產生', voicePage],
    ['review', '最後檢查', '看完影片，確認是否完成', reviewPage],
    ['complete', '完成', '影片已保存，現在可以播放或下載', completePage],
  ];
  let current = 0, draft = null, dirty = false, busy = false, productionView = null, completionRun = null;
  document.querySelector('.journey-nav')?.remove();
  const header = document.querySelector('header'), brand = make('div', null, 'brand');
  header.classList.add('studio-header');
  const studioIcon = make('img'); studioIcon.src = '/studio-cover.png'; studioIcon.alt = ''; studioIcon.width = 42; studioIcon.height = 42;
  brand.append(studioIcon, document.createTextNode('toEfu'));
  header.replaceChildren(brand, make('span', '影片工作室', 'brand-title'), make('span', '每一步，清楚完成', 'brand-note'));
  const library=make('a','影片資料夾');library.href='/videos';library.target='_blank';library.rel='noopener';header.append(library);
  const batch=make('a','批量產生');batch.href='/batch';batch.target='_blank';batch.rel='noopener';header.append(batch);
  const shell = make('div', null, 'workspace-shell'), sidebar = make('nav', null, 'step-sidebar'); sidebar.setAttribute('aria-label', '影片製作步驟');
  const workspace = make('div', null, 'workspace'), pageHeader = make('div', null, 'page-heading');
  const count = make('span', null, 'step-count'), title = make('h1'), intro = make('p'); title.tabIndex = -1; pageHeader.append(count, title, intro);
  const viewport = make('div', null, 'page-viewport'); viewport.append(articlePage, form); main.append(viewport);
  const footer = make('footer', null, 'workspace-footer'), status = make('div', null, 'save-state'), controls = make('div', null, 'footer-controls');
  const back = make('button', '上一步', 'secondary'), next = make('button', '下一步', 'primary'); back.type = next.type = 'button';
  const progress = $('progress'), draftStatus = $('draft-status');
  const unsaved = make('strong', '有未保存修改', 'unsaved-label'); unsaved.hidden = true;
  status.append(unsaved, draftStatus, progress); progress.hidden = true; controls.append(back, save, next); footer.append(status, controls);
  saveSection.remove();
  workspace.append(pageHeader, $('message'), viewport, footer); shell.append(sidebar, workspace); main.append(shell);
  const buttons = steps.map(([id, name], i) => { const b = make('button', null, 'step-link'); b.type = 'button'; b.append(make('span', String(i + 1).padStart(2, '0'), 'step-number'), make('span', name)); b.onclick = () => show(i); sidebar.append(b); return b; });
  for (const [id, , , page] of steps) { page.classList.add('wizard-page'); page.dataset.step = id; }
  function show(index, focus = true) {
    if (index < 0 || index >= steps.length || (index > 0 && !draft) || (steps[index][0] === 'complete' && !productionView?.readiness.productionReady)) return;
    const changedPage = current !== index;
    current = index;
    steps.forEach((s, i) => { s[3].hidden = i !== index; buttons[i].classList.toggle('active', i === index); buttons[i].disabled = (i > 0 && !draft) || (s[0] === 'complete' && !productionView?.readiness.productionReady); if (i === index) buttons[i].setAttribute('aria-current', 'step'); else buttons[i].removeAttribute('aria-current'); });
    count.textContent = `步驟 ${index + 1} / ${steps.length}`; title.textContent = steps[index][1]; intro.textContent = steps[index][2];
    back.disabled = index === 0 || busy; save.hidden = !draft; save.disabled = !dirty || busy;
    next.hidden = index === steps.length - 1; next.disabled = !draft || busy || (index === 8 && !productionView?.readiness.canReview) || (index === 9 && !productionView?.readiness.productionReady);
    next.textContent = index === 6 && dirty ? '保存並進入免費檢查' : index === 7 ? '查看語音需求' : index === 8 ? (productionView?.readiness.canReview ? '去看影片' : '影片尚未完成') : index === 9 ? (productionView?.readiness.productionReady ? '查看完成結果' : '請先完成驗收') : '下一步';
    unsaved.hidden = !dirty;
    header.querySelector('.brand-note').textContent = draft ? (dirty ? '未保存修改' : '已保存') : '本機製作';
    if (draft) localStorage.setItem(`studioStep:${draft.id}`, steps[index][0]);
    if (changedPage || focus) { buttons[index].scrollIntoView({ block: 'nearest', inline: 'nearest' }); viewport.scrollTop = 0; }
    if (focus) title.focus({ preventScroll: true });
    if (index === 9 && !$('p2b-review').children.length) {
      if (!$('review-empty')) { const empty = make('p', '影片還沒製作完成。請先到「語音與製作」查看進度；完成檢查後，影片會出現在這裡。', 'empty-state'); empty.id = 'review-empty'; reviewPage.append(empty); }
    } else $('review-empty')?.remove();
  }
  back.onclick = () => show(current - 1);
  next.onclick = async () => {
    if (busy) return;
    const problem = window.StudioEditor?.validateStep(steps[current][0]);
    if (problem) { $('message').textContent = problem; return; }
    if (dirty && current >= 6) {
      busy = true; show(current, false);
      try { await window.StudioEditor.save(); } catch (e) { $('message').textContent = e.message; busy = false; show(current, false); return; }
      busy = false;
    }
    if (current === 7 && draft?.status !== 'voice_planned') { $('message').textContent = '請先按「免費檢查並規劃語音」，完成後再繼續。'; show(current, false); return; }
    show(current + 1);
  };
  // Each long editor is a small paged workspace, rather than a list requiring a long scroll.
  function pager(container, select, label, perPage = 1) {
    let active = 0; const nav = make('div', null, 'item-navigation');
    const prev = make('button', perPage > 1 ? '上一頁' : '上一項', 'secondary'), info = make('span'), following = make('button', perPage > 1 ? '下一頁' : '下一項', 'secondary'); prev.type = following.type = 'button'; nav.append(prev, info, following); container.before(nav);
    function render() { const items = [...container.querySelectorAll(select)], pages = Math.ceil(items.length / perPage); active = Math.min(active, Math.max(0, pages - 1)); items.forEach((n, i) => n.hidden = Math.floor(i / perPage) !== active); nav.hidden = container.hidden || pages < 2; info.textContent = `${label} ${active + 1} / ${pages}`; prev.disabled = active === 0; following.disabled = active >= pages - 1; }
    prev.onclick = () => { active--; render(); }; following.onclick = () => { active++; render(); };
    new MutationObserver(render).observe(container, { childList: true, attributes: true, attributeFilter: ['hidden'] }); render();
  }
  pager($('vocabulary'), ':scope > .choice', '單字候選', 4);
  pager($('source-display'), ':scope > .choice', '原文段落', 2);
  pager($('meaning-speech'), ':scope > .meaning-row', '單字');
  pager($('pd-sentences'), ':scope > label', '句子');
  const fieldsets = [...$('pd-fields').children].filter(n => n.tagName === 'FIELDSET');
  const tabs = make('div', null, 'setting-tabs'); $('pd-fields').prepend(tabs);
  fieldsets.forEach((f, i) => { const b = make('button', ['片尾', '配樂', '中文翻譯', '畫面節奏'][i]); b.type = 'button'; b.onclick = () => { fieldsets.forEach((x, k) => x.hidden = k !== i); [...tabs.children].forEach((x, k) => x.classList.toggle('active', k === i)); }; tabs.append(b); f.hidden = i !== 0; if (!i) b.classList.add('active'); });
  new MutationObserver(() => { if ($('p2b-review').children.length) $('review-empty')?.remove(); }).observe($('p2b-review'), { childList: true });
  window.StudioWizard = {
    bind(value, changed) { const different = draft?.id !== value?.id, revised = draft?.revision !== value?.revision; draft = value; dirty = changed; if (different || revised) productionView = null; if (different && draft) { const saved = localStorage.getItem(`studioStep:${draft.id}`); const index = steps.findIndex(s => s[0] === saved); current = index >= 0 ? index : 1; } if (!draft) current = 0; show(current, false); },
    show(id) { show(steps.findIndex(s => s[0] === id)); },
    current() { return steps[current][0]; },
    production(value) { productionView = value; if (value?.readiness.productionReady && value.review?.status === 'accepted' && completionRun !== value.run.runId) { completionRun = value.run.runId; current = steps.length - 1; } else if (!value?.readiness.productionReady) { completionRun = null; if (steps[current][0] === 'complete') current = 9; } show(current, false); },
  };
  show(0, false);
})();
