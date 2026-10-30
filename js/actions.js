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
