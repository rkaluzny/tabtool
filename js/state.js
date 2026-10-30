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

