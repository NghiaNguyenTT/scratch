import { useEffect, useState, type ReactNode } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode, ResolvedPos } from "@tiptap/pm/model";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  BoldIcon,
  InlineCodeIcon,
  ItalicIcon,
  StrikethroughIcon,
  CopyIcon,
  ScissorsIcon,
  ClipboardIcon,
  SelectAllIcon,
  ExternalLinkIcon,
  LinkOffIcon,
  NoteIcon,
  SearchIcon,
  ChevronRightIcon,
  CheckIcon,
  TrashIcon,
  DownloadIcon,
  FolderIcon,
  ClaudeIcon,
  CodexIcon,
  OpenCodeIcon,
  OllamaIcon,
} from "../icons";
import { resolveNoteByTitle } from "../../lib/wikilinks";
import { isAllowedUrlScheme, normalizeUrl } from "../../lib/urls";
import { mod } from "../../lib/platform";
import type { AiProvider } from "../../services/ai";
import { getAvailableAiProviders } from "../../services/ai";
import type { NoteMetadata } from "../../types/note";

// ---------------------------------------------------------------------------
// Context model — built on every right-click from the editor state
// ---------------------------------------------------------------------------

export interface EditorMenuContext {
  hasSelection: boolean;
  /** Selected text with paragraphs separated by \n\n */
  selectedText: string;
  /** Selection serialized as markdown (mirrors native copy behavior) */
  selectionMarkdown: string;
  /** Up to 80 chars before the selection, used to locate it in the file */
  textBefore: string;
  table: { isFirstRow: boolean; isFirstColumn: boolean } | null;
  wikilink: { noteTitle: string; exists: boolean } | null;
  externalLink: { href: string } | null;
}

export function buildMenuContext(
  editor: TiptapEditor,
  clientX: number,
  clientY: number,
  target: EventTarget | null,
  notes: NoteMetadata[] | null,
): EditorMenuContext {
  const view = editor.view;
  const state = editor.state;

  // Native-style caret placement: keep the selection when the click lands
  // inside it, otherwise move the caret to the clicked position. No focus()
  // here — stealing focus during contextmenu can scroll the caret into view.
  const coords = view.posAtCoords({ left: clientX, top: clientY });
  if (coords) {
    const { from, to } = state.selection;
    if (coords.pos < from || coords.pos > to) {
      view.dispatch(
        state.tr.setSelection(TextSelection.create(state.doc, coords.pos)),
      );
    }
  }

  const { from, to, empty } = editor.state.selection;
  const selectedText = empty
    ? ""
    : editor.state.doc.textBetween(from, to, "\n\n");
  const selectionMarkdown = empty ? "" : sliceToMarkdown(editor, from, to);

  // A few characters right before the selection (same text block), so the
  // agent can locate an identical selection elsewhere in the file
  let textBefore = "";
  if (!empty) {
    const $from = editor.state.doc.resolve(from);
    let blockStart = from;
    for (let d = $from.depth; d >= 0; d--) {
      if ($from.node(d).isTextblock) {
        blockStart = $from.start(d);
        break;
      }
    }
    if (from > blockStart) {
      textBefore = editor.state.doc
        .textBetween(blockStart, from, " ")
        .slice(-80);
    }
  }

  const $anchor = editor.state.selection.$anchor;
  const table = findTableContext(editor.state.doc, $anchor);

  let wikilink: EditorMenuContext["wikilink"] = null;
  const el = target as HTMLElement | null;
  const wikilinkEl = el?.closest?.("[data-wikilink]") as HTMLElement | null;
  // Existence can only be checked with the notes list (absent in preview
  // windows) — skip the section entirely there rather than showing a wrong
  // "doesn't exist" state
  if (wikilinkEl && notes) {
    const noteTitle = wikilinkEl.getAttribute("data-note-title") ?? "";
    if (noteTitle) {
      wikilink = {
        noteTitle,
        exists: !!resolveNoteByTitle(noteTitle, notes),
      };
    }
  }

  let externalLink: EditorMenuContext["externalLink"] = null;
  if (!wikilinkEl) {
    const linkEl = el?.closest?.("a[href]") as HTMLAnchorElement | null;
    const href = linkEl?.getAttribute("href");
    if (href) externalLink = { href };
  }

  return {
    hasSelection: !empty,
    selectedText,
    selectionMarkdown,
    textBefore,
    table,
    wikilink,
    externalLink,
  };
}

