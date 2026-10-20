/* TabTool — vanilla JS */
const LS_KEY = 'tabtool.projects.v1';
const LS_THEME = 'tabtool.theme';
const MIN_STRINGS = 4;
const MAX_STRINGS = 8;

let projects = loadProjects();
let currentProjectId = null;
let currentTabId = null;
let cursorPos = 0; // insertion index within steps
let chordLatch = false; // UI toggle equivalent of holding Ctrl
let chordAnchor = -1; // step index of the chord column currently being built (-1 = none)
let selected = null; // { step, string } — note selected by clicking, for in-place edit (-null = none)

/* ---------- strings: per-tab count + tunable labels ---------- */
function defaultLabelsForCount(n) {
  if (n === 4) return ['G', 'D', 'A', 'E'];
  if (n === 5) return ['G', 'D', 'A', 'E', 'B'];
  if (n === 7) return ['e', 'B', 'G', 'D', 'A', 'E', 'B'];
  if (n === 8) return ['e', 'B', 'G', 'D', 'A', 'E', 'B', 'F#'];
  return ['e', 'B', 'G', 'D', 'A', 'E'];
}
// Top-to-bottom tuning labels, e.g. ['e','B','G','D','A','E'] for standard 6-string.
function ensureTabStrings(tab) {
  if (!tab || typeof tab !== 'object') return tab;
  let n = parseInt(tab.stringCount, 10);
  if (isNaN(n)) n = 6;
  tab.stringCount = Math.max(MIN_STRINGS, Math.min(MAX_STRINGS, n));
  const d = defaultLabelsForCount(tab.stringCount);
  if (!Array.isArray(tab.stringLabels)) tab.stringLabels = d.slice();
  if (tab.stringLabels.length > tab.stringCount) tab.stringLabels = tab.stringLabels.slice(0, tab.stringCount);
  while (tab.stringLabels.length < tab.stringCount) tab.stringLabels.push(d[tab.stringLabels.length] || ('S' + (tab.stringLabels.length + 1)));
  for (let i = 0; i < tab.stringCount; i++) {
    const v = String(tab.stringLabels[i] == null ? '' : tab.stringLabels[i]).trim().slice(0, 3);
    tab.stringLabels[i] = v || d[i];
  }
  if (!tab.activeString || tab.activeString < 1 || tab.activeString > tab.stringCount) tab.activeString = 1;
  return tab;
}
function strLabel(tab, s) {
  if (tab && Array.isArray(tab.stringLabels) && tab.stringLabels[s - 1]) return tab.stringLabels[s - 1];
  return defaultLabelsForCount(tab && tab.stringCount ? tab.stringCount : 6)[s - 1] || ('S' + s);
}
let undoStack = [];
let redoStack = [];
let lastDigitTime = 0;
let lastDigitStep = -1;
let lastDigitString = -1;
let lastLetterTime = 0;
let lastLetterKey = '';
let clipboardTab = null;

const $ = (id) => document.getElementById(id);

