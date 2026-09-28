import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { buildPreviewExtensions } from "../editor/previewExtensions";
import { readFileDirect } from "../../services/files";
import type { PdfBookmark } from "../../types/note";

interface ExportPdfAppProps {
  filePath: string;
  includeFrontmatter: boolean;
  fontSize?: number;
}

/**
 * Hidden-window page that renders a note through the same theme/font pipeline
 * as the editor, then signals "pdf-ready" so the Rust side can print it to
 * PDF. Heading ids (bmk-N) are assigned here in document order and reported
 * along with their titles so the PDF outline can be built afterwards.
 */
export function ExportPdfApp({
  filePath,
  includeFrontmatter,
  fontSize,
}: ExportPdfAppProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const signaledRef = useRef(false);

  useEffect(() => {
    // The export must not inherit the user's interface zoom.
    document.documentElement.style.zoom = "1";
    readFileDirect(filePath)
      .then((result) => setContent(result.content))
      .catch((error) => {
        console.error("Failed to load file for PDF export:", error);
        setLoadError(true);
      });
  }, [filePath]);

  // Export-specific font size: inline custom properties on the wrapper div —
  // NOT documentElement. ThemeProvider's effect writes the saved editor size
  // to documentElement and runs after this component's effects (child before
  // parent), so a document-level override here would always be clobbered.
  // Descendant inline properties shadow the document-level ones regardless
  // of effect order, and nothing is persisted.
  const fontSizeStyle: CSSProperties | undefined =
    fontSize == null
      ? undefined
      : ({
          "--editor-base-font-size": `${fontSize}px`,
          "--editor-h1-size": `${fontSize * 2.25}px`,
          "--editor-h2-size": `${fontSize * 1.75}px`,
          "--editor-h3-size": `${fontSize * 1.5}px`,
          "--editor-h4-size": `${fontSize * 1.25}px`,
          "--editor-h5-size": `${fontSize}px`,
          "--editor-h6-size": `${fontSize}px`,
        } as CSSProperties);

  const editor = useEditor({
    editable: false,
    extensions: buildPreviewExtensions(),
    editorProps: {
      attributes: {
        class: "prose prose-lg dark:prose-invert max-w-none pdf-content",
      },
    },
  });

  // Load the markdown into the document, dropping frontmatter unless included
  useEffect(() => {
    if (!editor || content === null) return;
    const manager = (
      editor.storage as unknown as {
        markdown?: { manager?: { parse: (md: string) => unknown } };
      }
    ).markdown?.manager;
    if (!manager) return;
    let json = manager.parse(content) as {
      content?: Array<{ type: string }>;
    } | null;
    if (!includeFrontmatter && json?.content) {
      json = {
        ...json,
        content: json.content.filter((node) => node.type !== "frontmatter"),
      };
    }
    editor.commands.setContent(json ?? "");
  }, [editor, content, includeFrontmatter]);

  // Wait for fonts/images/mermaid to settle, tag headings, signal readiness
  useEffect(() => {
    if (!editor || content === null) return;
    let cancelled = false;

    const signal = () => {
      if (cancelled || signaledRef.current) return;
      signaledRef.current = true;
      const headings: PdfBookmark[] = [];
      editor.view.dom
        .querySelectorAll("h1,h2,h3,h4,h5,h6")
        .forEach((h, i) => {
          const el = h as HTMLElement;
          el.id = `bmk-${i}`;
          // Wrap the heading in an invisible anchor targeting its own id —
          // Chromium's PDF writer records a named destination (/Dests bmk-N)
          // for every internal link target, which the Rust side turns into
          // PDF outline entries (bookmarks). No anchor, no bookmark.
          const anchor = document.createElement("a");
          anchor.setAttribute("href", `#bmk-${i}`);
          anchor.setAttribute("style", "color:inherit;text-decoration:none");
          anchor.innerHTML = el.innerHTML;
          el.innerHTML = "";
          el.appendChild(anchor);
          headings.push({
            level: Number(el.tagName[1]),
            text: el.textContent?.trim() ?? "",
          });
        });
      requestAnimationFrame(() => {
        emit("pdf-ready", {
          label: getCurrentWindow().label,
          headings,
        }).catch(() => {});
      });
    };

    // Give async node views (mermaid SVG, code highlighting) a moment to finish
    const settleTimer = setTimeout(() => {
      if (cancelled) return;
      const images = Array.from(editor.view.dom.querySelectorAll("img"));
      const pending = images.filter((img) => !img.complete);
      const finish = () => {
        document.fonts.ready.then(() => {
          // One extra frame for KaTeX/layout after fonts are in
          setTimeout(signal, 250);
        });
      };
      if (pending.length > 0) {
        let remaining = pending.length;
        const onOne = () => {
          remaining -= 1;
          if (remaining === 0) finish();
        };
        pending.forEach((img) => {
          img.addEventListener("load", onOne, { once: true });
          img.addEventListener("error", onOne, { once: true });
        });
        // Don't hang forever on a broken image
        setTimeout(finish, 5000);
      } else {
        finish();
      }
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(settleTimer);
    };
  }, [editor, content]);

  if (loadError) {
    // Emit an empty heading list so the backend does not wait for the timeout
    if (!signaledRef.current) {
      signaledRef.current = true;
      emit("pdf-ready", {
        label: getCurrentWindow().label,
        headings: [],
      }).catch(() => {});
    }
    return (
      <div className="pdf-root">
        <p className="p-8 text-sm text-text-muted">
          Failed to load this note for export.
        </p>
      </div>
    );
  }

  return (
    <div className="pdf-root" style={fontSizeStyle}>
      <div className="pdf-page">
        <EditorContent editor={editor ?? undefined} className="h-full" />
      </div>
    </div>
  );
}