function sliceToMarkdown(
  editor: TiptapEditor,
  from: number,
  to: number,
): string {
  try {
    const manager = editor.storage.markdown?.manager;
    if (manager) {
      const slice = editor.state.doc.slice(from, to);
      const doc = editor.schema.topNodeType.create(null, slice.content);
      return manager.serialize(doc.toJSON());
    }
  } catch {
    // fall through to plain text
  }
  return editor.state.doc.textBetween(from, to, "\n\n");
}

function findTableContext(doc: ProseMirrorNode, $anchor: ResolvedPos) {
  const resolved = doc.resolve($anchor.pos);
  let cellDepth = $anchor.depth;
  while (
    cellDepth > 0 &&
    resolved.node(cellDepth).type.name !== "tableCell" &&
    resolved.node(cellDepth).type.name !== "tableHeader"
  ) {
    cellDepth--;
  }
  if (cellDepth <= 0) return null;

  const cellPos = $anchor.before(cellDepth);
  const rowNode = doc.resolve(cellPos).node(cellDepth - 1);
  let cellIndex = 0;
  rowNode.forEach((_node, offset) => {
    if (offset < cellPos - $anchor.before(cellDepth - 1) - 1) cellIndex++;
  });
  const tableNode = doc.resolve(cellPos).node(cellDepth - 2);
  let rowIndex = 0;
  tableNode.forEach((_node, offset) => {
    if (
      offset <
      $anchor.before(cellDepth - 1) - $anchor.before(cellDepth - 2) - 1
    ) {
      rowIndex++;
    }
  });
  return { isFirstRow: rowIndex === 0, isFirstColumn: cellIndex === 0 };
}

// ---------------------------------------------------------------------------
// Agent prompts — the CLIs edit the whole file, so selection-scoped presets
// embed the selection plus enough context to locate it unambiguously
// ---------------------------------------------------------------------------

function selectionPrompt(instruction: string, ctx: EditorMenuContext): string {
  const parts = [
    "In this markdown file, find the following selected text:",
    '"""',
    ctx.selectedText,
    '"""',
  ];
  if (ctx.textBefore.trim()) {
    parts.push(
      `It appears right after this text — use it to locate the right spot if the selection text appears more than once: "${ctx.textBefore}"`,
    );
  }
  parts.push(
    "Apply this instruction to ONLY that selection and leave the rest of the file exactly unchanged:",
    instruction,
  );
  return parts.join("\n");
}

function customPromptTemplate(ctx: EditorMenuContext | null): string {
  if (ctx?.hasSelection) {
    return [
      "Apply my instruction below to ONLY this selected text, leaving the rest of the note unchanged:",
      '"""',
      ctx.selectedText,
      '"""',
      "",
      "Instruction: ",
    ].join("\n");
  }
  return "Instruction: ";
}

const SELECTION_PRESETS: Array<{ label: string; instruction: string }> = [
  {
    label: "Fix spelling & grammar",
    instruction:
      "Fix all spelling and grammar mistakes. Keep the author's voice, meaning, language and markdown formatting exactly. Do not add any commentary.",
  },
  {
    label: "Improve writing",
    instruction:
      "Improve clarity and flow. Preserve the meaning, language and markdown formatting. Do not add any commentary.",
  },
  {
    label: "Make more concise",
    instruction:
      "Rewrite the text more concisely while keeping every key point. Preserve markdown formatting and language. Do not add any commentary.",
  },
  {
    label: "Rewrite as bullet points",
    instruction:
      "Rewrite the text as markdown bullet points, one bullet per key idea. Preserve language. Do not add any commentary.",
  },
];

const TRANSLATE_LANGUAGES = [
  "English",
  "Vietnamese",
  "Simplified Chinese",
  "German",
  "French",
  "Spanish",
  "Japanese",
];