/* ---------- persistence ---------- */
function loadProjects() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) arr.forEach((p) => { (p.tabs || []).forEach(ensureTabStrings); });
    return Array.isArray(arr) ? arr : [];
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
  return { id: uid(), name: name || 'New Tab', description: '', steps: [], activeString: 1, wrap: 28, stringCount: 6, stringLabels: defaultLabelsForCount(6) };
}
function getProject() { return projects.find((p) => p.id === currentProjectId); }
function getTab() {
  const p = getProject();
  if (!p) return null;
  const t = p.tabs.find((t) => t.id === currentTabId) || null;
  if (t) ensureTabStrings(t);
  return t;
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

/* ---------- editor ---------- */
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
      if (idx === cursorPos - 0 && false) {}
      // cursor marker: show after this cell if cursor == idx+1
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
      if (idx + 1 === cursorPos) c.classList.add('cursor-after');
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
    end.className = 'cell' + (cursorPos === t.steps.length ? ' cursor-after' : '');
    end.innerHTML = '<span class="dash" style="opacity:.35">·</span>';
    end.title = 'End — click to move cursor to end';
    end.onclick = () => { cursorPos = t.steps.length; chordAnchor = -1; selected = null; renderStaff(); $('staff-scroll').focus(); };
    // For empty tab the end slot doubles as the cursor
    if (!t.steps.length) end.classList.add('cursor-after');
    // cursor at 0 (before first)
    if (cursorPos === 0 && t.steps.length) {
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
  ensureTabStrings(t);
  const d = parseInt(digit, 10);
  const now = Date.now();
  const s = String(t.activeString);

  if (asChord) {
    // Chord digits stack into ONE column. Priority: (1) the clicked/selected
    // column, so a previously written chord can be extended after the fact;
    // (2) the column opened by the current modifier-hold / latch session;
    // (3) a fresh column at the cursor. Previously written notes are never
    // touched except by explicitly stacking into their column.
    pushUndo();
    let idx = -1;
    if (selected && t.steps[selected.step]) idx = selected.step;
    else if (chordAnchor >= 0 && t.steps[chordAnchor]) idx = chordAnchor;
    if (idx < 0) {
      const st = { notes: {}, order: [] };
      t.steps.splice(cursorPos, 0, st);
      idx = cursorPos;
      cursorPos++;
    }
    chordAnchor = idx;
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
    // Keep the new note selected so further edits stay in this column.
    selected = { step: idx, string: t.activeString };
    lastDigitTime = now; lastDigitStep = idx; lastDigitString = t.activeString;
  } else {
    // A plain digit replaces the selected note in place (fast double-press
    // still merges into two-digit frets). Anything else writes a new column.
    if (selected && t.steps[selected.step] && t.activeString === selected.string &&
        t.steps[selected.step].notes && t.steps[selected.step].notes[String(selected.string)] !== undefined) {
      pushUndo();
      const idx = selected.step;
      const sel = String(selected.string);
      const prev = t.steps[idx].notes[sel];
      if (now - lastDigitTime < 800 && lastDigitStep === idx && lastDigitString === selected.string && String(prev).length === 1) {
        const merged = parseInt(String(prev) + digit, 10);
        if (merged <= fretMax()) {
          t.steps[idx].notes[sel] = merged;
          lastDigitTime = now;
          touch(); renderEditor(); scrollCursorIntoView();
          return;
        }
      }
      t.steps[idx].notes[sel] = d;
      lastDigitTime = now; lastDigitStep = idx; lastDigitString = selected.string;
      touch(); renderEditor(); scrollCursorIntoView();
      return;
    }
    if (selected) selected = null;
    pushUndo();
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
  selected = null;
  lastDigitTime = 0;
  touch(); renderEditor(); scrollCursorIntoView();
}
function deleteLastNote() {
  const t = getTab();
  if (!t) return;
  // If a note is selected (clicked), delete exactly that note.
  if (selected && t.steps[selected.step]) {
    const sel = selected;
    selected = null;
    deleteSpecificNote(sel.step, sel.string);
    return;
  }
  if (cursorPos <= 0 || !t.steps.length) return;
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
  if (selected && selected.step === stepIdx && selected.string === stringNo) selected = null;
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

function setStringCount(n) {
  const t = getTab();
  if (!t) return;
  n = Math.max(MIN_STRINGS, Math.min(MAX_STRINGS, parseInt(n, 10) || 6));
  if (n === t.stringCount) return;
  pushUndo();
  t.stringCount = n;
  ensureTabStrings(t);
  selected = null;
  chordAnchor = -1;
  lastDigitTime = 0;
  touch(); renderEditor();
  $('staff-scroll').focus();
}

/* Select the written note right after the insertion cursor on the active
   string (or the nearest string in that column that has a note), so that
   every written note is reachable — and editable — from the keyboard.
   Typing a digit then replaces the selected note in place; Esc drops the
   selection so typing inserts a new column again. */
function selectNoteAtCursor() {
  const t = getTab();
  selected = null;
  if (!t) return;
  const st = t.steps[cursorPos];
  if (!st || !st.notes) return;
  const own = st.notes[String(t.activeString)];
  if (own !== undefined) {
    selected = { step: cursorPos, string: t.activeString };
    return;
  }
  let best = -1, bestDist = 1e9;
  for (const k of Object.keys(st.notes)) {
    const s = parseInt(k, 10);
    if (isNaN(s) || s < 1 || s > t.stringCount) continue;
    const d = Math.abs(s - t.activeString);
    if (d < bestDist) { bestDist = d; best = s; }
  }
  if (best > 0) {
    selected = { step: cursorPos, string: best };
    t.activeString = best;
  }
}

function renameString(stringNo) {
  const t = getTab();
  if (!t) return;
  openPrompt(`Rename string ${stringNo} (tuning label)`, strLabel(t, stringNo), (val) => {
    if (val === null) { $('staff-scroll').focus(); return; }
    const clean = String(val).trim().slice(0, 3) || strLabel(t, stringNo);
    if (clean === strLabel(t, stringNo)) { $('staff-scroll').focus(); return; }
    pushUndo();
    t.stringLabels[stringNo - 1] = clean;
    touch(); renderEditor();
    $('staff-scroll').focus();
  });
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
  openModal(`${p.name} — text export`, `<p class="muted" style="font-size:12px">Tip for Word/LibreOffice: use <b>Copy text</b> (keeps monospace formatting) or <b>Download .rtf</b> and open it directly. If long lines wrap in the document, lower “Steps per line”.</p><pre>${escapeHtml(txt)}</pre>
    <div class="modal-actions" style="justify-content:flex-start;padding:0">
    <button class="btn btn-primary" id="m-copy">Copy text</button>
    <button class="btn btn-ghost" id="m-dl">Download .txt</button>
    <button class="btn btn-ghost" id="m-rtf">Download .rtf</button>
    <button class="btn btn-ghost" id="m-pdf">Download .pdf</button>
    <button class="btn btn-ghost" id="m-json">Download .json</button></div>`);
  $('m-copy').onclick = (e) => copyTabText(txt, e.target);
  $('m-dl').onclick = () => download(`${p.name}.txt`, txt, 'text/plain');
  $('m-rtf').onclick = () => download(`${p.name}.rtf`, projectToRtf(p), 'application/rtf');
  $('m-pdf').onclick = () => { closeModal(); openPdfExportDialog(p); };
  $('m-json').onclick = () => download(`${p.name}.tabtool.json`, JSON.stringify(p, null, 2), 'application/json');
}
/* Copy tab text so it pastes cleanly into Word/LibreOffice: carry a
   text/html flavor (monospace <pre>, which Writer maps to a preformatted
   block) alongside the plain text. Falls back to plain copy. */
async function copyTabText(txt, btn) {
  const html = '<pre style="font-family: monospace; white-space: pre;">' + escapeHtml(txt) + '</pre>';
  try {
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([txt], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      })]);
    } else {
      await navigator.clipboard.writeText(txt);
    }
  } catch (e) {
    await navigator.clipboard.writeText(txt);
  }
  if (btn) {
    const old = btn.textContent;
    btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.textContent = old; }, 1200);
  }
}
/* RTF export: opens directly in LibreOffice/Word with Courier intact,
   so no paste step (and no font fixing) is needed at all. */
function rtfEscapeBlock(ascii) {
  return ascii
    .replace(/\\/g, '\\\\')
    .replace(/{/g, '\\{').replace(/}/g, '\\}')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, (c) => '\\u' + c.charCodeAt(0) + '?')
    .split('\n').join('\\par\n');
}
function rtfDoc(blocks) {
  return '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Courier New;}}\\f0\\fs20 ' + blocks.map(rtfEscapeBlock).join('\\par\\par\n') + '\\par}';
}
function tabToRtf(tab, wrapAt) {
  ensureTabStrings(tab);
  return rtfDoc([tabToAscii(tab, wrapAt)]);
}

/* ---------- PDF export (self-contained, no external libraries) ----------
   Writes a minimal but valid PDF 1.4 file: A4 pages, Courier for the text
   tab (so the ASCII columns stay aligned) and Courier-Bold for headings.
   Two layouts:
     - "text"   : the classic ASCII tab, always plain black (the color
                  choice does not apply here)
     - "editor" : the graphical tab — strings as lines, frets as numbers
                  sitting on the line, like the live fretboard in the editor
   Everything is plain latin-1 so string offsets in the xref table are also
   byte offsets. */
const PDF_PAGE = { w: 595, h: 842, m: 42 };        // A4 portrait, in points
const PDF_CHAR_W = 0.6;                            // width of one Courier char (in em)
const PDF_MIN_SIZE = 7.5;                          // never shrink the tab below this

/* Color themes (RGB 0..1). "print" keeps the ink budget as small as
   possible: black only, no fills, no grid, hairline strokes. */
