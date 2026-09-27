import { useCallback, useEffect, useRef } from "react";
import {
  EditorContent,
  ReactRenderer,
  useEditor,
  type Editor as TiptapEditor,
} from "@tiptap/react";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { useOptionalNotes } from "../../context/NotesContext";
import * as notesService from "../../services/notes";
import { resolveNoteByTitle } from "../../lib/wikilinks";
import { isAllowedUrlScheme, normalizeUrl } from "../../lib/urls";
import { buildPreviewExtensions } from "./previewExtensions";

const OPEN_DELAY = 300;
const HIDE_DELAY = 160;
const MAX_DEPTH = 3; // max simultaneous stacked previews

interface PreviewPopup {
  depth: number;
  titleLower: string;
  tippy: TippyInstance;
  renderer: ReactRenderer;
  registeredDom: HTMLElement | null;
}

// Read-only TipTap render of a note, used as popup content.
// The note's own H1 acts as the title, so the card adds no header of its own.
function NotePreviewCard({
  markdown,
  onDom,
}: {
  markdown: string;
  onDom: (dom: HTMLElement | null) => void;
}) {
  const editor = useEditor(
    {
      editable: false,
      extensions: buildPreviewExtensions(),
      content: "",
      editorProps: {
        attributes: {
          class: "prose prose-lg dark:prose-invert focus:outline-none px-5 pt-3 pb-4",
        },
      },
    },
    [],
  );

  // Register the card root (not just the ProseMirror element) so hover and
  // scroll handling treats the entire popup as the preview container
  const rootRef = useCallback(
    (el: HTMLDivElement | null) => onDom(el),
    [onDom],
  );

  useEffect(() => {
    if (!editor) return;
    const manager = editor.storage.markdown?.manager;
    if (manager) {
      try {
        editor.commands.setContent(manager.parse(markdown));
        return;
      } catch {
        // fall through to raw string
      }
    }
    editor.commands.setContent(markdown);
  }, [editor, markdown]);

  return (
    <div
      ref={rootRef}
      className="w-[620px] max-w-[90vw] bg-bg border border-border rounded-lg shadow-lg overflow-hidden animate-fade-in"
    >
      <div
        data-preview-scroll
        className="max-h-[70vh] overflow-y-auto overscroll-contain"
      >
        <EditorContent editor={editor} className="text-text" />
      </div>
    </div>
  );
}

interface WikilinkPreviewHostProps {
  editor: TiptapEditor | null;
}

