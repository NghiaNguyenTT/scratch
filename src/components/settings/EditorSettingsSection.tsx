import { useState, useEffect, useCallback, useRef } from "react";
import {
  useTheme,
  defaultThemeColors,
  fontFamilyStackFor,
} from "../../context/ThemeContext";
import { Button, CodeCopyButton, IconButton, Input, Select } from "../ui";
import { ColorPicker } from "../ui/ColorPicker";
import type {
  FontFamily,
  TextDirection,
  EditorWidth,
  ThemeColorKey,
} from "../../types/note";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  MinusIcon,
  PlusIcon,
  SpinnerIcon,
  CheckIcon,
  SearchIcon,
} from "../icons";
import { cn } from "../../lib/utils";
import { getSystemFonts } from "../../services/fonts";

// Human-readable labels for theme color keys, grouped logically
const colorLabels: { key: ThemeColorKey; label: string; group: string }[] = [
  // Surfaces
  { key: "bg", label: "Background", group: "Surfaces" },
  { key: "bg-secondary", label: "Sidebar", group: "Surfaces" },
  { key: "bg-muted", label: "Hover & Subtle Fill", group: "Surfaces" },
  { key: "bg-emphasis", label: "Strong Fill", group: "Surfaces" },
  // Text & UI
  { key: "text", label: "Text", group: "Text & UI" },
  { key: "text-muted", label: "Secondary Text", group: "Text & UI" },
  { key: "accent", label: "Primary & Buttons", group: "Text & UI" },
  { key: "border", label: "Borders", group: "Text & UI" },
  { key: "selection", label: "Selection Highlight", group: "Text & UI" },
];

// Text direction options
const textDirectionOptions: { value: TextDirection; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "ltr", label: "LTR" },
  { value: "rtl", label: "RTL" },
];

// Page width options
const editorWidthOptions: { value: EditorWidth; label: string }[] = [
  { value: "narrow", label: "Narrow" },
  { value: "normal", label: "Normal" },
  { value: "wide", label: "Wide" },
  { value: "full", label: "Full" },
  { value: "custom", label: "Custom" },
];

// Preset font families offered above the installed-font list
const fontPresets: { value: Exclude<FontFamily, "custom">; label: string }[] = [
  { value: "system-sans", label: "Sans" },
  { value: "serif", label: "Serif" },
  { value: "monospace", label: "Mono" },
];

// Bold weight options (medium excluded for monospace)
const boldWeightOptions = [
  { value: 500, label: "Medium", excludeForMonospace: true },
  { value: 600, label: "Semibold", excludeForMonospace: false },
  { value: 700, label: "Bold", excludeForMonospace: false },
  { value: 800, label: "Extra Bold", excludeForMonospace: false },
];

