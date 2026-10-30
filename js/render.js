function stepWidth(step) {
  let w = 1;
  for (const k of Object.keys(step.notes || {})) {
    w = Math.max(w, String(step.notes[k]).length);
  }
  return w;
}
function tabToAscii(tab, wrapAt) {
  ensureTabStrings(tab);
  const per = wrapAt || tab.wrap || 28;
  const labels = [];
  for (let s = 1; s <= tab.stringCount; s++) labels.push(strLabel(tab, s));
  if (!tab.steps.length) {
    return labels.map((l) => `${l}|--------------------------------`).join('\n');
  }
  const chunks = [];
  for (let i = 0; i < tab.steps.length; i += per) chunks.push(tab.steps.slice(i, i + per));
  const outLines = [];
  chunks.forEach((chunk) => {
    for (let s = 1; s <= tab.stringCount; s++) {
      let line = labels[s - 1] + '|';
      // leading dash like classic tabs
      line += '-';
      chunk.forEach((st) => {
        const w = stepWidth(st);
        const fret = st.notes ? st.notes[String(s)] : undefined;
        const cell = (fret === undefined || fret === null || fret === '') ? '-'.repeat(w) : String(fret).padEnd(w, '-');
        line += cell + '--';
      });
      outLines.push(line);
    }
    outLines.push('');
  });
  return outLines.join('\n').trimEnd();
}
function projectToAscii(proj) {
  return proj.tabs.map((t) => `### ${t.name}\n${t.description ? '(' + t.description + ')\n' : ''}${tabToAscii(t, t.wrap || 28)}`).join('\n\n');
}
function projectToRtf(proj) {
  return rtfDoc(proj.tabs.map((t) => `### ${t.name}\n${t.description ? '(' + t.description + ')\n' : ''}${tabToAscii(t, t.wrap || 28)}`));
}
function tabStats(tab) {
  let notes = 0;
  (tab.steps || []).forEach((s) => { notes += Object.keys(s.notes || {}).length; });
  return { notes, steps: (tab.steps || []).length };
}

function applyTheme() {
  const th = localStorage.getItem(LS_THEME) || 'dark';
  document.documentElement.setAttribute('data-theme', th);
}

function renderDashboard(filter) {
  const list = $('project-list');
  list.innerHTML = '';
  const q = (filter || '').toLowerCase();
  const shown = projects.filter((p) => !q || p.name.toLowerCase().includes(q));
  if (!shown.length) {
    list.innerHTML = '<p class="muted" style="padding:20px">No projects yet — hit “+ New Project”.</p>';
    return;
  }
  shown.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'project-card';
    const totalNotes = p.tabs.reduce((a, t) => a + tabStats(t).notes, 0);
    card.innerHTML = `
      <div class="mini-tab" title="Open">${miniTabHTML(p.tabs[0])}</div>
      <div class="project-meta"><h3></h3><div class="sub">📅 ${p.updatedAt} &nbsp;•&nbsp; 🎸 ${p.tabs.length} Tab(s) · ${totalNotes} notes</div></div>
      <div class="project-actions">
        <button class="btn btn-ghost act-open">Open</button>
        <button class="btn btn-ghost act-export">Export</button>
        <button class="btn btn-ghost act-rename">Rename</button>
        <button class="btn btn-del act-del">Delete</button>
      </div>`;
    card.querySelector('h3').textContent = p.name;
    card.querySelector('.mini-tab').onclick = () => openProject(p.id);
    card.querySelector('h3').onclick = () => openProject(p.id);
    card.querySelector('.act-open').onclick = () => openProject(p.id);
    card.querySelector('.act-rename').onclick = () => renameProject(p.id);
    card.querySelector('.act-del').onclick = () => deleteProject(p.id);
    card.querySelector('.act-export').onclick = () => exportProject(p.id);
    list.appendChild(card);
  });
}
function miniTabHTML(tab) {
  ensureTabStrings(tab);
  if (!tab) return '<div class="ml"></div>'.repeat(6);
  let html = '';
  const sample = (tab.steps || []).slice(0, 14);
  for (let s = 1; s <= tab.stringCount; s++) {
    let dots = '';
    sample.forEach((st, i) => {
      if (st.notes && st.notes[String(s)] !== undefined) {
        dots += `<i style="left:${8 + i * 4}px"></i>`;
      }
    });
    html += `<div class="ml">${dots}</div>`;
  }
  return html;
}