const NOTE_PRESETS: Array<{ label: string; instruction: string }> = [
  {
    label: "Continue writing",
    instruction:
      "Continue writing the note from where it ends. Match the existing style, tone and language. Write at most 3 paragraphs, do not repeat existing content, and do not add commentary.",
  },
  {
    label: "Summarize this note",
    instruction:
      "Append a '## Summary' section at the end of the note with a 2-4 sentence summary of the whole note. Do not change the existing content.",
  },
  {
    label: "Suggest tags",
    instruction:
      "Do not modify the note. Reply only with 3-5 relevant tags for this note, one per line, each formatted as #tag.",
  },
];

const PROVIDER_NAMES: Record<AiProvider, string> = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
  ollama: "Ollama",
};

function ProviderIcon({
  provider,
  className,
}: {
  provider: AiProvider;
  className: string;
}) {
  if (provider === "codex") return <CodexIcon className={className} />;
  if (provider === "opencode") return <OpenCodeIcon className={className} />;
  if (provider === "ollama") return <OllamaIcon className={className} />;
  return <ClaudeIcon className={className} />;
}

// ---------------------------------------------------------------------------
// Menu — same Radix primitive and styling as the sidebar context menus
// ---------------------------------------------------------------------------

const menuItemClass =
  "px-3 py-1.5 text-sm text-text cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted flex items-center gap-2 rounded-md data-[disabled]:opacity-50 data-[disabled]:pointer-events-none";
const menuSeparatorClass = "h-px bg-border my-1";
// Horizontal padding on the content insets the hover pills from the border
const menuContentClass =
  "min-w-52 bg-bg border border-border rounded-md shadow-lg px-1.5 py-1.5 z-50";
const shortcutClass = "ml-auto pl-6 text-xs text-text-muted";
const iconClass = "w-4 h-4 stroke-[1.6] shrink-0";

interface EditorContextMenuProps {
  editor: TiptapEditor | null;
  notes: NoteMetadata[] | null;
  /** AI section only renders when the host wires an agent runner */
  aiProvider?: AiProvider | null;
  onSelectAiProvider?: (provider: AiProvider) => void;
  onRunAiPrompt?: (prompt: string) => void;
  onOpenAiPromptModal?: (initialPrompt: string) => void;
  onOpenWikilink?: (noteTitle: string) => void;
  onExportPdf?: () => void;
  note?: { title: string; path: string } | null;
  children: ReactNode;
}

