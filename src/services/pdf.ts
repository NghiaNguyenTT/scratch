import type { Editor } from "@tiptap/react";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type { PdfBookmark, PdfExportOptions } from "../types/note";

/**
 * Legacy print flow: opens the native print dialog over the whole app UI.
 * Kept for physical printers and as the fallback on platforms without the
 * direct WebView2 PDF export.
 */
export async function downloadPdf(
  editor: Editor,
  _noteTitle: string
): Promise<void> {
  if (!editor) throw new Error("Editor not available");

  window.print();
}

/**
 * Export a note as a PDF file. The backend renders the note in a dedicated
 * hidden webview (same theme/font pipeline as the editor), prints it with
 * WebView2's native PrintToPdf and adds a heading outline (bookmarks).
 *
 * @returns true when the PDF was written, false when the user cancelled the
 *          save dialog.
 */
export type ExportPdfResult =
  | { status: "saved"; path: string; bookmarkNote?: string }
  | { status: "cancelled" }
  | { status: "fallback-to-print" };

export async function exportPdf(
  filePath: string,
  title: string,
  options: PdfExportOptions
): Promise<ExportPdfResult> {
  const sanitized = sanitizeFilename(title);
  const outputPath = await save({
    defaultPath: `${sanitized}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!outputPath) return { status: "cancelled" };

  try {
    // Headings are measured by the export page itself; an empty list is fine.
    const headings: PdfBookmark[] = [];
    const backendStatus = (await invoke<string>("export_note_pdf", {
      filePath,
      outputPath,
      title,
      options,
      headings,
    })) as string;
    let bookmarkNote: string | undefined;
    if (backendStatus.startsWith("exported-without-bookmarks:")) {
      bookmarkNote = backendStatus
        .slice("exported-without-bookmarks:".length)
        .trim();
    }
    return { status: "saved", path: outputPath, bookmarkNote };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("only supported on Windows")) {
      return { status: "fallback-to-print" };
    }
    throw new Error(message);
  }
}

/**
 * Downloads the markdown content as a .md file.
 *
 * @param markdown - The markdown content to save
 * @param noteTitle - The note title for the default filename
 * @returns Promise<boolean> - Returns true if file was saved successfully, false if user cancelled
 */
export async function downloadMarkdown(
  markdown: string,
  noteTitle: string
): Promise<boolean> {
  const sanitizedTitle = sanitizeFilename(noteTitle);

  // Show native save dialog
  const filePath = await save({
    defaultPath: `${sanitizedTitle}.md`,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });

  if (!filePath) return false; // User cancelled

  // Convert string to bytes and write file using Tauri command
  const encoder = new TextEncoder();
  const uint8Array = encoder.encode(markdown);
  await invoke("write_file", {
    path: filePath,
    contents: Array.from(uint8Array)
  });

  return true;
}

/**
 * Sanitizes a filename by removing invalid characters.
 * Replaces filesystem-unsafe characters with dashes.
 *
 * @param name - The filename to sanitize
 * @returns A filesystem-safe filename
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "-").trim() || "note";
}