// Obsidian-style hover page previews for [[wikilinks]]. Renders nothing
// itself; popups are tippy instances on document.body. The main editor's
// ProseMirror DOM registers as level 0, each popup's content as level N+1,
// so links inside previews nest recursively (capped at MAX_DEPTH).
export function WikilinkPreviewHost({ editor }: WikilinkPreviewHostProps) {
  const notesCtx = useOptionalNotes();
  const popupsRef = useRef<PreviewPopup[]>([]);
  // Registered containers: DOM element -> container level (main editor = 0)
  const containersRef = useRef<Map<HTMLElement, number>>(new Map());
  const openTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const lastHoverRef = useRef<string>("");
  const notesRef = useRef(notesCtx);
  notesRef.current = notesCtx;
  const editorRef = useRef(editor);
  editorRef.current = editor;

  const clearTimers = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const closeFrom = useCallback((depth: number) => {
    popupsRef.current = popupsRef.current.filter((p) => {
      if (p.depth >= depth) {
        p.tippy.destroy();
        p.renderer.destroy();
        if (p.registeredDom) containersRef.current.delete(p.registeredDom);
        return false;
      }
      return true;
    });
  }, []);

  const closeAll = useCallback(() => closeFrom(0), [closeFrom]);

  const scheduleHide = useCallback(
    (depth: number) => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null;
        closeFrom(depth);
      }, HIDE_DELAY);
    },
    [closeFrom],
  );

  const openPreview = useCallback(
    async (title: string, anchorRect: DOMRect, depth: number) => {
      const ctx = notesRef.current;
      if (!ctx) return;
      const hostEditor = editorRef.current;
      if (!hostEditor) return;
      const note = resolveNoteByTitle(title, ctx.notes);
      if (!note) return; // unresolved target — no preview

      const titleLower = note.title.toLowerCase();
      const key = `${depth}:${titleLower}`;
      if (lastHoverRef.current !== key) return; // hover moved on while fetching
      // Already showing this note at this level — keep it (avoids flicker)
      const existing = popupsRef.current.find((p) => p.depth === depth);
      if (existing && existing.titleLower === titleLower) return;
      closeFrom(depth); // replace this level and anything deeper

      try {
        const full = await notesService.readNote(note.id);
        if (lastHoverRef.current !== key) return;

        const popup: PreviewPopup = {
          depth,
          titleLower,
          tippy: null as unknown as TippyInstance,
          renderer: null as unknown as ReactRenderer,
          registeredDom: null,
        };
        const onDom = (dom: HTMLElement | null) => {
          if (popup.registeredDom) containersRef.current.delete(popup.registeredDom);
          popup.registeredDom = dom;
          if (dom) containersRef.current.set(dom, depth + 1);
        };

        popup.renderer = new ReactRenderer(NotePreviewCard, {
          editor: hostEditor,
          props: {
            markdown: full.content,
            onDom,
          },
        });
        popup.tippy = tippy(document.body, {
          getReferenceClientRect: () => anchorRect,
          appendTo: () => document.body,
          content: popup.renderer.element,
          showOnCreate: true,
          interactive: true,
          trigger: "manual",
          placement: "right-start",
          offset: [0, 10],
          arrow: false,
          maxWidth: "none",
          popperOptions: {
            modifiers: [
              {
                name: "flip",
                options: {
                  fallbackPlacements: ["left-start", "bottom-start", "top-start"],
                },
              },
              { name: "preventOverflow", options: { padding: 12 } },
            ],
          },
        });
        popupsRef.current.push(popup);
      } catch (err) {
        console.error("Failed to load note preview:", err);
      }
    },
    [closeFrom],
  );

  // Register the main editor DOM as container level 0
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    containersRef.current.set(dom, 0);
    return () => {
      containersRef.current.delete(dom);
      clearTimers();
      closeAll();
    };
  }, [editor, clearTimers, closeAll]);

  // Close previews when the open note changes
  const currentNoteId = notesCtx?.currentNote?.id ?? null;
  useEffect(() => {
    closeAll();
  }, [currentNoteId, closeAll]);

  useEffect(() => {
    const findContainerDepth = (target: Node | null): number => {
      if (!target) return -1;
      for (const [dom, depth] of containersRef.current) {
        if (dom.contains(target)) return depth;
      }
      return -1;
    };

    const cancelHide = () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };

    const handleOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const enteredDepth = findContainerDepth(target);
      // Entering a popup cancels a pending hide (main editor, level 0, does not)
      if (enteredDepth >= 1) cancelHide();

      const linkEl = target.closest?.("[data-wikilink]") as HTMLElement | null;
      if (!linkEl) return;
      const depth = findContainerDepth(linkEl);
      if (depth < 0 || depth >= MAX_DEPTH) return;
      const title = linkEl.getAttribute("data-note-title");
      if (!title) return;
      const key = `${depth}:${title.toLowerCase()}`;
      if (lastHoverRef.current === key) return; // already pending/open
      lastHoverRef.current = key;
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
      openTimerRef.current = window.setTimeout(() => {
        openTimerRef.current = null;
        openPreview(title, linkEl.getBoundingClientRect(), depth);
      }, OPEN_DELAY);
    };

    const handleOut = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const related = e.relatedTarget as Node | null;

      // Leaving a popup card closes it (and anything nested) after a grace period
      const leftDepth = findContainerDepth(target);
      const relatedDepth = findContainerDepth(related);
      if (leftDepth >= 1 && relatedDepth !== leftDepth) {
        lastHoverRef.current = "";
        scheduleHide(leftDepth - 1);
        return;
      }

      // Leaving a wikilink schedules closing the preview it spawned
      const linkEl = target.closest?.("[data-wikilink]") as HTMLElement | null;
      if (!linkEl) return;
      if (related && linkEl.contains(related)) return;
      const depth = findContainerDepth(linkEl);
      if (depth < 0) return;
      lastHoverRef.current = "";
      scheduleHide(depth);
    };

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const depth = findContainerDepth(target);
      if (depth <= 0) return; // main editor handles its own clicks
      const linkEl = target.closest?.("[data-wikilink]") as HTMLElement | null;
      e.stopPropagation();
      if (linkEl) {
        const title = linkEl.getAttribute("data-note-title");
        const note = title
          ? resolveNoteByTitle(title, notesRef.current?.notes ?? [])
          : undefined;
        if (note) {
          notesRef.current?.selectNote(note.id);
        } else {
          toast.info(`Note "${title}" does not exist yet`);
        }
        clearTimers();
        closeAll();
        return;
      }
      const anchor = target.closest?.("a") as HTMLAnchorElement | null;
      if (anchor) {
        e.preventDefault();
        const url = normalizeUrl(anchor.getAttribute("href") ?? "");
        if (isAllowedUrlScheme(url)) {
          openUrl(url).catch((err) => console.error("Failed to open link:", err));
        } else {
          toast.error("Cannot open links with this URL scheme");
        }
      }
    };

    // Any click outside popups dismisses them
    const handlePointerDown = (e: PointerEvent) => {
      if (popupsRef.current.length === 0) return;
      const depth = findContainerDepth(e.target as Node);
      if (depth < 1) {
        clearTimers();
        closeAll();
      }
    };

    // Scrolling the main editor closes previews (popup-internal scrolls don't)
    const handleScroll = (e: Event) => {
      if (popupsRef.current.length === 0) return;
      const depth = findContainerDepth(e.target as Node);
      if (depth < 1) {
        clearTimers();
        closeAll();
      }
    };

    // Escape closes the topmost preview
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || popupsRef.current.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      const top = Math.max(...popupsRef.current.map((p) => p.depth));
      clearTimers();
      closeFrom(top);
    };

    document.addEventListener("mouseover", handleOver);
    document.addEventListener("mouseout", handleOut);
    document.addEventListener("click", handleClick);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("scroll", handleScroll, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("mouseover", handleOver);
      document.removeEventListener("mouseout", handleOut);
      document.removeEventListener("click", handleClick);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("scroll", handleScroll, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [openPreview, scheduleHide, closeFrom, closeAll, clearTimers]);

  return null;
}