const PDF_THEMES = {
  color: {
    name: 'Colorful',
    text: [0.15, 0.16, 0.20], heading: [0.05, 0.18, 0.52], muted: [0.45, 0.48, 0.56],
    note: [0.05, 0.32, 0.78], label: [0.22, 0.25, 0.32],
    noteBg: [0.05, 0.32, 0.78], noteText: [1, 1, 1], breakLine: false, noteRound: true,
    line: [0.44, 0.47, 0.54], grid: [0.89, 0.91, 0.95], rule: [0.72, 0.76, 0.84],
    band: [0.90, 0.94, 1.00], bandText: [0.05, 0.18, 0.52], panel: [0.975, 0.982, 0.995],
    showGrid: true, showBand: true, showPanel: true, lineWidth: 0.7,
  },
  gray: {
    name: 'Black & white',
    text: [0, 0, 0], heading: [0, 0, 0], muted: [0.45, 0.45, 0.45],
    note: [0, 0, 0], label: [0.25, 0.25, 0.25],
    noteBg: null, noteText: [0, 0, 0], breakLine: true,
    line: [0.35, 0.35, 0.35], grid: [0.85, 0.85, 0.85], rule: [0.55, 0.55, 0.55],
    band: [0.93, 0.93, 0.93], bandText: [0, 0, 0], panel: null,
    showGrid: true, showBand: true, showPanel: false, lineWidth: 0.6,
  },
  print: {
    name: 'Print optimized',
    text: [0, 0, 0], heading: [0, 0, 0], muted: [0, 0, 0],
    note: [0, 0, 0], label: [0, 0, 0],
    noteBg: null, noteText: [0, 0, 0], breakLine: true,
    line: [0, 0, 0], grid: null, rule: null,
    band: null, bandText: [0, 0, 0], panel: null,
    showGrid: false, showBand: false, showPanel: false, lineWidth: 0.4,
  },
  /* the classic text tab is always plain black — the color choice is ignored */
  plain: {
    name: 'Text', text: [0, 0, 0], heading: [0, 0, 0], muted: [0.40, 0.40, 0.40],
    note: [0, 0, 0], label: [0, 0, 0], noteBg: null, noteText: [0, 0, 0], breakLine: false,
    line: [0, 0, 0], grid: null, rule: [0.60, 0.60, 0.60],
    band: null, bandText: [0, 0, 0], panel: null,
    showGrid: false, showBand: false, showPanel: false, lineWidth: 0.5,
  },
};
function pdfCssColor(c) { return `rgb(${(c || [0, 0, 0]).map((v) => Math.round(v * 255)).join(',')})`; }
function pdfColor(c) { return (c || [0, 0, 0]).map((v) => v.toFixed(3)).join(' '); }

/* Common unicode punctuation that has no WinAnsi equivalent — mapped to
   plain ASCII so the PDF text stays readable. */
const PDF_CHAR_MAP = {
  '—': '-', '–': '-', '‐': '-', '‑': '-', '‒': '-',
  '‘': "'", '’': "'", '‚': "'", '“': '"', '”': '"',
  '…': '...', '•': '*', '→': '->', '⇒': '=>',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
};

/* Keep the text inside latin-1 (WinAnsi) so the PDF stays byte-safe. */
function pdfSanitize(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s)) {
    const c = ch.codePointAt(0);
    if (PDF_CHAR_MAP[ch] !== undefined) out += PDF_CHAR_MAP[ch];
    else if (c < 32 || c === 127) out += ' ';
    else if (c < 256) out += ch;
    else out += '?';
  }
  return out;
}
function pdfEscape(s) {
  return pdfSanitize(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
function pdfTextWidth(text, size) { return String(text).length * PDF_CHAR_W * size; }
/* Courier cap height is 0.562 em, so a glyph sits between the baseline and
   baseline + 0.562*size. To center a text in a box of height h whose bottom
   is at `bottom`, the baseline has to be shifted down by half the cap height. */
const PDF_CAP = 0.562;
function pdfBaseline(bottom, size, h) {
  return bottom + (h || size * 1.22) / 2 - (PDF_CAP * size) / 2;
}

/* Wrap a paragraph to a maximum number of characters. Words longer than the
   limit are hard-split so nothing ever sticks out of the page. */
function pdfWrapText(text, max) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  let cur = '';
  words.forEach((w) => {
    while (w.length > max) {
      if (cur) { out.push(cur); cur = ''; }
      out.push(w.slice(0, max));
      w = w.slice(max);
    }
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= max) cur += ' ' + w;
    else { out.push(cur); cur = w; }
  });
  if (cur) out.push(cur);
  return out;
}

/* Shrink (and if needed truncate) a text so it fits into maxWidth. */
function pdfFitText(text, size, maxWidth, minSize) {
  const t = String(text == null ? '' : text);
  let s = size;
  while (s > (minSize || 8) && pdfTextWidth(t, s) > maxWidth) s -= 0.5;
  if (pdfTextWidth(t, s) <= maxWidth) return { text: t, size: s };
  const per = Math.max(1, Math.floor(maxWidth / (PDF_CHAR_W * s)));
  return { text: t.slice(0, Math.max(1, per - 3)) + '...', size: s };
}

/* Render a tab into printable lines that fit the page width. If the tab is
   too wide for a readable font size, the steps per line are reduced first
   (the tab is split over several lines instead of shrinking to unreadable). */
function tabPdfBlock(tab) {
  const wrap = Math.max(8, Math.min(64, parseInt(tab.wrap, 10) || 28));
  const avail = PDF_PAGE.w - 2 * PDF_PAGE.m;
  for (let per = wrap; per >= 8; per--) {
    const lines = tabToAscii(tab, per).split('\n');
    const maxLen = lines.reduce((a, l) => Math.max(a, l.length), 0) || 1;
    const size = Math.min(10, avail / (maxLen * PDF_CHAR_W));
    if (size >= PDF_MIN_SIZE) return { lines, size };
  }
  return { lines: tabToAscii(tab, 8).split('\n'), size: PDF_MIN_SIZE };
}

/* ---------- page builder ----------
   Collects drawing items (text / lines / rectangles) and breaks the page
   when the next block does not fit into the remaining space. */
function pdfBuilder() {
  const M = PDF_PAGE.m;
  const pages = [];
  let items = [];
  let y = PDF_PAGE.h - M;
  const breakPage = () => { pages.push(items); items = []; y = PDF_PAGE.h - M; };
  return {
    pages,
    get y() { return y; },
    push(item) { items.push(item); },
    /* make sure `h` points of vertical space are available (new page if not) */
    ensure(h) { if (y - h < M) breakPage(); },
    space(px) { if (y - px < M) breakPage(); else y -= px; },
    advance(h) { y -= h; },
    finish() { pages.push(items); return pages; },
  };
}

