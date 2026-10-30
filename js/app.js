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
    if (e.key === 'Escape') {
      e.preventDefault();
      // Esc drops from ON to the BETWEEN position just behind the column,
      // so the next typing inserts a new column there.
      if (selected && t.steps[selected.step]) cursorPos = Math.min(t.steps.length, selected.step + 1);
      selected = null; chordAnchor = -1; renderStaff(); return;
    }
    // Up/Down changes string; never moves the cursor slot.
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (selected && t.steps[selected.step]) {
        selected.string = Math.max(1, selected.string - 1);
        t.activeString = selected.string;
      } else {
        t.activeString = Math.max(1, t.activeString - 1);
      }
      lastDigitTime = 0; touch(); renderEditor(); scrollCursorIntoView(); return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (selected && t.steps[selected.step]) {
        selected.string = Math.min(t.stringCount, selected.string + 1);
        t.activeString = selected.string;
      } else {
        t.activeString = Math.min(t.stringCount, t.activeString + 1);
      }
      lastDigitTime = 0; touch(); renderEditor(); scrollCursorIntoView(); return;
    }
    // Arrow nav alternates ON (two lines) ⇄ BETWEEN (one line).
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      lastDigitTime = 0; chordAnchor = -1;
      if (selected && t.steps[selected.step]) {
        cursorPos = selected.step; // between: just in front of this column
        selected = null;
      } else {
        if (!turnCursorOn(t, previousWrittenSlot(t, cursorPos))) cursorPos = 0;
      }
      renderEditor(); scrollCursorIntoView(); return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      lastDigitTime = 0; chordAnchor = -1;
      if (selected && t.steps[selected.step]) {
        cursorPos = Math.min(t.steps.length, selected.step + 1); // between: just behind this column
        selected = null;
      } else {
        if (!turnCursorOn(t, nextWrittenSlot(t, cursorPos))) cursorPos = t.steps.length;
      }
      renderEditor(); scrollCursorIntoView(); return;
    }
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
