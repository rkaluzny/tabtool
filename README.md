# TabTool 0.1.0

Quick guitar-tab writer — vanilla JS + HTML/CSS, wrapped with Electron.

## Run

- As a web app: just open `index.html` in a browser.
- As Electron: `npm install` then `npm start`.
- Linux builds: `npm run dist` → `dist/TabTool-0.1.0.AppImage` and `dist/tabtool_0.1.0_amd64.deb`.

## Build installers

Prerequisites on any machine: [Node.js](https://nodejs.org/) (v20+) and the
dependencies installed once with `npm install`.

### Linux (works on this machine)

```sh
npm run dist:linux
```

Produces `dist/TabTool-0.1.0.AppImage` (run directly, no install needed) and
`dist/tabtool_0.1.0_amd64.deb` (install with `sudo dpkg -i ...`, adds a
launcher + menu entry). Needs `dpkg-deb`/`fakeroot` for the `.deb`, both
present on Debian/Ubuntu/Mint.

### Windows (can also be built from Linux)

```sh
npm run dist:win
```

Produces `dist/TabTool-0.1.0-setup.exe` (NSIS installer) and
`dist/TabTool-0.1.0-portable.exe` (no install needed). No Windows machine
required — electron-builder downloads its NSIS tools automatically. Without a
code-signing certificate Windows SmartScreen will warn on first launch; that
is expected for self-distributed apps.

### macOS (requires a Mac)

```sh
npm run dist:mac
```

Produces `dist/TabTool-0.1.0.dmg` and `dist/TabTool-0.1.0-mac.zip`. Apple
platforms can only be packaged on macOS, so run this on a Mac with Xcode
command-line tools installed. Without an Apple Developer signature +
notarization, Gatekeeper will block the app on first launch (right-click →
Open to bypass for your own builds).

## Icons

App icon source is the blue badge cropped from `icon.png`:
`build/icon.png` (512, used by Linux/Electron), `build/icon.ico` (Windows),
`build/icon.icns` (macOS), `favicon.ico` (website).

## Fast workflow (the point of the app)

1. **+ New Project** → you land in the editor.
2. **+ New Tab** on the right sidebar, click it to select.
3. Just type numbers — they appear instantly on the highlighted string.
   - `Shift+1…6` picks the string (1 = high e top, 6 = low E bottom)
   - `0…9` writes a note; type fast twice for `10…24` (e.g. `1` then `2` = `12`)
   - hold `Ctrl` (or `Alt`, or latch the **Chord** button) to write a chord: everything typed while held goes into **one new column**, previous notes are never touched. `Shift+1…6` still switches strings mid-chord. Release to finish the chord
   - `Backspace` / `Enter` deletes the last note, `Space` adds a silent gap
   - `↑/↓` changes string, `←/→` moves the cursor
4. **⎙ TXT** exports the classic guitarist text-tab:

```
e|-0---3---5---
B|---------3---
G|-------------
D|-------------
A|-------------
E|-------------
```

- `Steps per line` controls line-wrapping of the text export.
- Projects persist in `localStorage`; Import / Export All moves `.tabtool.json` files around.