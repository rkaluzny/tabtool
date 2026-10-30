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
    <li><b>Editing a chord afterwards:</b> put the cursor ON the column (two vertical lines around the note — click the note or arrow onto it): typing a number replaces that string's note in place, and picking another string (or <kbd>↑</kbd><kbd>↓</kbd>) and typing <b>adds</b> a string to that chord. <kbd>Ctrl</kbd>+click on an empty cell targets that column directly too</li>
    <li><b>The two-line / one-line cursor:</b> ON a written slot the cursor brackets the note with <b>two vertical lines</b> and typing edits or extends that column. Pressing <kbd>→</kbd>/<kbd>←</kbd> drops to the <b>one-line</b> gap behind/in front of it, where typing inserts a brand-new column; pressing again walks on to the next/previous written slot (two lines again). <kbd>↑</kbd><kbd>↓</kbd> change the string without ever pushing the cursor to another slot. <kbd>Esc</kbd> also drops to the one-line gap. So: write <kbd>3</kbd> on the E, note the one-line gap right of it, press <kbd>←</kbd> to bracket the 3, press <kbd>↓</kbd> to the A and type <kbd>5</kbd> — both live in the same column, and changing strings never drags the cursor along</li>
    <li><kbd>⌫</kbd> / <kbd>⏎</kbd> — delete the selected note, else the last note · right-click a note also deletes it · <kbd>Space</kbd> — silent gap · <kbd>↑</kbd><kbd>↓</kbd> change string, <kbd>Esc</kbd> leaves edit mode</li>
    <li><b>Strings:</b> set the count (4–8) under Settings on the right. Right-click a string label on the left of the fretboard to rename its tuning (e.g. Drop-D: rename the bottom string to <kbd>D</kbd>)</li>
    <li>Or use the UI: string buttons, number pad, + Gap, Delete</li>
  </ul>
  <p><b>Text export:</b> one line per string with its tuning label + dashes, numbers in regular steps — the classic guitarist text-tab. Use ⎙ TXT. For Word/LibreOffice use the <b>Copy</b> button (preserves monospace) or <b>Download .rtf</b>; if lines wrap in the document, lower “Steps per line”.</p>`);
}