/* ---- classic text tab (the same layout as the TXT export) ---- */
function renderTextTab(b, tab, theme) {
  const M = PDF_PAGE.m;
  const blk = tabPdfBlock(tab);
  blk.lines.forEach((l) => {
    const h = blk.size * 1.22;
    b.ensure(h);
    const base = pdfBaseline(b.y, blk.size, h);
    if (!l.trim()) { b.advance(blk.size * 0.7); return; }
    const bar = l.indexOf('|');
    if (bar > 0) {
      // string label in bold, the fret row in regular
      b.push({ kind: 'text', text: pdfSanitize(l.slice(0, bar)), size: blk.size, bold: true, x: M, y: base, color: theme.label });
      b.push({ kind: 'text', text: pdfSanitize(l.slice(bar)), size: blk.size, bold: false, x: M + pdfTextWidth(l.slice(0, bar), blk.size), y: base, color: theme.text });
    } else {
      b.push({ kind: 'text', text: pdfSanitize(l), size: blk.size, bold: false, x: M, y: base, color: theme.text });
    }
    b.advance(h);
  });
}

/* ---- graphical tab, like the live editor ----
   Strings are drawn as lines, frets as numbers sitting on the line — in the
   colorful theme they get a filled "pill" like in the editor, in the plain
   themes the line is simply broken around the number (classic tab look). */
function renderEditorTab(b, tab, theme) {
  const M = PDF_PAGE.m;
  const size = 9.5;
  const rowH = size * 2.15;
  const headroom = size * 1.15;      // room for the numbers above the first line
  const bottomPad = size * 0.6;
  const labelW = 32;
  const avail = PDF_PAGE.w - 2 * M - labelW;
  const steps = tab.steps || [];

  // column width follows the widest fret number (so 2-digit frets fit) and
  // leaves room so two neighbouring note markers never touch
  let maxDigits = 1;
  steps.forEach((st) => Object.keys(st.notes || {}).forEach((k) => {
    maxDigits = Math.max(maxDigits, String(st.notes[k]).length);
  }));
  const colW = Math.max(19, maxDigits * PDF_CHAR_W * size + 12);
  const cols = Math.max(4, Math.floor(avail / colW));

  const chunks = [];
  for (let i = 0; i < steps.length; i += cols) chunks.push(steps.slice(i, i + cols));
  if (!chunks.length) chunks.push([]);

  const S = tab.stringCount;
  chunks.forEach((chunk) => {
    const blockH = headroom + (S - 1) * rowH + bottomPad;
    b.ensure(blockH);
    const top = b.y;
    const x0 = M + labelW;
    const w = chunk.length * colW;
    const firstY = top - headroom;                  // topmost string line
    const lastY = top - headroom - (S - 1) * rowH;   // bottom-most string line

    if (theme.showPanel) b.push({ kind: 'rect', x: M, y: top - blockH, w: PDF_PAGE.w - 2 * M, h: blockH, fill: theme.panel });

    if (theme.showGrid) {
      for (let c = 0; c <= chunk.length; c++) {
        b.push({ kind: 'line', x1: x0 + c * colW, y1: lastY, x2: x0 + c * colW, y2: firstY, w: 0.3, color: theme.grid });
      }
    }

    for (let r = 1; r <= S; r++) {
      const lineY = firstY - (r - 1) * rowH;

      // the notes of this row
      const rowNotes = [];
      chunk.forEach((st, c) => {
        const fret = st.notes ? st.notes[String(r)] : undefined;
        if (fret === undefined || fret === null || fret === '') return;
        const txt = String(fret);
        const tw = pdfTextWidth(txt, size);
        rowNotes.push({ txt, tw, cx: x0 + (c + 0.5) * colW });
      });

      if (theme.breakLine) {
        // classic tab: the line runs around the numbers
        rowNotes.sort((a, b2) => a.cx - b2.cx);
        let cursor = x0;
        rowNotes.forEach((n) => {
          const left = n.cx - n.tw / 2 - 1.5;
          if (left - cursor > 0.5) b.push({ kind: 'line', x1: cursor, y1: lineY, x2: left, y2: lineY, w: theme.lineWidth, color: theme.line });
          cursor = n.cx + n.tw / 2 + 1.5;
        });
        if (x0 + w - cursor > 0.5) b.push({ kind: 'line', x1: cursor, y1: lineY, x2: x0 + w, y2: lineY, w: theme.lineWidth, color: theme.line });
      } else {
        b.push({ kind: 'line', x1: x0, y1: lineY, x2: x0 + w, y2: lineY, w: theme.lineWidth, color: theme.line });
      }

      // tuning label
      b.push({ kind: 'text', text: pdfSanitize(strLabel(tab, r)), size, bold: true, x: M, y: lineY - (PDF_CAP * size) / 2, color: theme.label });

      // the numbers themselves
      rowNotes.forEach((n) => {
        if (theme.noteBg) {
          // a round marker: a circle for single digits, a pill for two digits
          const boxH = size + 5;
          const boxW = Math.max(boxH, n.tw + 8);
          if (theme.noteRound) {
            b.push({ kind: 'rrect', x: n.cx - boxW / 2, y: lineY - boxH / 2, w: boxW, h: boxH, r: boxH / 2, fill: theme.noteBg });
          } else {
            b.push({ kind: 'rect', x: n.cx - boxW / 2, y: lineY - boxH / 2, w: boxW, h: boxH, fill: theme.noteBg });
          }
        }
        b.push({ kind: 'text', text: pdfSanitize(n.txt), size, bold: true, x: n.cx - n.tw / 2, y: lineY - (PDF_CAP * size) / 2, color: theme.noteText });
      });
    }
    // separator between the tuning labels and the tab itself
    b.push({ kind: 'line', x1: x0, y1: lastY, x2: x0, y2: firstY, w: theme.lineWidth, color: theme.line });
    b.advance(blockH);
  });
}

/* ---- tab heading (title band or plain title) ---- */
function renderTabTitle(b, tab, theme) {
  const M = PDF_PAGE.m;
  const avail = PDF_PAGE.w - 2 * M;
  const size = 12;
  const stats = tabStats(tab);
  const statsTxt = `${stats.notes} note${stats.notes === 1 ? '' : 's'} · ${stats.steps} step${stats.steps === 1 ? '' : 's'}`;
  const nameFit = pdfFitText(tab.name || 'Tab', size, avail - pdfTextWidth(statsTxt, 8) - 14, 9);
  if (theme.showBand) {
    const h = 18;
    b.ensure(h + 2);
    const top = b.y;
    b.push({ kind: 'rect', x: M, y: top - h, w: avail, h, fill: theme.band });
    b.push({ kind: 'text', text: pdfSanitize(nameFit.text), size: nameFit.size, bold: true, x: M + 7, y: pdfBaseline(top - h, nameFit.size, h), color: theme.bandText });
    b.push({ kind: 'text', text: pdfSanitize(statsTxt), size: 8, bold: false, x: PDF_PAGE.w - M - 7 - pdfTextWidth(statsTxt, 8), y: pdfBaseline(top - h, 8, h), color: theme.muted });
    b.advance(h + 4);
  } else {
    b.ensure(size * 1.5);
    const top = b.y;
    b.push({ kind: 'text', text: pdfSanitize(nameFit.text), size: nameFit.size, bold: true, x: M, y: pdfBaseline(top - size * 1.5, nameFit.size, size * 1.5), color: theme.heading });
    b.push({ kind: 'text', text: pdfSanitize(statsTxt), size: 8, bold: false, x: M + pdfTextWidth(nameFit.text, nameFit.size) + 10, y: pdfBaseline(top - size * 1.5, 8, size * 1.5), color: theme.muted });
    b.advance(size * 1.5);
  }
}

