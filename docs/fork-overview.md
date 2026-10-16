# What This Fork Is

A factual, verifiable description of `NghiaNguyenTT/scratch` — the **Scratch fork** —
and exactly how it diverges from upstream.

## Identity

| | |
| --- | --- |
| **This repo** | `https://github.com/NghiaNguyenTT/scratch` (fork) |
| **Upstream** | `https://github.com/erictli/scratch` (original) |
| **Product** | Scratch — minimalist, offline-first markdown notes app |
| **Stack** | Tauri v2 (Rust) + React 19 / TypeScript / Tailwind v4 + TipTap 3 |
| **License** | MIT (forking is explicitly sanctioned upstream) |
| **Fork version** | `1.2.1` (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`) |
| **Upstream version** | `1.0.0` |

## Divergence from upstream

The fork branched from upstream commit `9126a5a` (*"chore: bump version to 1.0.0"*)
and has added **9 commits** on top, followed by release commits (v1.1.7, then v1.2.0 —
AI removal plus the shadcn-neutral restyle — and v1.2.1, a bug-fix release covering the
command-palette close crash, the inline-code colour and the dark-mode PDF page background):

```
2b364d3  feat: simplify font selection in Appearance settings
9952101  chore: upgrade dependencies to latest and align Tauri plugin versions
f3470df  docs: add fork overview describing scope and divergence from upstream
deae5bc  feat: context menu v2 with agent actions on selection, animated AI overlay
afff6b8  feat: rebuild graph view on cosmos.gl (WebGL)
36bb07f  feat: toggleable editor toolbar, save status by timestamp; fix PDF heading underline
b553d45  feat: PDF export with bookmarks, margins, and font-size options
0784c43  feat: custom editor font, Windows AI CLI detection, smaller graph nodes
9f60153  feat: wiki-link graph view, hover page previews, fork updater
```

Measured against upstream: **62 files changed, +7,322 / −5,408 lines** (as of the
v1.2.1 release).

Upstream has **no newer commits** — the fork is fully current with `erictli/scratch@main`.

## What the fork adds

| Area | Addition |
| --- | --- |
| **Wiki link graph** | Force-directed graph of notes joined by `[[wikilinks]]`; nodes sized by link count, directional edges, hover-to-highlight, drag, zoom, click-to-open, dashed nodes for unresolved links. `Ctrl/Cmd+Shift+G` or command palette. Rebuilt on `@cosmos.gl/graph` (WebGL). |
| **Hover page previews** | Hover a `[[wikilink]]` for a read-only floating preview rendered with the editor engine (math, mermaid, tables, code). Previews nest up to 3 levels; links inside previews preview too. |
| **PDF export** | `Ctrl/Cmd+Shift+P` opens an export dialog (paper, orientation, margins, font size, page numbers). Renders in a dedicated print window, headings become PDF bookmarks, tables/images paginate instead of splitting. |
| **Fork-owned updater** | The in-app updater points at this fork's GitHub releases, signed with the fork's own key (`scripts/make-latest-json.mjs`). |
| **Custom editor font** | Any OS-installed font for the editor: Settings → Appearance → Typography → Font. One compact picker: search, `Sans` / `Serif` / `Mono` presets, and an installed-fonts list that previews each font in itself; falls back gracefully for missing glyphs. |
| **Editor refinements** | Toggleable editor toolbar, save status by timestamp, selection context menu (copy/paste, inline formatting, table and link actions, search the web), smaller graph nodes, PDF heading-underline fix. |
| **Neutral design system** | Restyled on shadcn's neutral theme: light/dark `:root` tokens in `oklch`, the derived radius scale, pill buttons, thin dim scrollbars, and one three-role radius rule (chip / surface / nested) applied across every component. |

## What the fork removes

| Area | Removed |
| --- | --- |
| **In-app AI agents** | Every AI feature was removed in v1.2.0: the Claude Code / Codex / OpenCode / Ollama CLI integration, the AI edit modal and response toast, the agent/translate/preset context-menu actions, the command palette's "Edit with …" entries, the animated "is editing your note" overlay, the AI Providers settings section, and the four provider icons. Scratch is a plain markdown editor — an external agent (or your own editor) edits the `.md` files directly, and the file watcher still picks those changes up live. No AI SDK, API key, or provider dependency remains (in-app AI was always local CLI shell-outs). |

New modules the fork introduced include: `GraphView`, `WikilinkPreview`, `EditorContextMenu`,
`ExportPdfModal` / `ExportPdfApp`, `services/graph.ts`, `services/fonts.ts`,
`lib/wikilinks.ts`, `lib/urls.ts`, `src-tauri/src/pdf_export.rs`, plus `pdf.html` /
`src/pdf-main.tsx` as a second Vite entry point for the print window.

## What it deliberately keeps

Everything upstream Scratch is: offline-first, plain `.md` files, WYSIWYG editing,
slash commands, focus mode, folders, command palette, git sync, Tantivy search,
preview mode, and the "lightweight" ethos. The fork is additive, not a rewrite.

## Maintenance posture

- Upstream is intentionally minimal and its author no longer reviews issues/PRs regularly.
  Forking is the sanctioned way to extend it; upstream-worthy fixes may be PR'd back.
- Fork issues and PRs live on `NghiaNguyenTT/scratch`.
- Releases are cut by bumping the version in the three manifest files, building with the
  fork signing key, generating `latest.json`, and publishing a `v<version>` GitHub release.
