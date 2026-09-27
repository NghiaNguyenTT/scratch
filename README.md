# Scratch (Fork)

<img src="docs/app-icon.png" alt="Scratch" width="128" height="128" style="border-radius: 22px; margin-bottom: 8px;">

A minimalist, offline-first markdown note-taking app for macOS, Windows, and Linux — **extended fork** of [erictli/scratch](https://github.com/erictli/scratch).

![macOS](https://img.shields.io/badge/platform-macOS-lightgrey) ![Windows](https://img.shields.io/badge/platform-Windows-blue) ![Linux](https://img.shields.io/badge/platform-Linux-orange)

[Fork Releases](https://github.com/NghiaNguyenTT/scratch/releases) · [Upstream Project](https://github.com/erictli/scratch)

## Fork Additions

Everything from upstream Scratch, plus:

- **Wiki link graph view** — a force-directed graph of all notes connected by `[[wikilinks]]`. Nodes are sized by link count and float gently; edges are directional arrows. Hover to highlight neighbors, drag to rearrange, scroll to zoom, click a node to open that note. Dashed hollow nodes are links pointing to notes that don't exist yet. Open with `Ctrl/Cmd+Shift+G` or the command palette.
- **Hover page preview** — hover a `[[wikilink]]` to preview the target note in a floating read-only popup, rendered with the same engine as the editor (math, mermaid, tables, code). Links inside a preview preview too, stacking up to 3 levels deep — like Obsidian's page previews. Click a link inside a preview to navigate; `Esc` closes the topmost popup.
- **In-app updates from this fork** — the updater checks this fork's GitHub releases (signed with the fork's own key). See [Releasing an update](#releasing-an-update).

## Features

- **Offline-first** - No cloud, no account, no internet required
- **Markdown-based** - Notes stored as plain `.md` files you own
- **WYSIWYG editing** - Rich text editing that saves as markdown
- **Wiki link graph** - Visual map of how your notes connect (`Cmd+Shift+G`)
- **Hover page preview** - Peek at linked notes without leaving yours
- **Preview mode** - Open any `.md` file via drag-and-drop or "Open With" without a notes folder
- **Markdown source mode** - Toggle to view and edit raw markdown (`Cmd+Shift+M`)
- **Syntax highlighting** - 20 languages with GitHub-inspired color scheme
- **Mermaid diagrams** - Render flowcharts, sequence diagrams, and more in fenced code blocks
- **KaTeX math** - Render block `$$...$$` math equations
- **Wikilinks** - Type `[[` to link between notes with autocomplete
- **Slash commands** - Type `/` to quickly insert headings, lists, code blocks, diagrams, and more
- **Focus mode** - Distraction-free writing with animated sidebar/toolbar fade (`Cmd+Shift+Enter`)
- **Edit with Claude Code, OpenAI Codex, OpenCode, or Ollama** - Use your local CLI to edit notes with AI (including fully offline via Ollama)
- **Works with other AI agents** - Detects external file changes
- **Folders** - Opt-in collapsible folder tree with drag-and-drop to organize notes
- **Keyboard optimized** - Lots of shortcuts and a command palette
- **Customizable** - Theme, typography, page width, and RTL text direction
- **Git integration** - Optional version control with push/pull for multi-device sync
- **Lightweight** - 5-10x smaller than Obsidian or Notion

## Screenshot

![Screenshot](docs/screenshot.png)

## Installation

### Windows

Download the latest `.exe` installer from [Fork Releases](https://github.com/NghiaNguyenTT/scratch/releases) and run it. WebView2 will be downloaded automatically if needed. Installed apps update automatically when a new release is published here.

### macOS

**Homebrew (upstream)**

```bash
brew tap erictli/tap
brew install --cask erictli/tap/scratch
```

**Manual Download (fork)**

1. Download the latest `.dmg` from [Fork Releases](https://github.com/NghiaNguyenTT/scratch/releases) (when published)
2. Open the DMG and drag Scratch to Applications
3. Open Scratch from Applications

### Linux

Download the latest `.AppImage` or `.deb` from [Fork Releases](https://github.com/NghiaNguyenTT/scratch/releases).

### From Source

**Prerequisites:** Node.js 18+, Rust 1.70+

**macOS:** Xcode Command Line Tools · **Windows:** WebView2 Runtime (pre-installed on Windows 11)

```bash
git clone https://github.com/NghiaNguyenTT/scratch.git
cd scratch
npm install
npm run tauri dev      # Development
npm run tauri build    # Production build
```

Release builds that include the updater must be signed. Generate a keypair once (it prompts for a password — store it somewhere safe, e.g. `~/.tauri/scratch-fork.key.pass`):

```bash
npx tauri signer generate -w ~/.tauri/scratch-fork.key
```

Then build with the signing key and password set:

```bash
export TAURI_SIGNING_PRIVATE_KEY=~/.tauri/scratch-fork.key
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=$(cat ~/.tauri/scratch-fork.key.pass)
npm run tauri build
```

## Keyboard Shortcuts

Scratch is designed to be usable without a mouse. Here are the essentials to get started:

| Shortcut          | Action                 |
| ----------------- | ---------------------- |
| `Cmd+N`           | New note               |
| `Cmd+D`           | Duplicate note         |
| `Delete`          | Delete note            |
| `Cmd+Backspace`   | Delete note            |
| `Cmd+P`           | Command palette        |
| `Cmd+K`           | Add/edit link          |
| `Cmd+F`           | Find in note           |
| `Cmd+Shift+C`     | Copy & Export menu     |
| `Cmd+Shift+M`     | Toggle Markdown source |
| `Cmd+Shift+G`     | Toggle graph view      |
| `Cmd+Shift+Enter` | Toggle Focus mode      |
| `Cmd+Shift+F`     | Search notes           |
| `Cmd+R`           | Reload current note    |
| `Cmd+,`           | Open settings          |
| `Cmd+\`           | Toggle sidebar         |
| `Cmd+B/I`         | Bold/Italic            |
| `Cmd+=/-/0`       | Zoom in/out/reset      |
| `↑/↓`             | Navigate notes         |

**Note:** On Windows, use `Ctrl` instead of `Cmd` for all shortcuts.

Many more shortcuts and features are available in the app—explore via the command palette (`Cmd+P` / `Ctrl+P`) or view the full reference in Settings → Shortcuts.

## Releasing an Update

The app checks `https://github.com/NghiaNguyenTT/scratch/releases/latest/download/latest.json` and offers to update when a newer version is published.

1. Bump the version in `src-tauri/tauri.conf.json`, `package.json`, and `src-tauri/Cargo.toml`.
2. Build with the signing key and password:
   ```bash
   export TAURI_SIGNING_PRIVATE_KEY=~/.tauri/scratch-fork.key
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=$(cat ~/.tauri/scratch-fork.key.pass)
   npm run tauri build
   ```
3. Generate the updater manifest:
   ```bash
   node scripts/make-latest-json.mjs <new-version>
   ```
4. Create a GitHub release `v<new-version>` and upload from `src-tauri/target/release/bundle/nsis/`:
   - `Scratch_<new-version>_x64-setup.exe`
   - `Scratch_<new-version>_x64-setup.exe.sig`
   - `latest.json`

Installed apps pick up the update on the next launch (or via Settings → About → Check for Updates).

## Built With

[Tauri](https://tauri.app/) · [React](https://react.dev/) · [TipTap](https://tiptap.dev/) · [Tailwind CSS](https://tailwindcss.com/) · [Tantivy](https://github.com/quickwit-oss/tantivy) · [d3-force](https://github.com/d3/d3-force)

## Contributing

Upstream Scratch is intentionally minimal, and its author no longer monitors issues and PRs regularly — forking is the sanctioned way to extend it (it's MIT licensed). This fork carries features the maintainer wanted; upstream-worthy fixes may be PR'd back to [erictli/scratch](https://github.com/erictli/scratch) occasionally.

For this fork: issues and PRs are welcome on [NghiaNguyenTT/scratch](https://github.com/NghiaNguyenTT/scratch).

## Credits

Created by [Eric Li](https://ericli.io) — see the [upstream project](https://github.com/erictli/scratch). Fork maintained by [NghiaNguyenTT](https://github.com/NghiaNguyenTT).

## License

MIT