/* Build the list of drawing items, paginated over A4 pages. */
function projectPdfPages(proj, opts) {
  const format = opts && opts.format === 'text' ? 'text' : 'editor';
  const theme = format === 'text'
    ? PDF_THEMES.plain
    : (PDF_THEMES[(opts && opts.theme) || 'color'] || PDF_THEMES.color);
  const M = PDF_PAGE.m;
  const avail = PDF_PAGE.w - 2 * M;
  const b = pdfBuilder();

  // ---- document header ----
  const titleFit = pdfFitText(proj.name || 'Untitled project', 16, avail, 11);
  b.ensure(20);
  b.push({ kind: 'text', text: pdfSanitize(titleFit.text), size: titleFit.size, bold: true, x: M, y: pdfBaseline(b.y - titleFit.size * 1.25, titleFit.size, titleFit.size * 1.25), color: theme.heading });
  b.advance(titleFit.size * 1.25);
  const sub = `${(proj.tabs || []).length} tab(s) · exported ${nowStr()}`;
  b.ensure(14);
  b.push({ kind: 'text', text: pdfSanitize(sub), size: 8.5, bold: false, x: M, y: pdfBaseline(b.y - 12, 8.5, 12), color: theme.muted });
  b.advance(12);
  if (theme.rule) {
    b.push({ kind: 'line', x1: M, y1: b.y, x2: PDF_PAGE.w - M, y2: b.y, w: 0.6, color: theme.rule });
    b.advance(10);
  }

  // ---- one block per tab ----
  (proj.tabs || []).forEach((t, i) => {
    ensureTabStrings(t);
    renderTabTitle(b, t, theme);
    const desc = (t.description || '').trim();
    if (desc) pdfWrapText(desc, 95).forEach((d) => {
      b.ensure(12);
      b.push({ kind: 'text', text: pdfSanitize(d), size: 8.5, bold: false, x: M, y: pdfBaseline(b.y - 11, 8.5, 11), color: theme.muted });
      b.advance(11);
    });
    b.space(6);
    if (format === 'text') renderTextTab(b, t, theme);
    else renderEditorTab(b, t, theme);
    b.space(14);
  });

  const pages = b.finish();

  // ---- footer: project name + page number ----
  pages.forEach((pg, i) => {
    const fy = M - 22;
    const pn = `Page ${i + 1} / ${pages.length}`;
    const nameFit = pdfFitText(proj.name || 'TabTool', 7.5, PDF_PAGE.w - 2 * M - pdfTextWidth(pn, 7.5) - 20, 6);
    if (theme.rule) pg.push({ kind: 'line', x1: M, y1: fy + 14, x2: PDF_PAGE.w - M, y2: fy + 14, w: 0.5, color: theme.rule });
    pg.push({ kind: 'text', text: pdfSanitize(nameFit.text), size: nameFit.size, bold: false, x: M, y: fy, color: theme.muted });
    pg.push({ kind: 'text', text: pn, size: 7.5, bold: false, x: PDF_PAGE.w - M - pdfTextWidth(pn, 7.5), y: fy, color: theme.muted });
  });
  return pages;
}

function pdfPageContent(items) {
  let s = '';
  items.forEach((it) => {
    if (it.kind === 'line') {
      s += 'q\n' + pdfColor(it.color) + ' RG\n' + (it.w || 0.5).toFixed(2) + ' w\n';
      s += it.x1.toFixed(2) + ' ' + it.y1.toFixed(2) + ' m ' + it.x2.toFixed(2) + ' ' + it.y2.toFixed(2) + ' l\nS\nQ\n';
    } else if (it.kind === 'rect') {
      s += 'q\n' + pdfColor(it.fill) + ' rg\n';
      s += it.x.toFixed(2) + ' ' + it.y.toFixed(2) + ' ' + it.w.toFixed(2) + ' ' + it.h.toFixed(2) + ' re\nf\nQ\n';
    } else if (it.kind === 'rrect') {
      s += 'q\n' + pdfColor(it.fill) + ' rg\n' + pdfRoundRectPath(it.x, it.y, it.w, it.h, it.r) + 'f\nQ\n';
    } else {
      s += 'q\n' + pdfColor(it.color) + ' rg\nBT\n' + (it.bold ? '/F2' : '/F1') + ' ' + it.size.toFixed(2) + ' Tf\n';
      s += '1 0 0 1 ' + it.x.toFixed(2) + ' ' + it.y.toFixed(2) + ' Tm\n';
      s += '(' + pdfEscape(it.text) + ') Tj\nET\nQ\n';
    }
  });
  return s;
}

/* A rectangle with rounded corners (a full circle when r = h/2 and the box
   is square) — used for the note markers. */
function pdfRoundRectPath(x, y, w, h, r) {
  const k = 0.5523;                       // circle -> bezier constant
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const c = r * k;
  const X = (v) => v.toFixed(2);
  let p = `${X(x + r)} ${X(y)} m\n`;
  p += `${X(x + w - r)} ${X(y)} l\n`;
  p += `${X(x + w - r + c)} ${X(y)} ${X(x + w)} ${X(y + r - c)} ${X(x + w)} ${X(y + r)} c\n`;
  p += `${X(x + w)} ${X(y + h - r)} l\n`;
  p += `${X(x + w)} ${X(y + h - r + c)} ${X(x + w - r + c)} ${X(y + h)} ${X(x + w - r)} ${X(y + h)} c\n`;
  p += `${X(x + r)} ${X(y + h)} l\n`;
  p += `${X(x + r - c)} ${X(y + h)} ${X(x)} ${X(y + h - r + c)} ${X(x)} ${X(y + h - r)} c\n`;
  p += `${X(x)} ${X(y + r)} l\n`;
  p += `${X(x)} ${X(y + r - c)} ${X(x + r - c)} ${X(y)} ${X(x + r)} ${X(y)} c\n`;
  return p;
}

