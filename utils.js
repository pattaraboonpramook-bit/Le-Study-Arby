// utils.js — small, pure helpers shared across the app. No app state and no DOM
// wiring beyond one-shot downloads, so they stay dependency-free and any module
// can use them without circular imports.

// Human-friendly date, e.g. "Nov 7, 2026".
export const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

// Human-friendly file size.
export function fmtSize(b) {
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return Math.round(b / 1024) + " KB";
  return (b / (1024 * 1024)).toFixed(1) + " MB";
}

// Pull a title from Markdown (first heading, else first non-empty line).
export function titleFromMarkdown(md, fallback = "Untitled note") {
  const h1 = (md || "").match(/^#\s+(.+)/m);
  if (h1) return h1[1].trim().slice(0, 120);
  const first = (md || "").split(/\r?\n/).find((l) => l.trim());
  return first ? first.trim().replace(/^#+\s*/, "").slice(0, 120) : fallback;
}

// A filesystem-safe version of a note title.
export const safeName = (s) => (s || "note").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "note";

// Labels for a note's capture source.
export const sourceLabel = { record: "Recording", paste: "Pasted", youtube: "YouTube", image: "Photos", file: "File" };

// Download a text file (one-shot <a download> click).
export function downloadText(text, filename, type = "text/markdown") {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Download a JSON file (used by backup/export).
export function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