export function EditorContextMenu({
  editor,
  notes,
  aiProvider,
  onSelectAiProvider,
  onRunAiPrompt,
  onOpenAiPromptModal,
  onOpenWikilink,
  onExportPdf,
  note,
  children,
}: EditorContextMenuProps) {
  const [ctx, setCtx] = useState<EditorMenuContext | null>(null);
  const [availableProviders, setAvailableProviders] = useState<AiProvider[]>(
    [],
  );

  // Same detection the command palette uses; CLI installs are checked once
  useEffect(() => {
    let active = true;
    getAvailableAiProviders()
      .then((providers) => {
        if (active) setAvailableProviders(providers);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!editor) return <>{children}</>;

  const activeProvider =
    aiProvider && availableProviders.includes(aiProvider)
      ? aiProvider
      : (availableProviders[0] ?? null);
  const aiEnabled = !!onRunAiPrompt && !!onOpenAiPromptModal && !!activeProvider;

  const runPreset = (instruction: string) => {
    if (!ctx) return;
    onRunAiPrompt?.(
      ctx.hasSelection ? selectionPrompt(instruction, ctx) : instruction,
    );
  };

  const doCopy = async () => {
    if (!ctx?.hasSelection) return;
    try {
      await writeText(ctx.selectionMarkdown);
    } catch {
      toast.error("Failed to copy");
    }
  };

  const doCut = async () => {
    if (!ctx?.hasSelection) return;
    try {
      await writeText(ctx.selectionMarkdown);
    } catch {
      return;
    }
    editor.chain().focus().deleteSelection().run();
  };

  // The clipboard plugin is text-only; a synthetic paste event lets
  // ProseMirror (and the markdown paste parser) process it natively
  const doPaste = async () => {
    try {
      const text = await readText();
      editor.commands.focus();
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      editor.view.dom.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }),
      );
    } catch {
      toast.error("No text in clipboard");
    }
  };

  const doSearchWeb = () => {
    const query = ctx?.selectedText.trim().slice(0, 100);
    if (!query) return;
    openUrl(`https://www.google.com/search?q=${encodeURIComponent(query)}`).catch(
      () => toast.error("Could not open browser"),
    );
  };

  const doOpenLink = () => {
    const href = normalizeUrl(ctx?.externalLink?.href ?? "");
    if (!isAllowedUrlScheme(href)) {
      toast.error("Cannot open links with this URL scheme");
      return;
    }
    openUrl(href).catch(() => toast.error("Failed to open link"));
  };

  const doCopyNoteMarkdown = async () => {
    try {
      const manager = editor.storage.markdown?.manager;
      const markdown = manager
        ? manager.serialize(editor.getJSON()).replace(/&nbsp;|&#160;/g, " ")
        : editor.getText();
      await writeText(markdown);
      toast.success("Note copied as Markdown");
    } catch {
      toast.error("Failed to copy note");
    }
  };

  const doRevealNote = () => {
    if (!note?.path) return;
    invoke("open_in_file_manager", { path: note.path }).catch(() =>
      toast.error("Could not open folder"),
    );
  };

  const chain = () => editor.chain().focus();

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        asChild
        onContextMenu={(e) => {
          setCtx(buildMenuContext(editor, e.clientX, e.clientY, e.target, notes));
        }}
      >
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className={menuContentClass}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            editor.view.dom.focus({ preventScroll: true });
          }}
        >
          {ctx?.wikilink && (
            <>
              <ContextMenu.Item
                className={menuItemClass}
                disabled={!ctx.wikilink.exists}
                onSelect={() => onOpenWikilink?.(ctx.wikilink!.noteTitle)}
              >
                <NoteIcon className={iconClass} />
                {ctx.wikilink.exists
                  ? `Open "${truncate(ctx.wikilink.noteTitle, 24)}"`
                  : `Note "${truncate(ctx.wikilink.noteTitle, 24)}" doesn't exist`}
              </ContextMenu.Item>
              <ContextMenu.Item
                className={menuItemClass}
                onSelect={() => void writeText(ctx.wikilink!.noteTitle)}
              >
                <CopyIcon className={iconClass} />
                Copy note title
              </ContextMenu.Item>
              <ContextMenu.Separator className={menuSeparatorClass} />
            </>
          )}

          {ctx?.externalLink && (
            <>
              <ContextMenu.Item className={menuItemClass} onSelect={doOpenLink}>
                <ExternalLinkIcon className={iconClass} />
                Open link
              </ContextMenu.Item>
              <ContextMenu.Item
                className={menuItemClass}
                onSelect={() => void writeText(ctx.externalLink!.href)}
              >
                <CopyIcon className={iconClass} />
                Copy link address
              </ContextMenu.Item>
              <ContextMenu.Item
                className={menuItemClass}
                onSelect={() => chain().extendMarkRange("link").unsetLink().run()}
              >
                <LinkOffIcon className={iconClass} />
                Remove link
              </ContextMenu.Item>
              <ContextMenu.Separator className={menuSeparatorClass} />
            </>
          )}

          <ContextMenu.Item
            className={menuItemClass}
            disabled={!ctx?.hasSelection}
            onSelect={() => void doCut()}
          >
            <ScissorsIcon className={iconClass} />
            Cut
            <span className={shortcutClass}>{mod}+X</span>
          </ContextMenu.Item>
          <ContextMenu.Item
            className={menuItemClass}
            disabled={!ctx?.hasSelection}
            onSelect={() => void doCopy()}
          >
            <CopyIcon className={iconClass} />
            Copy
            <span className={shortcutClass}>{mod}+C</span>
          </ContextMenu.Item>
          <ContextMenu.Item
            className={menuItemClass}
            onSelect={() => void doPaste()}
          >
            <ClipboardIcon className={iconClass} />
            Paste
            <span className={shortcutClass}>{mod}+V</span>
          </ContextMenu.Item>
          <ContextMenu.Item className={menuItemClass} onSelect={() => chain().selectAll().run()}>
            <SelectAllIcon className={iconClass} />
            Select All
            <span className={shortcutClass}>{mod}+A</span>
          </ContextMenu.Item>

          {ctx?.hasSelection && (
            <>
              <ContextMenu.Separator className={menuSeparatorClass} />
              <ContextMenu.Item
                className={menuItemClass}
                onSelect={() => chain().toggleBold().run()}
              >
                <BoldIcon className={iconClass} />
                Bold
              </ContextMenu.Item>
              <ContextMenu.Item
                className={menuItemClass}
                onSelect={() => chain().toggleItalic().run()}
              >
                <ItalicIcon className={iconClass} />
                Italic
              </ContextMenu.Item>
              <ContextMenu.Item
                className={menuItemClass}
                onSelect={() => chain().toggleStrike().run()}
              >
                <StrikethroughIcon className={iconClass} />
                Strikethrough
              </ContextMenu.Item>
              <ContextMenu.Item
                className={menuItemClass}
                onSelect={() => chain().toggleCode().run()}
              >
                <InlineCodeIcon className={iconClass} />
                Code
              </ContextMenu.Item>
            </>
          )}

          {aiEnabled && ctx && (
            <>
              <ContextMenu.Separator className={menuSeparatorClass} />
              <ContextMenu.Sub>
                <ContextMenu.SubTrigger className={menuItemClass + " justify-between"}>
                  <span className="flex items-center gap-2">
                    <ProviderIcon
                      provider={activeProvider!}
                      className="w-4 h-4 fill-text-muted shrink-0"
                    />
                    Agent: {PROVIDER_NAMES[activeProvider!]}
                  </span>
                  <ChevronRightIcon className="w-3.5 h-3.5 stroke-[1.6] text-text-muted" />
                </ContextMenu.SubTrigger>
                <ContextMenu.Portal>
                  <ContextMenu.SubContent className={menuContentClass}>
                    {availableProviders.map((provider) => (
                      <ContextMenu.Item
                        key={provider}
                        className={menuItemClass}
                        onSelect={() => onSelectAiProvider?.(provider)}
                      >
                        <ProviderIcon
                          provider={provider}
                          className="w-4 h-4 fill-text-muted shrink-0"
                        />
                        {PROVIDER_NAMES[provider]}
                        {provider === activeProvider && (
                          <CheckIcon className="w-3.5 h-3.5 stroke-[1.6] ml-auto" />
                        )}
                      </ContextMenu.Item>
                    ))}
                  </ContextMenu.SubContent>
                </ContextMenu.Portal>
              </ContextMenu.Sub>

              {ctx.hasSelection &&
                SELECTION_PRESETS.map((preset) => (
                  <ContextMenu.Item
                    key={preset.label}
                    className={menuItemClass}
                    onSelect={() => runPreset(preset.instruction)}
                  >
                    <ProviderIcon
                      provider={activeProvider!}
                      className="w-4 h-4 fill-text-muted shrink-0"
                    />
                    {preset.label}
                  </ContextMenu.Item>
                ))}

              {ctx.hasSelection && (
                <ContextMenu.Sub>
                  <ContextMenu.SubTrigger
                    className={menuItemClass + " justify-between"}
                  >
                    <span className="flex items-center gap-2">
                      <ProviderIcon
                        provider={activeProvider!}
                        className="w-4 h-4 fill-text-muted shrink-0"
                      />
                      Translate
                    </span>
                    <ChevronRightIcon className="w-3.5 h-3.5 stroke-[1.6] text-text-muted" />
                  </ContextMenu.SubTrigger>
                  <ContextMenu.Portal>
                    <ContextMenu.SubContent className={menuContentClass}>
                      {TRANSLATE_LANGUAGES.map((lang) => (
                        <ContextMenu.Item
                          key={lang}
                          className={menuItemClass}
                          onSelect={() =>
                            runPreset(
                              `Translate the selected text into ${lang}. Keep markdown formatting, code blocks and proper nouns unchanged. Do not add any commentary.`,
                            )
                          }
                        >
                          {lang}
                        </ContextMenu.Item>
                      ))}
                    </ContextMenu.SubContent>
                  </ContextMenu.Portal>
                </ContextMenu.Sub>
              )}

              {!ctx.hasSelection &&
                NOTE_PRESETS.map((preset) => (
                  <ContextMenu.Item
                    key={preset.label}
                    className={menuItemClass}
                    onSelect={() => runPreset(preset.instruction)}
                  >
                    <ProviderIcon
                      provider={activeProvider!}
                      className="w-4 h-4 fill-text-muted shrink-0"
                    />
                    {preset.label}
                  </ContextMenu.Item>
                ))}

              <ContextMenu.Item
                className={menuItemClass}
                onSelect={() =>
                  onOpenAiPromptModal?.(customPromptTemplate(ctx))
                }
              >
                <ProviderIcon
                  provider={activeProvider!}
                  className="w-4 h-4 fill-text-muted shrink-0"
                />
                Custom prompt…
              </ContextMenu.Item>
            </>
          )}

          {ctx?.hasSelection && (
            <>
              <ContextMenu.Separator className={menuSeparatorClass} />
              <ContextMenu.Item className={menuItemClass} onSelect={doSearchWeb}>
                <SearchIcon className={iconClass} />
                {`Search the web for "${truncate(ctx.selectedText.trim(), 24)}"`}
              </ContextMenu.Item>
            </>
          )}

          {ctx?.table && (
            <>
              <ContextMenu.Separator className={menuSeparatorClass} />
              {!ctx.table.isFirstColumn && (
                <ContextMenu.Item
                  className={menuItemClass}
                  onSelect={() => chain().addColumnBefore().run()}
                >
                  Add Column Before
                </ContextMenu.Item>
              )}
              <ContextMenu.Item
                className={menuItemClass}
                onSelect={() => chain().addColumnAfter().run()}
              >
                Add Column After
              </ContextMenu.Item>
              <ContextMenu.Item
                className={menuItemClass}
                onSelect={() => chain().deleteColumn().run()}
              >
                Delete Column
              </ContextMenu.Item>
              <ContextMenu.Separator className={menuSeparatorClass} />
              {!ctx.table.isFirstRow && (
                <ContextMenu.Item
                  className={menuItemClass}
                  onSelect={() => chain().addRowBefore().run()}
                >
                  Add Row Above
                </ContextMenu.Item>
              )}
              <ContextMenu.Item
                className={menuItemClass}
                onSelect={() => chain().addRowAfter().run()}
              >
                Add Row Below
              </ContextMenu.Item>
              <ContextMenu.Item
                className={menuItemClass}
                onSelect={() => chain().deleteRow().run()}
              >
                Delete Row
              </ContextMenu.Item>
              <ContextMenu.Separator className={menuSeparatorClass} />
              <ContextMenu.Item
                className={menuItemClass}
                onSelect={() => chain().toggleHeaderRow().run()}
              >
                Toggle Header Row
              </ContextMenu.Item>
              <ContextMenu.Item
                className={menuItemClass}
                onSelect={() => chain().toggleHeaderColumn().run()}
              >
                Toggle Header Column
              </ContextMenu.Item>
              <ContextMenu.Separator className={menuSeparatorClass} />
              <ContextMenu.Item
                className={
                  menuItemClass +
                  " text-red-500 hover:text-red-500 focus:text-red-500"
                }
                onSelect={() => chain().deleteTable().run()}
              >
                <TrashIcon className={iconClass} />
                Delete Table
              </ContextMenu.Item>
            </>
          )}

          {note && onExportPdf && !ctx?.hasSelection && (
            <>
              <ContextMenu.Separator className={menuSeparatorClass} />
              <ContextMenu.Item className={menuItemClass} onSelect={onExportPdf}>
                <DownloadIcon className={iconClass} />
                Export as PDF…
              </ContextMenu.Item>
              <ContextMenu.Item
                className={menuItemClass}
                onSelect={() => void doCopyNoteMarkdown()}
              >
                <CopyIcon className={iconClass} />
                Copy as Markdown
              </ContextMenu.Item>
              <ContextMenu.Item className={menuItemClass} onSelect={doRevealNote}>
                <FolderIcon className={iconClass} />
                Reveal in Explorer
              </ContextMenu.Item>
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function truncate(text: string, max: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max)}…` : single;
}