/* Assemble the PDF file (objects, xref table, trailer) and return bytes. */
function assemblePdf(pageContents, title) {
  const n = pageContents.length;
  const fontRegular = 3 + n;
  const fontBold = 4 + n;
  const firstContent = 5 + n;
  const infoId = 5 + 2 * n;
  const objs = [];

  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  const kids = [];
  for (let i = 0; i < n; i++) kids.push((3 + i) + ' 0 R');
  objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${n} >>`;
  for (let i = 0; i < n; i++) {
    objs[3 + i] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE.w} ${PDF_PAGE.h}] ` +
      `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${firstContent + i} 0 R >>`;
  }
  objs[fontRegular] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>';
  objs[fontBold] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>';
  pageContents.forEach((data, i) => {
    objs[firstContent + i] = `<< /Length ${data.length} >>\nstream\n${data}\nendstream`;
  });
  objs[infoId] = `<< /Title (${pdfEscape(title)}) /Producer (TabTool) >>`;

  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';   // binary marker (4 high bytes)
  const offsets = [];
  for (let id = 1; id <= infoId; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  }
  const size = infoId + 1;
  const xrefPos = out.length;
  out += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let id = 1; id <= infoId; id++) {
    out += String(offsets[id]).padStart(10, '0') + ' 00000 n \n';
  }
  out += `trailer\n<< /Size ${size} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

function safeFilename(name) {
  return String(name || 'tabtool').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'tabtool';
}

/* Export every tab of a project into one PDF file.
   opts: { format: 'text' | 'editor', theme: 'color' | 'gray' | 'print' } */
function exportProjectPdf(proj, btn, opts) {
  if (!proj) return;
  const o = opts || { format: 'text', theme: 'color' };
  const pages = projectPdfPages(proj, o);
  const contents = pages.map(pdfPageContent);
  const bytes = assemblePdf(contents, proj.name || 'TabTool');
  downloadBlob(safeFilename(proj.name) + '.pdf', new Blob([bytes], { type: 'application/pdf' }));
  if (btn) {
    const old = btn.textContent;
    btn.textContent = '✓ PDF';
    setTimeout(() => { btn.textContent = old; }, 1400);
  }
}

/* ---------- PDF export options dialog ---------- */
/* Small preview of the graphical tab, drawn like the live editor. */
function pdfPreviewSvg(tab) {
  const W = 260, H = 92;
  const S = tab && tab.stringCount ? tab.stringCount : 6;
  const rowH = (H - 12) / S;
  const labelW = 22;
  const r = Math.min(6.5, rowH * 0.44);
  const steps = (tab && tab.steps ? tab.steps : []).slice(0, 11);
  const colW = (W - labelW - 6) / Math.max(7, steps.length);
  let out = '';
  for (let r2 = 1; r2 <= S; r2++) {
    const y = 8 + (r2 - 1) * rowH + rowH * 0.55;
    out += `<line x1="${labelW}" y1="${y.toFixed(1)}" x2="${W - 4}" y2="${y.toFixed(1)}" stroke="var(--pdf-line)" stroke-width="1"/>`;
    const lab = tab ? strLabel(tab, r2) : '·';
    out += `<text x="2" y="${(y + 3).toFixed(1)}" font-size="9" font-weight="700" fill="var(--pdf-label)">${escapeHtml(lab)}</text>`;
    steps.forEach((st, c) => {
      const fret = st.notes ? st.notes[String(r2)] : undefined;
      if (fret === undefined || fret === null || fret === '') return;
      const cx = labelW + (c + 0.5) * colW;
      out += `<circle cx="${cx.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="var(--pdf-noteBg, none)"/>`;
      out += `<text x="${cx.toFixed(1)}" y="${(y + 3).toFixed(1)}" font-size="8" font-weight="700" text-anchor="middle" fill="var(--pdf-noteText, var(--pdf-note))">${escapeHtml(String(fret))}</text>`;
    });
  }
  return `<svg class="opt-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${out}</svg>`;
}
function pdfThemeVars(theme) {
  return `--pdf-line:${pdfCssColor(theme.line)};--pdf-note:${pdfCssColor(theme.note)};--pdf-label:${pdfCssColor(theme.label)}` +
    (theme.noteBg ? `;--pdf-noteBg:${pdfCssColor(theme.noteBg)};--pdf-noteText:${pdfCssColor(theme.noteText)}` : '');
}
function pdfSwatch(theme) {
  const chips = [theme.note, theme.line, theme.band || theme.grid || theme.rule || [1, 1, 1]];
  return '<span class="opt-swatch">' + chips.map((c) => `<i style="background:${pdfCssColor(c)}"></i>`).join('') + '</span>';
}

/* Opens the little options window: layout (text tab / editor view) and,
   for the editor view, the color mode. */
