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
| **Fork version** | `1.1.6` (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`) |
| **Upstream version** | `1.0.0` |

## Divergence from upstream

The fork branched from upstream commit `9126a5a` (*"chore: bump version to 1.0.0"*)
and added **6 commits** on top:

```
deae5bc  feat: context menu v2 with agent actions on selection, animated AI overlay
afff6b8  feat: rebuild graph view on cosmos.gl (WebGL)
36bb07f  feat: toggleable editor toolbar, save status by timestamp; fix PDF heading underline
b553d45  feat: PDF export with bookmarks, margins, and font-size options
0784c43  feat: custom editor font, Windows AI CLI detection, smaller graph nodes
9f60153  feat: wiki-link graph view, hover page previews, fork updater
```

Measured against upstream: **41 files changed, +5,770 / −770 lines.**

Upstream has **no newer commits** — the fork is fully current with `erictli/scratch@main`.

## What the fork adds

| Area | Addition |
| --- | --- |
| **Wiki link graph** | Force-directed graph of notes joined by `[[wikilinks]]`; nodes sized by link count, directional edges, hover-to-highlight, drag, zoom, click-to-open, dashed nodes for unresolved links. `Ctrl/Cmd+Shift+G` or command palette. Rebuilt on `@cosmos.gl/graph` (WebGL). |
| **Hover page previews** | Hover a `[[wikilink]]` for a read-only floating preview rendered with the editor engine (math, mermaid, tables, code). Previews nest up to 3 levels; links inside previews preview too. |
| **PDF export** | `Ctrl/Cmd+Shift+P` opens an export dialog (paper, orientation, margins, font size, page numbers). Renders in a dedicated print window, headings become PDF bookmarks, tables/images paginate instead of splitting. |
| **Fork-owned updater** | The in-app updater points at this fork's GitHub releases, signed with the fork's own key (`scripts/make-latest-json.mjs`). |
| **Custom editor font** | Any OS-installed font for the editor: Settings → Appearance → Typography → Font. Rows preview each font in itself; falls back gracefully for missing glyphs. |
| **Windows AI CLI fixes** | Codex (`%LOCALAPPDATA%\OpenAI\Codex\bin\codex.exe`) and OpenCode (`~/.opencode/bin`) are probed directly, not just via `PATH`. |
| **Editor refinements** | Toggleable editor toolbar, save status by timestamp, selection context menu with agent actions, animated AI overlay, smaller graph nodes, PDF heading-underline fix. |

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
