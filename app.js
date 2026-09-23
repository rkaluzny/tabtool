/* TabTool — vanilla JS */
const LS_KEY = 'tabtool.projects.v1';
const LS_THEME = 'tabtool.theme';
const STRING_LABELS = { 1: 'e', 2: 'B', 3: 'G', 4: 'D', 5: 'A', 6: 'E' };
const STRING_NAMES = { 1: 'high e', 2: 'B', 3: 'G', 4: 'D', 5: 'A', 6: 'low E' };

let projects = loadProjects();
let currentProjectId = null;
let currentTabId = null;
let cursorPos = 0; // insertion index within steps
let chordLatch = false; // UI toggle equivalent of holding Ctrl
let chordAnchor = -1; // step index of the chord column currently being built (-1 = none)
let undoStack = [];
let redoStack = [];
let lastDigitTime = 0;
let lastDigitStep = -1;
let lastDigitString = -1;
let clipboardTab = null;

const $ = (id) => document.getElementById(id);

/* ---------- persistence ---------- */
function loadProjects() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch { return []; }
}
function saveProjects() { localStorage.setItem(LS_KEY, JSON.stringify(projects)); }
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
function nowStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------- model ---------- */
function newProject(name) {
  const p = { id: uid(), name: name || 'Untitled project', createdAt: nowStr(), updatedAt: nowStr(), tabs: [] };
  p.tabs.push(newTab('Intro'));
  return p;
}
function newTab(name) {
  return { id: uid(), name: name || 'New Tab', description: '', steps: [], activeString: 1, wrap: 28 };
}
function getProject() { return projects.find((p) => p.id === currentProjectId); }
function getTab() {
  const p = getProject();
  if (!p) return null;
  return p.tabs.find((t) => t.id === currentTabId) || null;
}
function touch() {
  const p = getProject();
  if (p) p.updatedAt = nowStr();
  saveProjects();
}
function pushUndo() {
  const t = getTab();
  if (!t) return;
  undoStack.push(JSON.stringify({ steps: t.steps, cursor: cursorPos }));
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
}
function restoreSnapshot(snap) {
  const t = getTab();
  const o = JSON.parse(snap);
  t.steps = o.steps;
  cursorPos = Math.max(0, Math.min(o.cursor, t.steps.length));
}