function openProject(id) {
  currentProjectId = id;
  const p = getProject();
  if (!p || !p.tabs.length) p.tabs.push(newTab('Intro'));
  currentTabId = p.tabs[0].id;
  cursorPos = getTab().steps.length;
  chordAnchor = -1;
  selected = null;
  undoStack = []; redoStack = [];
  showView('editor');
  renderEditor();
  $('staff-scroll').focus();
}
function showView(which) {
  $('view-dashboard').classList.toggle('hidden', which !== 'dashboard');
  $('view-editor').classList.toggle('hidden', which !== 'editor');
}

function renderEditor() {
  const p = getProject();
  const t = getTab();
  if (!p || !t) { showView('dashboard'); renderDashboard(); return; }
  $('editor-project-name').textContent = p.name;
  if (document.activeElement !== $('tab-name')) $('tab-name').value = t.name;
  $('tab-name-count').textContent = t.name.length;
  if (document.activeElement !== $('tab-desc')) $('tab-desc').value = t.description || '';
  $('tab-desc-count').textContent = (t.description || '').length;
  $('setting-wrap').value = t.wrap || 28;
  if (document.activeElement !== $('setting-strings')) $('setting-strings').value = t.stringCount || 6;
  cursorPos = Math.max(0, Math.min(cursorPos, t.steps.length));
  renderStringPicker();
  renderStaff();
  renderTabList();
  renderNumpad();
  $('ascii-preview').textContent = tabToAscii(t, t.wrap || 28);
  $('hint-string').textContent = t.activeString;
}

function renderStringPicker() {
  const t = getTab();
  const wrap = $('string-picker');
  wrap.innerHTML = '';
  for (let s = 1; s <= t.stringCount; s++) {
    const lab = strLabel(t, s);
    const b = document.createElement('button');
    b.className = 'sp-btn' + (t.activeString === s ? ' active' : '');
    b.innerHTML = `${escapeHtml(lab)}<small>${s}</small>`;
    b.title = `String ${s} (${lab}) — Shift+${s} or press ${lab[0].toUpperCase()}`;
    b.onclick = () => { pushUndo(); t.activeString = s; lastDigitTime = 0; touch(); renderEditor(); $('staff-scroll').focus(); };
    wrap.appendChild(b);
  }
}