function openPdfExportDialog(proj) {
  if (!proj) return;
  const cur = (currentProjectId === proj.id ? getTab() : null) || (proj.tabs || [])[0] || null;
  const state = { format: 'editor', theme: 'color' };

  const textPreview = cur
    ? tabToAscii(cur, cur.wrap || 28).split('\n').slice(0, 6).join('\n')
    : '(no tab)';

  const themeCards = ['color', 'gray', 'print'].map((k) => {
    const t = PDF_THEMES[k];
    return `<div class="opt-card opt-card-sm${k === 'color' ? ' active' : ''}" data-theme="${k}">
      <div class="opt-head"><span class="opt-title">${escapeHtml(t.name)}</span></div>
      ${pdfSwatch(t)}
      <div class="opt-desc">${k === 'color' ? 'Round blue note markers, soft grid, colored title band.'
        : k === 'gray' ? 'Grayscale only — no color, light grid.'
        : 'Black on white, no fills, hairline strokes — least ink.'}</div>
    </div>`;
  }).join('');

  const html = `
    <div class="opt-section">
      <div class="opt-label">Layout</div>
      <div class="opt-grid" id="pdf-fmt-grid">
        <div class="opt-card active" data-fmt="editor">
          <div class="opt-head"><span class="opt-title">Editor view</span><span class="opt-tag">Graphical</span></div>
          <div class="opt-desc">Like the live fretboard: strings as lines, frets as numbers on the line.</div>
          <div class="opt-preview" id="pdf-prev-editor">${pdfPreviewSvg(cur)}</div>
        </div>
        <div class="opt-card" data-fmt="text">
          <div class="opt-head"><span class="opt-title">Classic text tab</span><span class="opt-tag">Text</span></div>
          <div class="opt-desc">The plain ASCII tab — exactly what the ⎙ TXT export writes.</div>
          <div class="opt-preview"><pre class="opt-pre">${escapeHtml(textPreview)}</pre></div>
        </div>
      </div>
    </div>
    <div class="opt-section" id="pdf-color-sec">
      <div class="opt-label">Colors</div>
      <div class="opt-grid opt-grid-3" id="pdf-theme-grid">${themeCards}</div>
    </div>
    <p class="opt-hint" id="pdf-hint">The PDF contains every tab of <b>${escapeHtml(proj.name || 'this project')}</b>.</p>`;

  openModal('Export PDF', html);
  $('modal-box').classList.add('modal-wide');

  const body = $('modal-body');
  const fmtCards = Array.from(body.querySelectorAll('[data-fmt]'));
  const thCards = Array.from(body.querySelectorAll('[data-theme]'));
  const colorSec = $('pdf-color-sec');
  const hint = $('pdf-hint');
  const prev = $('pdf-prev-editor');

  const applyTheme = () => {
    const t = PDF_THEMES[state.theme] || PDF_THEMES.color;
    if (prev) prev.setAttribute('style', pdfThemeVars(t));
  };
  const showColors = () => {
    colorSec.classList.toggle('hidden', state.format !== 'editor');
    hint.innerHTML = state.format === 'text'
      ? 'Text tabs are always printed in plain black — the color options do not apply.'
      : `The PDF contains every tab of <b>${escapeHtml(proj.name || 'this project')}</b>.`;
  };

  fmtCards.forEach((card) => {
    card.onclick = () => {
      state.format = card.dataset.fmt;
      fmtCards.forEach((c) => c.classList.toggle('active', c === card));
      showColors();
    };
  });
  thCards.forEach((card) => {
    card.onclick = () => {
      state.theme = card.dataset.theme;
      thCards.forEach((c) => c.classList.toggle('active', c === card));
      applyTheme();
    };
  });
  applyTheme();
  showColors();

  const ok = $('modal-ok');
  ok.classList.remove('hidden');
  ok.textContent = 'Download PDF';
  ok.onclick = () => {
    closeModal();
    exportProjectPdf(proj, null, { format: state.format, theme: state.theme });
  };
}

