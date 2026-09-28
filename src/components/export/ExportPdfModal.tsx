import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button, Input, Select } from "../ui";
import { DownloadIcon, SpinnerIcon } from "../icons";
import { exportPdf } from "../../services/pdf";
import { getSettings, updateSettings } from "../../services/notes";
import {
  DEFAULT_PDF_EXPORT_OPTIONS,
  type PdfExportOptions,
} from "../../types/note";

interface ExportPdfModalProps {
  open: boolean;
  onClose: () => void;
  filePath: string;
  noteTitle: string;
}

export function ExportPdfModal({
  open,
  onClose,
  filePath,
  noteTitle,
}: ExportPdfModalProps) {
  const [options, setOptions] = useState<PdfExportOptions>(
    DEFAULT_PDF_EXPORT_OPTIONS,
  );
  const [loaded, setLoaded] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Load the last-used options when the modal opens
  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    getSettings()
      .then((settings) => {
        if (settings.pdfExport) {
          setOptions({ ...DEFAULT_PDF_EXPORT_OPTIONS, ...settings.pdfExport });
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [open]);

  // Escape closes (unless exporting)
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isExporting) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [open, isExporting, onClose]);

  if (!open) return null;

  const set = <K extends keyof PdfExportOptions>(
    key: K,
    value: PdfExportOptions[K],
  ) => setOptions((prev) => ({ ...prev, [key]: value }));

  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const result = await exportPdf(filePath, noteTitle, options);
      if (result.status === "cancelled") {
        onClose();
        return;
      }
      if (result.status === "fallback-to-print") {
        toast.info("Direct PDF export needs the WebView2 runtime — opening the print dialog instead");
        onClose();
        setTimeout(() => window.print(), 100);
        return;
      }
      // Remember the choices for next time
      try {
        const settings = await getSettings();
        await updateSettings({ ...settings, pdfExport: options });
      } catch {
        // Persistence is best-effort
      }
      const folder = result.path.replace(/[\\/][^\\/]+$/, "");
      const showInFolder = {
        label: "Show in folder",
        onClick: () => {
          invoke("open_in_file_manager", { path: folder }).catch(() =>
            toast.error("Could not open folder"),
          );
        },
      };
      if (result.bookmarkNote) {
        toast.warning(`Exported "${noteTitle}.pdf" (no bookmarks)`, {
          description: `${result.bookmarkNote} — the PDF itself is fine.`,
          duration: 8000,
          action: showInFolder,
        });
      } else {
        toast.success(`Exported "${noteTitle}.pdf"`, {
          description: folder,
          action: showInFolder,
        });
      }
      onClose();
    } catch (err) {
      console.error("PDF export failed:", err);
      toast.error(err instanceof Error ? err.message : "PDF export failed");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center py-11 px-4 bg-text/50 backdrop-blur-sm"
      onClick={() => !isExporting && onClose()}
    >
      <div
        className="w-full max-w-md bg-bg rounded-xl shadow-2xl overflow-hidden border border-border animate-slide-down"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border flex items-center gap-3 px-4.5 py-3.5">
          <DownloadIcon className="w-5 h-5 text-text-muted" />
          <span className="text-[17px] text-text font-medium">
            Export as PDF
          </span>
        </div>

        <div className="p-4.5 space-y-3">
          <div className="text-sm text-text-muted truncate" title={noteTitle}>
            {noteTitle}
          </div>

          <div className="rounded-[10px] border border-border pl-4 py-3 pr-3 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm text-text font-medium">Paper</label>
              <Select
                value={options.paper}
                onChange={(e) =>
                  set("paper", e.target.value as PdfExportOptions["paper"])
                }
                className="w-36"
              >
                <option value="a4">A4</option>
                <option value="letter">Letter</option>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-sm text-text font-medium">
                Orientation
              </label>
              <Select
                value={options.orientation}
                onChange={(e) =>
                  set(
                    "orientation",
                    e.target.value as PdfExportOptions["orientation"],
                  )
                }
                className="w-36"
              >
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-sm text-text font-medium">Margins</label>
              <Select
                value={options.margins}
                onChange={(e) =>
                  set("margins", e.target.value as PdfExportOptions["margins"])
                }
                className="w-36"
              >
                <option value="narrow">Narrow</option>
                <option value="normal">Normal</option>
                <option value="wide">Wide</option>
              </Select>
            </div>

            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm text-text font-medium">
                Include frontmatter
              </span>
              <input
                type="checkbox"
                checked={options.includeFrontmatter}
                onChange={(e) => set("includeFrontmatter", e.target.checked)}
                className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm text-text font-medium">
                Page numbers &amp; title header
              </span>
              <input
                type="checkbox"
                checked={options.pageNumbers}
                onChange={(e) => set("pageNumbers", e.target.checked)}
                className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
              />
            </label>

            <div className="flex items-center justify-between">
              <label className="text-sm text-text font-medium">Font size</label>
              <div className="w-36 flex items-center gap-2">
                <Input
                  type="number"
                  min="8"
                  max="40"
                  step="1"
                  value={options.fontSize ?? ""}
                  placeholder="Auto"
                  onChange={(e) => {
                    const parsed = parseInt(e.target.value, 10);
                    set(
                      "fontSize",
                      Number.isFinite(parsed) && parsed >= 8 && parsed <= 40
                        ? parsed
                        : undefined,
                    );
                  }}
                  className="w-full h-9 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-sm text-text-muted shrink-0">px</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-1.5 text-sm text-text-muted">
              <kbd className="text-xs px-1.5 py-0.5 rounded-md bg-bg-muted text-text-muted">
                Esc
              </kbd>
              <span>to cancel</span>
            </div>
            <Button
              onClick={handleExport}
              disabled={!loaded || isExporting}
              variant="primary"
              size="md"
            >
              {isExporting ? (
                <>
                  <SpinnerIcon className="w-3.25 h-3.25 mr-2 animate-spin" />
                  Exporting...
                </>
              ) : (
                "Export"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