/* ---------- ASCII export (the important part) ---------- */
function stepWidth(step) {
  let w = 1;
  for (const k of Object.keys(step.notes || {})) {
    w = Math.max(w, String(step.notes[k]).length);
  }
  return w;
}
function tabToAscii(tab, wrapAt) {
  const per = wrapAt || tab.wrap || 28;
  const labels = [STRING_LABELS[1], STRING_LABELS[2], STRING_LABELS[3], STRING_LABELS[4], STRING_LABELS[5], STRING_LABELS[6]];
  if (!tab.steps.length) {
    return labels.map((l) => `${l}|--------------------------------`).join('\n');
  }
  const chunks = [];
  for (let i = 0; i < tab.steps.length; i += per) chunks.push(tab.steps.slice(i, i + per));
  const outLines = [];
  chunks.forEach((chunk) => {
    for (let s = 1; s <= 6; s++) {
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
function tabStats(tab) {
  let notes = 0;
  (tab.steps || []).forEach((s) => { notes += Object.keys(s.notes || {}).length; });
  return { notes, steps: (tab.steps || []).length };
}

/* ---------- theme ---------- */
function applyTheme() {
  const th = localStorage.getItem(LS_THEME) || 'dark';
  document.documentElement.setAttribute('data-theme', th);
}

/* ---------- dashboard ---------- */
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
  if (!tab) return '<div class="ml"></div>'.repeat(6);
  let html = '';
  const sample = (tab.steps || []).slice(0, 14);
  for (let s = 1; s <= 6; s++) {
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

/* ---------- editor ---------- */
function openProject(id) {
  currentProjectId = id;
  const p = getProject();
  if (!p || !p.tabs.length) p.tabs.push(newTab('Intro'));
  currentTabId = p.tabs[0].id;
  cursorPos = getTab().steps.length;
  chordAnchor = -1;
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
  for (let s = 1; s <= 6; s++) {
    const b = document.createElement('button');
    b.className = 'sp-btn' + (t.activeString === s ? ' active' : '');
    b.innerHTML = `${STRING_LABELS[s]}<small>${s} · ${STRING_NAMES[s]}</small>`;
    b.title = `String ${s} (${STRING_NAMES[s]}) — Shift+${s}`;
    b.onclick = () => { pushUndo(); t.activeString = s; lastDigitTime = 0; touch(); renderEditor(); $('staff-scroll').focus(); };
    wrap.appendChild(b);
  }
}

function renderStaff() {
  const t = getTab();
  const staff = $('staff');
  staff.innerHTML = '';
  $('staff-empty').classList.toggle('hidden', t.steps.length > 0);
  for (let s = 1; s <= 6; s++) {
    const row = document.createElement('div');
    row.className = 'srow' + (t.activeString === s ? ' active' : '');
    const lab = document.createElement('div');
    lab.className = 'slabel';
    lab.innerHTML = `<span>${STRING_LABELS[s]}</span><span class="snum">${s}</span>`;
    lab.title = `Select string ${s} (Shift+${s})`;
    lab.style.cursor = 'pointer';
    lab.onclick = () => { pushUndo(); t.activeString = s; lastDigitTime = 0; touch(); renderEditor(); };
    row.appendChild(lab);
    const cells = document.createElement('div');
    cells.className = 'scells';
    t.steps.forEach((st, idx) => {
      const c = document.createElement('div');
      c.className = 'cell';
      if (idx === cursorPos - 0 && false) {}
      // cursor marker: show after this cell if cursor == idx+1
      const fret = st.notes ? st.notes[String(s)] : undefined;
      if (fret !== undefined && fret !== null && fret !== '') {
        const n = document.createElement('span');
        n.className = 'note';
        n.textContent = fret;
        n.title = `String ${s}, step ${idx + 1}: fret ${fret} — click to delete`;
        n.onclick = (e) => { e.stopPropagation(); deleteSpecificNote(idx, s); };
        c.appendChild(n);
      } else {
        const d = document.createElement('span');
        d.className = 'dash';
        d.textContent = '–';
        c.appendChild(d);
      }
      if (idx + 1 === cursorPos) c.classList.add('cursor-after');
      c.title = `Step ${idx + 1}, string ${s} — click to move cursor here`;
      c.onclick = () => { cursorPos = idx + 1; chordAnchor = -1; lastDigitTime = 0; renderStaff(); scrollCursorIntoView(); $('staff-scroll').focus(); };
      cells.appendChild(c);
    });
    // end cursor slot
    const end = document.createElement('div');
    end.className = 'cell' + (cursorPos === t.steps.length ? ' cursor-after' : '');
    end.innerHTML = '<span class="dash" style="opacity:.35">·</span>';
    end.title = 'End — click to move cursor to end';
    end.onclick = () => { cursorPos = t.steps.length; chordAnchor = -1; renderStaff(); $('staff-scroll').focus(); };
    // For empty tab the end slot doubles as the cursor
    if (!t.steps.length) end.classList.add('cursor-after');
    // cursor at 0 (before first)
    if (cursorPos === 0 && t.steps.length) {
      const start = document.createElement('div');
      start.className = 'cell cursor-after';
      start.style.width = '8px';
      start.title = 'Start';
      start.onclick = () => { cursorPos = 0; chordAnchor = -1; renderStaff(); };
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
    el.onclick = () => { currentTabId = t.id; cursorPos = t.steps.length; chordAnchor = -1; undoStack = []; redoStack = []; lastDigitTime = 0; renderEditor(); };
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
  const el = document.querySelector('.cell.cursor-after');
  if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/* ---------- editing ops ---------- */
function fretMax() {
  const v = parseInt($('setting-fretmax').value, 10);
  return isNaN(v) ? 24 : Math.max(9, Math.min(30, v));
}
function insertDigit(digit, asChord) {
  const t = getTab();
  if (!t) return;
  pushUndo();
  const d = parseInt(digit, 10);
  const now = Date.now();
  const s = String(t.activeString);

  if (asChord) {
    // One modifier-hold (or latch session) = ONE column. The first chord digit
    // opens a fresh column at the cursor; further digits stack into it until
    // the modifier is released / the latch is toggled off. This never touches
    // previously written notes.
    let idx = chordAnchor;
    if (idx < 0 || !t.steps[idx]) {
      const st = { notes: {}, order: [] };
      t.steps.splice(cursorPos, 0, st);
      idx = cursorPos;
      cursorPos++;
      chordAnchor = idx;
    }
    const st = t.steps[idx];
    st.notes = st.notes || {}; st.order = st.order || [];
    const prev = st.notes[s];
    if (now - lastDigitTime < 800 && lastDigitStep === idx && lastDigitString === t.activeString && prev !== undefined) {
      const merged = parseInt(String(prev) + digit, 10);
      if (merged <= fretMax()) st.notes[s] = merged;
      else st.notes[s] = d;
    } else {
      if (!st.order.includes(t.activeString)) st.order.push(t.activeString);
      st.notes[s] = d;
    }
    lastDigitTime = now; lastDigitStep = idx; lastDigitString = t.activeString;
  } else {
    // merge fast double-press into previous step (for 10..24)?
    const prevIdx = cursorPos - 1;
    const prevSt = t.steps[prevIdx];
    if (
      now - lastDigitTime < 800 && lastDigitStep === prevIdx && lastDigitString === t.activeString &&
      prevSt && prevSt.notes && Object.keys(prevSt.notes).length === 1 && prevSt.notes[s] !== undefined &&
      String(prevSt.notes[s]).length === 1
    ) {
      const merged = parseInt(String(prevSt.notes[s]) + digit, 10);
      if (merged <= fretMax()) {
        prevSt.notes[s] = merged;
        lastDigitTime = now;
        touch(); renderEditor(); scrollCursorIntoView();
        return;
      }
    }
    const st = { notes: { [s]: d }, order: [t.activeString] };
    t.steps.splice(cursorPos, 0, st);
    cursorPos++;
    chordAnchor = -1; // a plain note always closes any open chord column
    lastDigitTime = now; lastDigitStep = cursorPos - 1; lastDigitString = t.activeString;
  }
  touch(); renderEditor(); scrollCursorIntoView();
}
function insertGap() {
  const t = getTab();
  if (!t) return;
  pushUndo();
  t.steps.splice(cursorPos, 0, { notes: {}, order: [] });
  cursorPos++;
  chordAnchor = -1;
  lastDigitTime = 0;
  touch(); renderEditor(); scrollCursorIntoView();
}
function deleteLastNote() {
  const t = getTab();
  if (!t || cursorPos <= 0 || !t.steps.length) return;
  pushUndo();
  const idx = cursorPos - 1;
  const st = t.steps[idx];
  st.order = st.order || Object.keys(st.notes || {}).map(Number);
  if (st.order.length) {
    const s = st.order.pop();
    if (st.notes) delete st.notes[String(s)];
  } else if (st.notes && Object.keys(st.notes).length) {
    const keys = Object.keys(st.notes);
    delete st.notes[keys[keys.length - 1]];
  }
  if (!st.notes || !Object.keys(st.notes).length) {
    t.steps.splice(idx, 1);
    cursorPos--;
  }
  chordAnchor = -1;
  lastDigitTime = 0;
  touch(); renderEditor();
}
function deleteSpecificNote(stepIdx, stringNo) {
  const t = getTab();
  if (!t) return;
  pushUndo();
  const st = t.steps[stepIdx];
  if (st && st.notes) {
    delete st.notes[String(stringNo)];
    st.order = (st.order || []).filter((x) => x !== stringNo);
    if (!Object.keys(st.notes).length) {
      t.steps.splice(stepIdx, 1);
      if (chordAnchor === stepIdx) chordAnchor = -1;
      else if (chordAnchor > stepIdx) chordAnchor--;
      if (cursorPos > stepIdx) cursorPos--;
    }
  }
  lastDigitTime = 0;
  touch(); renderEditor();
}

/* ---------- project / tab actions ---------- */
function renameProject(id) {
  const p = projects.find((x) => x.id === id);
  openPrompt('Rename project', p.name, (val) => {
    if (val !== null && val.trim()) { p.name = val.trim(); p.updatedAt = nowStr(); saveProjects(); renderDashboard($('search').value); if (p.id === currentProjectId) renderEditor(); }
  });
}
function deleteProject(id) {
  const p = projects.find((x) => x.id === id);
  openConfirm(`Delete project “${p.name}”?`, () => {
    projects = projects.filter((x) => x.id !== id);
    saveProjects(); renderDashboard($('search').value);
  });
}
function exportProject(id) {
  const p = projects.find((x) => x.id === id);
  const txt = projectToAscii(p);
  openModal(`${p.name} — text export`, `<pre>${escapeHtml(txt)}</pre>
    <div class="modal-actions" style="justify-content:flex-start;padding:0">
    <button class="btn btn-primary" id="m-copy">Copy text</button>
    <button class="btn btn-ghost" id="m-dl">Download .txt</button>
    <button class="btn btn-ghost" id="m-json">Download .json</button></div>`);
  $('m-copy').onclick = () => navigator.clipboard.writeText(txt);
  $('m-dl').onclick = () => download(`${p.name}.txt`, txt, 'text/plain');
  $('m-json').onclick = () => download(`${p.name}.tabtool.json`, JSON.stringify(p, null, 2), 'application/json');
}
function download(filename, text, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- modal helpers ---------- */
function openModal(title, html) {
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = html;
  $('modal-backdrop').classList.remove('hidden');
  $('modal-ok').classList.add('hidden');
}
function openPrompt(title, initial, cb) {
  openModal(title, `<input id="m-input" style="width:100%;background:var(--input);border:1px solid var(--input-border);color:var(--text);border-radius:8px;padding:10px" value="${escapeHtml(initial || '')}" />`);
  const ok = $('modal-ok');
  ok.classList.remove('hidden');
  ok.textContent = 'Save';
  ok.onclick = () => { closeModal(); cb($('m-input').value); };
  setTimeout(() => { const i = $('m-input'); i.focus(); i.select(); }, 50);
}
function openConfirm(msg, cb) {
  openModal('Please confirm', `<p>${escapeHtml(msg)}</p>`);
  const ok = $('modal-ok');
  ok.classList.remove('hidden');
  ok.textContent = 'Delete';
  ok.onclick = () => { closeModal(); cb(); };
}
function closeModal() { $('modal-backdrop').classList.add('hidden'); }
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function openHelp() {
  openModal('TabTool — quick keys', `
  <p><b>Fast tab writing:</b> pick a tab on the right, then just type numbers — they appear instantly.</p>
  <ul>
    <li><kbd>0</kbd>…<kbd>9</kbd> — write a note on the active string (new column each time)</li>
    <li>Type fast twice (e.g. <kbd>1</kbd> then <kbd>2</kbd>) → fret <b>12</b> (up to max)</li>
    <li><kbd>Shift</kbd>+<kbd>1</kbd>…<kbd>6</kbd> — choose string (highlighted row). Strings: 1 = high e (top), 6 = low E (bottom)</li>
    <li>Hold <kbd>Ctrl</kbd> (or <kbd>Alt</kbd> if your browser steals <kbd>Ctrl</kbd>+number to switch tabs) — everything you type while it is held goes into <b>one new column</b> without touching previous notes. While holding it, <kbd>Shift</kbd>+<kbd>1</kbd>…<kbd>6</kbd> still switches strings, so: hold <kbd>Ctrl</kbd> → <kbd>5</kbd> → <kbd>Shift</kbd>+<kbd>2</kbd> → <kbd>7</kbd> writes a chord with fret 5 on string 1 and fret 7 on string 2. Release <kbd>Ctrl</kbd> to finish the chord. Two-digit frets (<kbd>1</kbd> then <kbd>2</kbd> fast = <b>12</b>) work inside chords too. The <i>Chord</i> button latches the same: toggle on, type the chord, toggle off</li>
    <li><kbd>⌫</kbd> / <kbd>⏎</kbd> — delete last note · <kbd>Space</kbd> — silent gap · <kbd>↑</kbd><kbd>↓</kbd> change string, <kbd>←</kbd><kbd>→</kbd> move cursor</li>
    <li>Or use the UI: string buttons, number pad, + Gap, Delete</li>
  </ul>
  <p><b>Text export:</b> 6 lines with <kbd>e B G D A E</kbd> + dashes, numbers in regular steps — the classic guitarist text-tab. Use ⎙ TXT.</p>`);
}

/* ---------- wiring ---------- */
function init() {
  applyTheme();
  renderDashboard();

  $('search').addEventListener('input', (e) => renderDashboard(e.target.value));
  $('btn-new-project').onclick = () => {
    openPrompt('New project', 'Untitled song', (val) => {
      const p = newProject(val && val.trim() ? val.trim() : 'Untitled song');
      projects.unshift(p);
      saveProjects(); renderDashboard();
      openProject(p.id);
    });
  };
  $('btn-help').onclick = openHelp;
  $('btn-editor-help').onclick = openHelp;
  $('btn-settings').onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme');
    openModal('Settings', `<p>Theme</p><div style="display:flex;gap:8px">
      <button class="btn ${cur === 'light' ? 'btn-primary' : 'btn-ghost'}" id="m-light">Light</button>
      <button class="btn ${cur === 'dark' ? 'btn-primary' : 'btn-ghost'}" id="m-dark">Dark</button></div>`);
    $('m-light').onclick = () => { localStorage.setItem(LS_THEME, 'light'); applyTheme(); closeModal(); };
    $('m-dark').onclick = () => { localStorage.setItem(LS_THEME, 'dark'); applyTheme(); closeModal(); };
  };
  $('btn-import').onclick = () => $('file-import').click();
  $('file-import').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const obj = JSON.parse(r.result);
        const arr = Array.isArray(obj) ? obj : [obj];
        arr.forEach((p) => { if (p && p.name) { p.id = p.id || uid(); projects.unshift(p); } });
        saveProjects(); renderDashboard();
      } catch { alert('Invalid JSON file'); }
    };
    r.readAsText(f);
    e.target.value = '';
  });
  $('btn-export-all').onclick = () => download('tabtool-all.json', JSON.stringify(projects, null, 2), 'application/json');

  $('btn-back').onclick = () => { touch(); showView('dashboard'); renderDashboard($('search').value); };
  $('btn-rename-project').onclick = () => renameProject(currentProjectId);
  $('btn-undo').onclick = () => {
    if (!undoStack.length) return;
    const t = getTab();
    redoStack.push(JSON.stringify({ steps: t.steps, cursor: cursorPos }));
    restoreSnapshot(undoStack.pop());
    chordAnchor = -1;
    touch(); renderEditor();
  };
  $('btn-redo').onclick = () => {
    if (!redoStack.length) return;
    const t = getTab();
    undoStack.push(JSON.stringify({ steps: t.steps, cursor: cursorPos }));
    restoreSnapshot(redoStack.pop());
    chordAnchor = -1;
    touch(); renderEditor();
  };
  $('btn-new-tab').onclick = () => {
    const p = getProject();
    pushUndo();
    const t = newTab(`Tab ${p.tabs.length + 1}`);
    p.tabs.push(t);
    currentTabId = t.id; cursorPos = 0; chordAnchor = -1; undoStack = []; redoStack = [];
    touch(); renderEditor(); $('tab-name').focus(); $('tab-name').select();
  };
  $('btn-delete-tab').onclick = () => {
    const p = getProject();
    if (p.tabs.length <= 1) { alert('A project needs at least one tab.'); return; }
    openConfirm(`Delete tab “${getTab().name}”?`, () => {
      p.tabs = p.tabs.filter((t) => t.id !== currentTabId);
      currentTabId = p.tabs[0].id; cursorPos = getTab().steps.length;
      chordAnchor = -1;
      undoStack = []; redoStack = [];
      touch(); renderEditor();
    });
  };
  $('btn-copy-tab').onclick = () => { clipboardTab = JSON.parse(JSON.stringify(getTab())); };
  $('btn-paste-tab').onclick = () => {
    if (!clipboardTab) return;
    const p = getProject();
    const copy = JSON.parse(JSON.stringify(clipboardTab));
    copy.id = uid(); copy.name += ' (copy)';
    p.tabs.push(copy);
    currentTabId = copy.id; cursorPos = copy.steps.length;
    chordAnchor = -1;
    touch(); renderEditor();
  };
  $('btn-chord').onclick = () => {
    chordLatch = !chordLatch;
    if (!chordLatch) chordAnchor = -1; // unlatching closes the open chord column
    $('btn-chord').classList.toggle('active', chordLatch);
    document.querySelectorAll('.np-btn').forEach((b) => { b.title = chordLatch ? `Add ${b.textContent} to the open chord column` : `Write ${b.textContent} as new note`; });
    $('staff-scroll').focus();
  };
  $('btn-space').onclick = () => insertGap();
  $('btn-delete-note').onclick = () => deleteLastNote();

  $('tab-name').addEventListener('input', (e) => {
    const t = getTab();
    t.name = e.target.value;
    $('tab-name-count').textContent = t.name.length;
    touch(); renderTabList();
  });
  $('tab-desc').addEventListener('input', (e) => {
    const t = getTab();
    t.description = e.target.value;
    $('tab-desc-count').textContent = t.description.length;
    touch();
    $('ascii-preview').textContent = tabToAscii(t, t.wrap || 28);
  });
  $('setting-wrap').addEventListener('change', (e) => {
    const t = getTab();
    t.wrap = Math.max(8, Math.min(64, parseInt(e.target.value, 10) || 28));
    e.target.value = t.wrap;
    touch(); renderEditor();
  });

  $('btn-export-txt').onclick = () => {
    const t = getTab();
    const txt = tabToAscii(t, t.wrap || 28);
    openModal(`${t.name} — text export`, `<pre>${escapeHtml(txt)}</pre>
      <div style="display:flex;gap:8px"><button class="btn btn-primary" id="m-copy">Copy text</button>
      <button class="btn btn-ghost" id="m-dl">Download .txt</button></div>`);
    $('m-copy').onclick = () => navigator.clipboard.writeText(txt);
    $('m-dl').onclick = () => download(`${t.name}.txt`, txt, 'text/plain');
  };
  $('btn-export-json').onclick = () => {
    const p = getProject();
    download(`${p.name}.tabtool.json`, JSON.stringify(p, null, 2), 'application/json');
  };

  $('modal-close').onclick = closeModal;
  $('modal-backdrop').addEventListener('click', (e) => { if (e.target.id === 'modal-backdrop') closeModal(); });

  /* releasing Ctrl/Alt closes the open chord column: the next chord
     digit starts a fresh column instead of stacking onto the old one.
     (Shift release must NOT close it — Shift+1…6 switches strings mid-chord.) */
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Control' || e.key === 'Alt') chordAnchor = -1;
  });

  /* global fast-entry keyboard */
  document.addEventListener('keydown', (e) => {
    if (!$('modal-backdrop').classList.contains('hidden')) {
      if (e.key === 'Escape') closeModal();
      return;
    }
    if ($('view-editor').classList.contains('hidden')) return;
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (e.key === 'Escape') document.activeElement.blur();
      return; // don't hijack typing in fields
    }
    const t = getTab();
    if (!t) return;

    // Shift + 1..6 → string select (use e.code since shifted key differs).
    // NOTE: Ctrl may be held at the same time (chord workflow: hold Ctrl,
    // Shift+1..6 to pick the string, then digit to stack) — so don't exclude it.
    if (e.shiftKey && !e.metaKey && /^Digit[1-6]$/.test(e.code)) {
      e.preventDefault();
      t.activeString = parseInt(e.code.slice(5), 10);
      lastDigitTime = 0;
      touch(); renderEditor();
      return;
    }
    // Digits: plain = new column, Ctrl/Alt/Chord-latch = stack into current column.
    // Use e.code as fallback because Ctrl/Alt/Shift can alter e.key ('!' etc.).
    let digit = null;
    if (/^[0-9]$/.test(e.key) && !e.metaKey) digit = e.key;
    else {
      const m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code || '');
      if (m && (e.ctrlKey || e.altKey)) digit = m[1];
    }
    if (digit !== null) {
      e.preventDefault();
      insertDigit(digit, e.ctrlKey || e.altKey || chordLatch);
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Enter') { e.preventDefault(); deleteLastNote(); return; }
    if (e.key === 'Delete') { e.preventDefault(); deleteLastNote(); return; }
    if (e.key === ' ') { e.preventDefault(); insertGap(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); t.activeString = Math.max(1, t.activeString - 1); touch(); renderEditor(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); t.activeString = Math.min(6, t.activeString + 1); touch(); renderEditor(); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); cursorPos = Math.max(0, cursorPos - 1); chordAnchor = -1; lastDigitTime = 0; renderStaff(); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); cursorPos = Math.min(t.steps.length, cursorPos + 1); chordAnchor = -1; lastDigitTime = 0; renderStaff(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); $('btn-undo').click(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); $('btn-redo').click(); return; }
  });

  // seed demo if empty (so first open isn't blank)
  if (!projects.length) {
    const demo = newProject('First riff');
    demo.tabs[0].name = 'Intro';
    demo.tabs[0].activeString = 1;
    demo.tabs[0].steps = [
      { notes: { 1: 0 }, order: [1] }, { notes: {}, order: [] },
      { notes: { 1: 3 }, order: [1] }, { notes: {}, order: [] },
      { notes: { 1: 5 }, order: [1] }, { notes: { 2: 3 }, order: [2] },
    ];
    projects.push(demo);
    saveProjects();
    renderDashboard();
  }
}

document.addEventListener('DOMContentLoaded', init);
