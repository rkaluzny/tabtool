function tabToRtf(tab, wrapAt) {
  ensureTabStrings(tab);
  return rtfDoc([tabToAscii(tab, wrapAt)]);
}

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

/* classic text tab */
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

/* graphical tab, drawn like the editor */
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

/* tab heading */
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

  // document header
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

  // one block per tab
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

  // footer: project name + page number
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

