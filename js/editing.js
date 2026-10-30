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
    // ON a column: edit or add a chord note; otherwise write a new column.
    if (selected && t.steps[selected.step]) {
      const idx = selected.step;
      const st = t.steps[idx];
      st.notes = st.notes || {}; st.order = st.order || [];
      const existing = st.notes[s];
      if (existing !== undefined) {
        pushUndo();
        if (now - lastDigitTime < 800 && lastDigitStep === idx && lastDigitString === t.activeString && String(existing).length === 1) {
          const merged = parseInt(String(existing) + digit, 10);
          if (merged <= fretMax()) {
            st.notes[s] = merged;
            lastDigitTime = now;
            touch(); renderEditor(); scrollCursorIntoView();
            return;
          }
        }
        st.notes[s] = d;
        lastDigitTime = now; lastDigitStep = idx; lastDigitString = t.activeString;
        touch(); renderEditor(); scrollCursorIntoView();
        return;
      }
      // no note on this string in the column → stack a chord note into it
      pushUndo();
      if (!st.order.includes(t.activeString)) st.order.push(t.activeString);
      st.notes[s] = d;
      selected = { step: idx, string: t.activeString };
      cursorPos = Math.min(t.steps.length, idx + 1);
      lastDigitTime = now; lastDigitStep = idx; lastDigitString = t.activeString;
      touch(); renderEditor(); scrollCursorIntoView();
      return;
    }
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

/* ON a written slot: two lines, typing edits/extends it.
   BETWEEN slots: one line, typing inserts a new column. */
function isWritten(st) {
  return !!(st && st.notes && Object.keys(st.notes).length);
}
function previousWrittenSlot(t, before) {
  for (let i = Math.min(before, t.steps.length) - 1; i >= 0; i--) {
    if (isWritten(t.steps[i])) return i;
  }
  return -1;
}
function nextWrittenSlot(t, from) {
  for (let i = Math.max(0, from); i < t.steps.length; i++) {
    if (isWritten(t.steps[i])) return i;
  }
  return -1;
}
/* Select the note on the active string (or nearest) in column idx. */
function turnCursorOn(t, idx) {
  const st = t.steps[idx];
  if (!st || !isWritten(st)) return false;
  let str = t.activeString;
  if (st.notes[String(str)] === undefined) {
    let best = -1, bestDist = 1e9;
    for (const k of Object.keys(st.notes)) {
      const n = parseInt(k, 10);
      if (isNaN(n) || n < 1 || n > t.stringCount) continue;
      const d = Math.abs(n - t.activeString);
      if (d < bestDist) { bestDist = d; best = n; }
    }
    if (best > 0) { str = best; t.activeString = best; }
  }
  selected = { step: idx, string: str };
  cursorPos = Math.min(t.steps.length, idx + 1);
  return true;
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

