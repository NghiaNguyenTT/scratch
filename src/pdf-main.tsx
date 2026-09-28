import React from "react";
import ReactDOM from "react-dom/client";
import "katex/dist/katex.min.css";
import "./App.css";
import "./pdf-export.css";
import { ThemeProvider } from "./context/ThemeContext";
import { ExportPdfApp } from "./components/export/ExportPdfApp";

// Entry for the hidden PDF export window (pdf.html). Deliberately does NOT
// import app-print.css or App.tsx so the app-window print rules never apply
// to the PDF render.

const params = new URLSearchParams(window.location.search);
const file = params.get("file");
const includeFrontmatter = params.get("fm") === "1";
const fsParam = params.get("fs");
const fontSize = fsParam ? Number(fsParam) : undefined;

const root = document.getElementById("root");
if (!file || !root) {
  if (root) {
    root.innerHTML = '<p style="padding:24px">Missing file parameter</p>';
  }
} else {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ThemeProvider>
        <ExportPdfApp
          filePath={decodeURIComponent(file)}
          includeFrontmatter={includeFrontmatter}
          fontSize={Number.isFinite(fontSize) ? fontSize : undefined}
        />
      </ThemeProvider>
    </React.StrictMode>,
  );
}