export function AppearanceSettingsSection() {
  const {
    theme,
    resolvedTheme,
    setTheme,
    editorFontSettings,
    setEditorFontSetting,
    resetEditorFontSettings,
    textDirection,
    setTextDirection,
    editorWidth,
    setEditorWidth,
    interfaceZoom,
    setInterfaceZoom,
    customEditorWidthPx,
    setCustomEditorWidthPx,
    customColorsLight,
    customColorsDark,
    setCustomColor,
    resetCustomColor,
    resetAllCustomColors,
  } = useTheme();

  // Validated numeric change handler
  const handleNumericChange = (
    field: "baseFontSize" | "lineHeight",
    value: string,
    min: number,
    max: number,
  ) => {
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.min(Math.max(parsed, min), max);
    setEditorFontSetting(field, clamped);
  };

  // Check if settings differ from defaults
  const hasCustomFonts =
    editorFontSettings.baseFontFamily !== "system-sans" ||
    editorFontSettings.baseFontSize !== 15 ||
    editorFontSettings.boldWeight !== 600 ||
    editorFontSettings.lineHeight !== 1.6 ||
    textDirection !== "auto" ||
    editorWidth !== "normal" ||
    Math.round(interfaceZoom * 100) !== 100;

  // Filter weight options based on font family
  const isMonospace = editorFontSettings.baseFontFamily === "monospace";
  const availableWeightOptions = boldWeightOptions.filter(
    (opt) => !isMonospace || !opt.excludeForMonospace,
  );

  // Handle font family change - bump up weight if needed
  const handleFontFamilyChange = (newFamily: FontFamily) => {
    setEditorFontSetting("baseFontFamily", newFamily);
    // If switching to monospace and current weight is medium, bump to semibold
    if (newFamily === "monospace" && editorFontSettings.boldWeight === 500) {
      setEditorFontSetting("boldWeight", 600);
    }
  };

  return (
    <div className="space-y-8 py-8">
      {/* Theme Section */}
      <section className="pb-2">
        <h2 className="text-xl font-medium mb-3">Theme</h2>
        <div className="flex items-center justify-between">
          <label className="text-sm text-text font-medium">Mode</label>
          <Select
            value={theme}
            onChange={(e) =>
              setTheme(e.target.value as "light" | "dark" | "system")
            }
            className="w-40"
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </Select>
        </div>
        {theme === "system" && (
          <p className="mt-3 text-sm text-text-muted">
            Currently using {resolvedTheme} mode based on system preference
          </p>
        )}

        {/* Customize Colors */}
        {theme === "system" ? (
          <div className="mt-4 space-y-2">
            <ColorsExpandable
              label="Customize light colors"
              mode="light"
              customColors={customColorsLight}
              setCustomColor={setCustomColor}
              resetCustomColor={resetCustomColor}
              resetAllCustomColors={resetAllCustomColors}
            />
            <ColorsExpandable
              label="Customize dark colors"
              mode="dark"
              customColors={customColorsDark}
              setCustomColor={setCustomColor}
              resetCustomColor={resetCustomColor}
              resetAllCustomColors={resetAllCustomColors}
            />
          </div>
        ) : (
          <ColorsExpandable
            label="Customize colors"
            mode={resolvedTheme}
            customColors={
              resolvedTheme === "dark" ? customColorsDark : customColorsLight
            }
            setCustomColor={setCustomColor}
            resetCustomColor={resetCustomColor}
            resetAllCustomColors={resetAllCustomColors}
            className="mt-4"
          />
        )}
      </section>

      {/* Divider */}
      <div className="border-t border-border border-dashed" />

      {/* Typography Section */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-xl font-medium">Typography</h2>
          {hasCustomFonts && (
            <Button onClick={resetEditorFontSettings} variant="ghost" size="sm">
              Reset to defaults
            </Button>
          )}
        </div>

        <div className="rounded-lg border border-border pl-4 py-3 pr-3 space-y-2">
          {/* Font Family */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-text font-medium">Font</label>
            <FontPicker
              value={editorFontSettings.baseFontFamily}
              customFamily={editorFontSettings.customFontFamily}
              onSelectPreset={handleFontFamilyChange}
              onSelectCustom={(family) => {
                setEditorFontSetting("baseFontFamily", "custom");
                setEditorFontSetting("customFontFamily", family);
              }}
            />
          </div>

          {/* Base Font Size */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-text font-medium">Size</label>
            <div className="relative w-40">
              <Input
                type="number"
                min="12"
                max="24"
                value={editorFontSettings.baseFontSize}
                onChange={(e) =>
                  handleNumericChange("baseFontSize", e.target.value, 12, 24)
                }
                className="w-full h-9 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>

          {/* Bold Weight */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-text font-medium">Bold Weight</label>
            <Select
              value={editorFontSettings.boldWeight}
              onChange={(e) =>
                setEditorFontSetting("boldWeight", Number(e.target.value))
              }
              className="w-40"
            >
              {availableWeightOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>

          {/* Line Height */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-text font-medium">Line Height</label>
            <div className="relative w-40">
              <Input
                type="number"
                min="1.0"
                max="2.5"
                step="0.1"
                value={editorFontSettings.lineHeight}
                onChange={(e) =>
                  handleNumericChange("lineHeight", e.target.value, 1.0, 2.5)
                }
                className="w-full h-9 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>

          {/* Text Direction */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-text font-medium">
              Text Direction
            </label>
            <Select
              value={textDirection}
              onChange={(e) =>
                setTextDirection(e.target.value as TextDirection)
              }
              className="w-40"
            >
              {textDirectionOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>

          {/* Page Width */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-text font-medium">Page Width</label>
            <Select
              value={editorWidth}
              onChange={(e) => setEditorWidth(e.target.value as EditorWidth)}
              className="w-40"
            >
              {editorWidthOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>
          {editorWidth === "custom" && (
            <div className="flex items-center justify-between">
              <label className="text-sm text-text font-medium">
                Custom Width
              </label>
              <div className="relative w-40 flex items-center gap-2">
                <Input
                  type="number"
                  min="480"
                  max="3840"
                  step="10"
                  value={customEditorWidthPx}
                  onChange={(e) => {
                    const parsed = parseInt(e.target.value, 10);
                    if (Number.isFinite(parsed)) {
                      setCustomEditorWidthPx(
                        Math.min(Math.max(parsed, 480), 3840),
                      );
                    }
                  }}
                  className="w-full h-9 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-sm text-text-muted">px</span>
              </div>
            </div>
          )}

          {/* Interface Zoom */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-text font-medium">
              Interface Zoom
            </label>
            <div className="flex items-center gap-1 w-40">
              <IconButton
                variant="outline"
                size="md"
                onClick={() => setInterfaceZoom((prev) => prev - 0.05)}
                disabled={interfaceZoom <= 0.7}
                title="Zoom out"
              >
                <MinusIcon className="w-4 h-4" />
              </IconButton>
              <span className="text-sm font-medium tabular-nums flex-1 text-center">
                {Math.round(interfaceZoom * 100)}%
              </span>
              <IconButton
                variant="outline"
                size="md"
                onClick={() => setInterfaceZoom((prev) => prev + 0.05)}
                disabled={interfaceZoom >= 1.5}
                title="Zoom in"
              >
                <PlusIcon className="w-4 h-4" />
              </IconButton>
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="mt-3 relative">
          <div className="absolute top-3 left-4 flex items-center text-sm font-medium text-text-muted/70 gap-1">
            <EyeIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            <span>Preview</span>
          </div>
          <div className="border border-border rounded-lg bg-bg p-6 pt-20 max-h-160 overflow-hidden">
            <div
              className="prose prose-lg dark:prose-invert max-w-xl mx-auto"
              dir={textDirection}
              style={{
                fontFamily:
                  editorFontSettings.baseFontFamily === "custom"
                    ? fontFamilyStackFor(
                        "custom",
                        editorFontSettings.customFontFamily,
                      )
                    : editorFontSettings.baseFontFamily === "system-sans"
                      ? "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
                      : editorFontSettings.baseFontFamily === "serif"
                        ? "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif"
                        : "ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, 'DejaVu Sans Mono', monospace",
                fontSize: `${editorFontSettings.baseFontSize}px`,
              }}
            >
              <h1>Kibble Maximization Protocol</h1>
              <p>
                A comprehensive strategy document for getting your humans to
                increase daily food portions.{" "}
                <strong>Time-tested methods</strong> that actually work.
              </p>

              <h2>Primary Techniques</h2>
              <ul>
                <li>
                  <strong>The Sad Eyes Method</strong> - Sit near food bowl,
                  stare longingly
                </li>
                <li>
                  <strong>Strategic Meowing</strong> - Begin at 5 AM for maximum
                  effectiveness
                </li>
                <li>
                  <strong>Bowl Inspection</strong> - Loudly inspect empty bowl,
                  then stare at human
                </li>
                <li>
                  <strong>The Figure Eight</strong> - Weave between their legs
                  while they cook
                </li>
              </ul>

              <h2>Advanced Protocol</h2>
              <p>
                For optimal results, combine multiple techniques. The most
                successful combination involves the Sad Eyes Method followed
                immediately by Strategic Meowing.
              </p>

              <div className="relative my-1">
                <div className="absolute top-2 right-2 z-10">
                  <CodeCopyButton
                    text={`function acquireFood() {
  while (bowl.isEmpty()) {
    meow();
    rubAgainstLegs();
    if (human.isInKitchen) {
      stareIntently();
    }
  }
}`}
                  />
                </div>
                <pre className="pt-10">
                  <code>
                    {`function acquireFood() {
  while (bowl.isEmpty()) {
    meow();
    rubAgainstLegs();
    if (human.isInKitchen) {
      stareIntently();
    }
  }
}`}
                  </code>
                </pre>
              </div>

              <h2>Common Mistakes to Avoid</h2>
              <ol>
                <li>Never accept the first "no" - persistence is key</li>
                <li>
                  Maintain consistency in meal times (your schedule, not theirs)
                </li>
                <li>Don't forget to knock things off counters periodically</li>
              </ol>

              <p>
                Remember: <em>humans are trainable</em>. With dedication and the
                right approach, you can increase portions by up to 40% within
                the first month.
              </p>
            </div>
          </div>
          {/* Fade overlay - content to muted background */}
          <div className="absolute bottom-0 left-0 right-0 h-40 bg-linear-to-t from-bg to-transparent pointer-events-none" />
        </div>
      </section>
    </div>
  );
}

// Module-level cache so the OS fonts are only enumerated once per session
let systemFontsCache: string[] | null = null;

// A single compact control for choosing the editor font: presets plus every
// font installed on the OS, behind a searchable popover.
function FontPicker({
  value,
  customFamily,
  onSelectPreset,
  onSelectCustom,
}: {
  value: FontFamily;
  customFamily: string;
  onSelectPreset: (family: FontFamily) => void;
  onSelectCustom: (family: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [fonts, setFonts] = useState<string[] | null>(systemFontsCache);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const isCustom = value === "custom";
  const selectedLabel = isCustom
    ? customFamily || "Custom"
    : (fontPresets.find((p) => p.value === value)?.label ?? "Sans");

  const load = useCallback(async () => {
    setError(null);
    if (systemFontsCache) {
      setFonts(systemFontsCache);
      return;
    }
    try {
      const families = await getSystemFonts();
      systemFontsCache = families;
      setFonts(families);
    } catch (err) {
      console.error("Failed to list system fonts:", err);
      setError("Could not load system fonts.");
    }
  }, []);

  // Enumerate OS fonts lazily, the first time the popover is opened
  useEffect(() => {
    if (isOpen && fonts === null && !error) load();
  }, [isOpen, fonts, error, load]);

  // Focus the search field on open
  useEffect(() => {
    if (isOpen) searchRef.current?.focus();
  }, [isOpen]);

  // Close on outside click or Escape
  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  const normalized = query.trim().toLowerCase();
  const filtered =
    fonts?.filter((f) => f.toLowerCase().includes(normalized)) ?? [];
  const matchingPresets = fontPresets.filter(
    (p) => !normalized || p.label.toLowerCase().includes(normalized),
  );

  const rowClass = (active: boolean) =>
    cn(
      "w-full text-left px-2.5 py-1.5 text-sm flex items-center justify-between gap-2 rounded-sm hover:bg-bg-muted transition-colors cursor-pointer",
      active && "bg-bg-muted",
    );

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={cn(
          "flex h-9 w-40 items-center justify-between rounded-lg border bg-bg px-3 text-sm text-text transition-colors cursor-pointer",
          isOpen
            ? "border-accent"
            : "border-border hover:border-text-muted",
        )}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDownIcon className="w-4 h-4 stroke-[1.7] text-text-muted shrink-0" />
      </button>

      {isOpen && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-10 z-50 w-60 rounded-lg border border-border bg-bg shadow-lg p-1.5"
        >
          <div className="relative">
            <SearchIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <Input
              ref={searchRef}
              type="text"
              placeholder="Search fonts..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full h-8 pl-8 text-sm"
            />
          </div>

          <div className="mt-1.5 max-h-64 overflow-y-auto">
            {matchingPresets.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => {
                  onSelectPreset(preset.value);
                  setIsOpen(false);
                }}
                className={rowClass(value === preset.value)}
              >
                <span>{preset.label}</span>
                {value === preset.value && (
                  <CheckIcon className="w-3.5 h-3.5 shrink-0 stroke-[2.2]" />
                )}
              </button>
            ))}

            <div className="px-2.5 pt-2 pb-1 text-xs font-medium text-text-muted">
              Installed
            </div>
            {error ? (
              <div className="flex items-center justify-between px-2.5 py-1">
                <span className="text-sm text-text-muted">{error}</span>
                <Button variant="outline" size="sm" onClick={load}>
                  Retry
                </Button>
              </div>
            ) : fonts === null ? (
              <div className="flex items-center gap-2 px-2.5 py-2">
                <SpinnerIcon className="w-4 h-4 animate-spin text-text-muted" />
                <span className="text-sm text-text-muted">Loading fonts...</span>
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-text-muted px-2.5 py-2">
                No fonts match "{query}"
              </p>
            ) : (
              filtered.map((family) => (
                <button
                  key={family}
                  type="button"
                  onClick={() => {
                    onSelectCustom(family);
                    setIsOpen(false);
                  }}
                  className={rowClass(isCustom && customFamily === family)}
                  style={{ fontFamily: fontFamilyStackFor("custom", family) }}
                >
                  <span className="truncate">{family}</span>
                  {isCustom && customFamily === family && (
                    <CheckIcon className="w-3.5 h-3.5 shrink-0 stroke-[2.2]" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Expandable subsection for customizing colors for a single theme mode
function ColorsExpandable({
  label,
  mode,
  customColors,
  setCustomColor,
  resetCustomColor,
  resetAllCustomColors,
  className,
}: {
  label: string;
  mode: "light" | "dark";
  customColors: Partial<Record<ThemeColorKey, string>>;
  setCustomColor: (
    mode: "light" | "dark",
    key: ThemeColorKey,
    value: string,
  ) => void;
  resetCustomColor: (mode: "light" | "dark", key: ThemeColorKey) => void;
  resetAllCustomColors: (mode: "light" | "dark") => void;
  className?: string;
}) {
  const defaults = defaultThemeColors[mode];
  const hasAnyCustom = Object.keys(customColors).length > 0;

  return (
    <details className={cn("text-sm", className)}>
      <summary className="cursor-pointer text-text-muted hover:text-text select-none flex items-center gap-1 font-medium">
        <ChevronRightIcon className="w-3.5 h-3.5 stroke-2 transition-transform [[open]>&]:rotate-90" />
        {label}
        {hasAnyCustom && (
          <Button
            onClick={(e) => {
              e.preventDefault();
              resetAllCustomColors(mode);
            }}
            variant="ghost"
            size="sm"
            className="ml-auto"
          >
            Reset all
          </Button>
        )}
      </summary>
      <div className="mt-2 rounded-lg border border-border pl-4 py-3 pr-3 space-y-1.5">
        {(() => {
          let lastGroup = "";
          return colorLabels.map(({ key, label: colorLabel, group }) => {
            const showGroup = group !== lastGroup;
            lastGroup = group;
            return (
              <div key={key}>
                {showGroup && (
                  <div
                    className={`text-base text-text-muted font-medium ${key !== colorLabels[0].key ? "mt-6" : ""} mb-2.5`}
                  >
                    {group}
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <label className="text-sm text-text font-medium">
                    {colorLabel}
                  </label>
                  <ColorPicker
                    color={customColors[key] ?? defaults[key]}
                    defaultColor={defaults[key]}
                    onChange={(value) => setCustomColor(mode, key, value)}
                    onReset={() => resetCustomColor(mode, key)}
                  />
                </div>
              </div>
            );
          });
        })()}
      </div>
    </details>
  );
}
