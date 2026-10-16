import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // Production build optimizations
  build: {
    // Target compatible with Tauri WebViews across platforms:
    // - macOS: WebKit (Safari 13+)
    // - Windows: WebView2 (Chromium-based)
    // - Linux: WebKitGTK
    target: ["es2021", "chrome105", "safari14"],
    // Use the built-in Oxc minifier (Vite 8 default; esbuild is no longer bundled)
    minify: "oxc",
    // Optimize chunk splitting
    rollupOptions: {
      // Two entries: the main app and the hidden PDF export window
      input: {
        main: "index.html",
        pdf: "pdf.html",
      },
      output: {
        // Manual chunk splitting for better caching.
        // Vite 8 (Rolldown) accepts only the function form of `manualChunks`.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          // TipTap and its ProseMirror internals
          if (id.includes("@tiptap") || id.includes("prosemirror")) {
            return "tiptap";
          }
          // Syntax highlighting
          if (id.includes("lowlight") || id.includes("highlight.js")) {
            return "highlight";
          }
          // Tauri APIs
          if (id.includes("@tauri-apps")) return "tauri";
          // React core
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return "react-vendor";
          }
          return undefined;
        },
      },
    },
    // Enable source maps for debugging (optional, can disable for smaller builds)
    sourcemap: false,
    // Increase chunk size warning limit (TipTap is large)
    chunkSizeWarningLimit: 1000,
  },

  // Optimize dependencies
  optimizeDeps: {
    // Pre-bundle these dependencies for faster dev startup
    include: [
      "react",
      "react-dom",
      "@tiptap/react",
      "@tiptap/starter-kit",
      "@tiptap/markdown",
      "lowlight",
    ],
  },
}));