function download(filename, text, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function downloadBlob(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
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
function closeModal() { $('modal-backdrop').classList.add('hidden'); $('modal-box').classList.remove('modal-wide'); }
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function openHelp() {
  openModal('TabTool — quick keys', `
  <p><b>Fast tab writing:</b> pick a tab on the right, then just type numbers — they appear instantly.</p>
  <ul>
    <li><kbd>0</kbd>…<kbd>9</kbd> — write a note on the active string (new column each time)</li>
    <li>Type fast twice (e.g. <kbd>1</kbd> then <kbd>2</kbd>) → fret <b>12</b> (up to max)</li>
    <li><kbd>Shift</kbd>+<kbd>1</kbd>…<kbd>8</kbd> — choose string (highlighted row). Faster: just press the string's tuning letter (<kbd>E</kbd> <kbd>A</kbd> <kbd>D</kbd> <kbd>G</kbd> <kbd>B</kbd> on a standard 6-string) — if two strings share a letter, a single press picks the lower one, a fast double-press picks the upper one</li>
    <li>Hold <kbd>Ctrl</kbd> (or <kbd>Alt</kbd> if your browser steals <kbd>Ctrl</kbd>+number to switch tabs) — everything you type while it is held goes into <b>one new column</b> without touching previous notes. While holding it, <kbd>Shift</kbd>+<kbd>1</kbd>…<kbd>8</kbd> still switches strings, so: hold <kbd>Ctrl</kbd> → <kbd>5</kbd> → <kbd>Shift</kbd>+<kbd>2</kbd> → <kbd>7</kbd> writes a chord with fret 5 on string 1 and fret 7 on string 2. Release <kbd>Ctrl</kbd> to finish the chord. Two-digit frets (<kbd>1</kbd> then <kbd>2</kbd> fast = <b>12</b>) work inside chords too. The <i>Chord</i> button latches the same: toggle on, type the chord, toggle off</li>
    <li><b>Editing a chord afterwards:</b> click any note of the chord to select it (orange) — typing a number replaces it in place. To <b>add</b> a string to that chord, keep the note selected, pick the string, then hold <kbd>Ctrl</kbd> (or toggle <i>Chord</i>) and type the fret — it stacks into the same column instead of opening a new one. <kbd>Ctrl</kbd>+click on an empty cell targets that column directly. <kbd>↑</kbd><kbd>↓</kbd> moves the selection inside the chord</li>
    <li><b>Reaching any written note from the keyboard:</b> <kbd>←</kbd>/<kbd>→</kbd> steps through the columns and highlights the note it lands on (nearest string with a note) — typing a number replaces the highlighted note. <kbd>↑</kbd><kbd>↓</kbd> moves the highlight inside a chord. <kbd>Esc</kbd> drops the highlight; typing then inserts a new column again. So: write <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd>, press <kbd>←</kbd> to highlight the <kbd>3</kbd>, type a new fret to fix it, <kbd>Esc</kbd> to carry on writing</li>
    <li><kbd>⌫</kbd> / <kbd>⏎</kbd> — delete the selected note, else the last note · right-click a note also deletes it · <kbd>Space</kbd> — silent gap · <kbd>↑</kbd><kbd>↓</kbd> change string, <kbd>Esc</kbd> leaves edit mode</li>
    <li><b>Strings:</b> set the count (4–8) under Settings on the right. Right-click a string label on the left of the fretboard to rename its tuning (e.g. Drop-D: rename the bottom string to <kbd>D</kbd>)</li>
    <li>Or use the UI: string buttons, number pad, + Gap, Delete</li>
  </ul>
  <p><b>Text export:</b> one line per string with its tuning label + dashes, numbers in regular steps — the classic guitarist text-tab. Use ⎙ TXT. For Word/LibreOffice use the <b>Copy</b> button (preserves monospace) or <b>Download .rtf</b>; if lines wrap in the document, lower “Steps per line”.</p>`);
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
        arr.forEach((p) => { if (p && p.name) { p.id = p.id || uid(); (p.tabs || []).forEach(ensureTabStrings); projects.unshift(p); } });
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
    selected = null;
    touch(); renderEditor();
  };
  $('btn-redo').onclick = () => {
    if (!redoStack.length) return;
    const t = getTab();
    undoStack.push(JSON.stringify({ steps: t.steps, cursor: cursorPos }));
    restoreSnapshot(redoStack.pop());
    chordAnchor = -1;
    selected = null;
    touch(); renderEditor();
  };
  $('btn-new-tab').onclick = () => {
    const p = getProject();
    pushUndo();
    const t = newTab(`Tab ${p.tabs.length + 1}`);
    p.tabs.push(t);
    currentTabId = t.id; cursorPos = 0; chordAnchor = -1; selected = null; undoStack = []; redoStack = [];
    touch(); renderEditor(); $('tab-name').focus(); $('tab-name').select();
  };
  $('btn-delete-tab').onclick = () => {
    const p = getProject();
    if (p.tabs.length <= 1) { alert('A project needs at least one tab.'); return; }
    openConfirm(`Delete tab “${getTab().name}”?`, () => {
      p.tabs = p.tabs.filter((t) => t.id !== currentTabId);
      currentTabId = p.tabs[0].id; cursorPos = getTab().steps.length;
      chordAnchor = -1;
      selected = null;
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
    if (!chordLatch) { chordAnchor = -1; selected = null; } // unlatching closes the open chord column and leaves edit mode
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
  $('setting-strings').addEventListener('change', (e) => {
    setStringCount(e.target.value);
  });

  $('btn-export-txt').onclick = () => {
    const t = getTab();
    const txt = tabToAscii(t, t.wrap || 28);
    openModal(`${t.name} — text export`, `<p class="muted" style="font-size:12px">Tip for Word/LibreOffice: use <b>Copy text</b> (keeps monospace formatting) or <b>Download .rtf</b> and open it directly. If long lines wrap in the document, lower “Steps per line”.</p><pre>${escapeHtml(txt)}</pre>
      <div style="display:flex;gap:8px"><button class="btn btn-primary" id="m-copy">Copy text</button>
      <button class="btn btn-ghost" id="m-dl">Download .txt</button>
      <button class="btn btn-ghost" id="m-rtf">Download .rtf</button>
      <button class="btn btn-ghost" id="m-pdf">PDF (all tabs)</button></div>`);
    $('m-copy').onclick = (e) => copyTabText(txt, e.target);
    $('m-dl').onclick = () => download(`${t.name}.txt`, txt, 'text/plain');
    $('m-rtf').onclick = () => download(`${t.name}.rtf`, tabToRtf(t, t.wrap || 28), 'application/rtf');
    $('m-pdf').onclick = () => { closeModal(); openPdfExportDialog(getProject()); };
  };
  $('btn-export-pdf').onclick = () => {
    const p = getProject();
    if (!p) return;
    openPdfExportDialog(p);
  };
  $('btn-export-json').onclick = () => {
    const p = getProject();
    download(`${p.name}.tabtool.json`, JSON.stringify(p, null, 2), 'application/json');
  };

  $('modal-close').onclick = closeModal;
  $('modal-backdrop').addEventListener('click', (e) => { if (e.target.id === 'modal-backdrop') closeModal(); });

  /* releasing Ctrl/Alt closes the open chord column and leaves edit mode:
     the next chord digit starts a fresh column instead of stacking onto the
     old one, and the next plain digit writes a new note instead of
     replacing the selected one.
     (Shift release must NOT close it — Shift+1…8 switches strings mid-chord.) */
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Control' || e.key === 'Alt') {
      chordAnchor = -1;
      if (selected) { selected = null; renderStaff(); }
    }
  });

  // Right-click on empty staff space does nothing (no browser menu).
  // Notes and string labels have their own context-menu actions.
  $('staff').addEventListener('contextmenu', (e) => { e.preventDefault(); });

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

    // Shift + 1..8 → string select (use e.code since shifted key differs).
    // NOTE: Ctrl may be held at the same time (chord workflow: hold Ctrl,
    // Shift+1…8 to pick the string, then digit to stack) — so don't exclude it.
    if (e.shiftKey && !e.metaKey && /^Digit[1-8]$/.test(e.code)) {
      const n = parseInt(e.code.slice(5), 10);
      if (n >= 1 && n <= t.stringCount) {
        e.preventDefault();
        t.activeString = n;
        lastDigitTime = 0;
        touch(); renderEditor();
        return;
      }
    }
    // Letter shortcut: press a string's tuning label to select it
    // (case-insensitive, first letter of the label, no modifiers needed).
    // Labels sharing a letter (e.g. high e / low E): single press picks
    // the lowest string, double-press picks the highest one.
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key && /^[a-g]$/i.test(e.key)) {
      const letter = e.key.toLowerCase();
      const matches = [];
      for (let s = 1; s <= t.stringCount; s++) {
        if (String(strLabel(t, s)).toLowerCase()[0] === letter) matches.push(s);
      }
      if (matches.length) {
        e.preventDefault();
        const now = Date.now();
        if (matches.length > 1 && lastLetterKey === letter && now - lastLetterTime < 600) {
          t.activeString = matches[0];
          lastLetterTime = 0; lastLetterKey = '';
        } else {
          t.activeString = matches[matches.length - 1];
          lastLetterTime = now; lastLetterKey = letter;
        }
        lastDigitTime = 0;
        touch(); renderEditor();
        return;
      }
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
    if (e.key === 'Escape') { e.preventDefault(); selected = null; chordAnchor = -1; renderStaff(); return; }
    // Up/Down moves the note selection inside its column when a note is
    // selected, otherwise it just changes the active string row.
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (selected && t.steps[selected.step]) {
        selected.string = Math.max(1, selected.string - 1);
        t.activeString = selected.string;
        cursorPos = selected.step + 1;
      } else {
        t.activeString = Math.max(1, t.activeString - 1);
      }
      lastDigitTime = 0; touch(); renderEditor(); return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (selected && t.steps[selected.step]) {
        selected.string = Math.min(t.stringCount, selected.string + 1);
        t.activeString = selected.string;
        cursorPos = selected.step + 1;
      } else {
        t.activeString = Math.min(t.stringCount, t.activeString + 1);
      }
      lastDigitTime = 0; touch(); renderEditor(); return;
    }
    // Left/Right steps the insertion cursor AND lands on the written note
    // there (see selectNoteAtCursor): typing replaces it, Esc + typing
    // inserts a new column instead. Walking right past the last note (or
    // onto an empty gap) leaves nothing selected, so appending still works.
    if (e.key === 'ArrowLeft') { e.preventDefault(); cursorPos = Math.max(0, cursorPos - 1); chordAnchor = -1; lastDigitTime = 0; selectNoteAtCursor(); renderEditor(); scrollCursorIntoView(); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); cursorPos = Math.min(t.steps.length, cursorPos + 1); chordAnchor = -1; lastDigitTime = 0; selectNoteAtCursor(); renderEditor(); scrollCursorIntoView(); return; }
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
