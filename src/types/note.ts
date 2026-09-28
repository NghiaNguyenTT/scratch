export interface NoteMetadata {
  id: string;
  title: string;
  preview: string;
  modified: number;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  path: string;
  modified: number;
}

export interface ThemeSettings {
  mode: "light" | "dark" | "system";
}

export type FontFamily = "system-sans" | "serif" | "monospace" | "custom";
export type TextDirection = "auto" | "ltr" | "rtl";
export type EditorWidth = "narrow" | "normal" | "wide" | "full" | "custom";

export interface EditorFontSettings {
  baseFontFamily?: FontFamily;
  baseFontSize?: number; // in px, default 16
  boldWeight?: number; // 600, 700, 800 for headings and bold text
  lineHeight?: number; // default 1.6
  customFontFamily?: string; // OS font family name when baseFontFamily is "custom"
}

// Customizable theme color keys (maps to CSS --color-* variables)
export type ThemeColorKey =
  | "bg"
  | "bg-secondary"
  | "bg-muted"
  | "bg-emphasis"
  | "text"
  | "text-muted"
  | "border"
  | "accent"
  | "selection";

// Partial map of color overrides (hex strings)
export type CustomColors = Partial<Record<ThemeColorKey, string>>;

// Per-folder settings (stored in .scratch/settings.json)
export interface PdfBookmark {
  level: number; // 1..=6 (h1..h6)
  text: string;
}

export interface PdfExportOptions {
  paper: "a4" | "letter";
  orientation: "portrait" | "landscape";
  margins: "narrow" | "normal" | "wide";
  includeFrontmatter: boolean;
  pageNumbers: boolean;
  fontSize?: number;
}

export const DEFAULT_PDF_EXPORT_OPTIONS: PdfExportOptions = {
  paper: "a4",
  orientation: "portrait",
  margins: "normal",
  includeFrontmatter: false,
  pageNumbers: false,
};

export interface Settings {
  theme: ThemeSettings;
  editorFont?: EditorFontSettings;
  gitEnabled?: boolean;
  foldersEnabled?: boolean;
  pinnedNoteIds?: string[];
  textDirection?: TextDirection;
  editorWidth?: EditorWidth;
  customEditorWidthPx?: number;
  sidebarWidthPx?: number;
  defaultNoteName?: string;
  interfaceZoom?: number;
  ollamaModel?: string;
  ignoredPatterns?: string[];
  customColorsLight?: CustomColors;
  customColorsDark?: CustomColors;
  pdfExport?: PdfExportOptions;
}

export interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
  notes: NoteMetadata[];
}