function renderStaff() {
  const t = getTab();
  const staff = $('staff');
  staff.innerHTML = '';
  $('staff-empty').classList.toggle('hidden', t.steps.length > 0);
  for (let s = 1; s <= t.stringCount; s++) {
    const row = document.createElement('div');
    row.className = 'srow' + (t.activeString === s ? ' active' : '');
    const lab = document.createElement('div');
    lab.className = 'slabel';
    const labText = document.createElement('span');
    labText.textContent = strLabel(t, s);
    const labNum = document.createElement('span');
    labNum.className = 'snum';
    labNum.textContent = s;
    lab.appendChild(labText);
    lab.appendChild(labNum);
    lab.title = `String ${s} (${strLabel(t, s)}) — click to select (Shift+${s}), right-click to rename`;
    lab.style.cursor = 'pointer';
    lab.onclick = () => { pushUndo(); t.activeString = s; lastDigitTime = 0; touch(); renderEditor(); };
    lab.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); renameString(s); };
    row.appendChild(lab);
    const cells = document.createElement('div');
    cells.className = 'scells';
    t.steps.forEach((st, idx) => {
      const c = document.createElement('div');
      c.className = 'cell';
      // cursor markers:
      //   cursor-on   = the cursor sits ON this written column (two lines)
      //   cursor-after = BETWEEN columns / in front (one line)
      const onCursor = selected && selected.step === idx && selected.string === s;
      if (onCursor) c.classList.add('cursor-on');
      else if (!selected && idx + 1 === cursorPos) c.classList.add('cursor-after');
      const fret = st.notes ? st.notes[String(s)] : undefined;
      if (fret !== undefined && fret !== null && fret !== '') {
        const n = document.createElement('span');
        n.className = 'note' + (selected && selected.step === idx && selected.string === s ? ' selected' : '');
        n.textContent = fret;
        n.title = `String ${s}, step ${idx + 1}: fret ${fret} — click to edit, right-click to delete`;
        n.onclick = (e) => {
          e.stopPropagation();
          // Clicking a note selects it for in-place editing instead of
          // deleting it. With Ctrl/Alt held (or chord latch on) the click
          // additionally targets this column, so the next chord digits
          // stack into it rather than opening a new column.
          selected = { step: idx, string: s };
          t.activeString = s;
          cursorPos = idx + 1;
          if (e.ctrlKey || e.altKey || chordLatch) chordAnchor = idx;
          lastDigitTime = 0;
          renderEditor();
          $('staff-scroll').focus();
        };
        n.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); deleteSpecificNote(idx, s); };
        c.appendChild(n);
      } else {
        const d = document.createElement('span');
        d.className = 'dash';
        d.textContent = '–';
        c.appendChild(d);
      }
      c.title = `Step ${idx + 1}, string ${s} — click to move cursor here (Ctrl+click targets this column for chord stacking)`;
      c.onclick = (e) => {
        cursorPos = idx + 1;
        // Ctrl+click (or click while the chord latch is on) explicitly
        // targets this existing column: the next chord digits stack into
        // it instead of opening a new column. A plain click just moves
        // the cursor and closes any open chord.
        if (e.ctrlKey || e.altKey || chordLatch) chordAnchor = idx;
        else chordAnchor = -1;
        selected = null;
        lastDigitTime = 0;
        renderStaff();
        scrollCursorIntoView();
        $('staff-scroll').focus();
      };
      cells.appendChild(c);
    });
    // end cursor slot
    const end = document.createElement('div');
    end.className = 'cell' + (!selected && cursorPos === t.steps.length ? ' cursor-after' : '');
    end.innerHTML = '<span class="dash" style="opacity:.35">·</span>';
    end.title = 'End — click to move cursor to end';
    end.onclick = () => { cursorPos = t.steps.length; chordAnchor = -1; selected = null; renderStaff(); $('staff-scroll').focus(); };
    // For empty tab the end slot doubles as the cursor
    if (!t.steps.length) end.classList.add('cursor-after');
    // cursor at 0 (before first)
    if (!selected && cursorPos === 0 && t.steps.length) {
      const start = document.createElement('div');
      start.className = 'cell cursor-after';
      start.style.width = '8px';
      start.title = 'Start';
      start.onclick = () => { cursorPos = 0; chordAnchor = -1; selected = null; renderStaff(); };
      cells.prepend(start);
    }
    cells.appendChild(end);
    row.appendChild(cells);
    staff.appendChild(row);
  }
}

function renderTabList() {
  const p = getProject();
  const list = $('tab-list');
  list.innerHTML = '';
  p.tabs.forEach((t) => {
    const st = tabStats(t);
    const el = document.createElement('div');
    el.className = 'tab-item' + (t.id === currentTabId ? ' selected' : '');
    el.innerHTML = `<span class="grip">⋮⋮</span><span class="tname"></span><span class="cnt">${st.notes} notes · ${st.steps} steps</span>`;
    el.querySelector('.tname').textContent = t.name;
    el.onclick = () => { currentTabId = t.id; cursorPos = t.steps.length; chordAnchor = -1; selected = null; undoStack = []; redoStack = []; lastDigitTime = 0; renderEditor(); };
    list.appendChild(el);
  });
}

function renderNumpad() {
  const np = $('numpad');
  if (np.dataset.built) return;
  np.dataset.built = '1';
  for (let d = 0; d <= 9; d++) {
    const b = document.createElement('button');
    b.className = 'np-btn';
    b.textContent = d;
    b.title = chordLatch ? `Add ${d} to the open chord column` : `Write ${d} as new note`;
    b.onclick = () => insertDigit(String(d), chordLatch);
    np.appendChild(b);
  }
  $('btn-chord').classList.toggle('active', chordLatch);
}

function scrollCursorIntoView() {
  const el = document.querySelector('.cell.cursor-on') || document.querySelector('.cell.cursor-after');
  if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

