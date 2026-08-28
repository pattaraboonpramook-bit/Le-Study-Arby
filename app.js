// app.js — Recall single-page app
// ─────────────────────────────────────────────────────────────────────────────
import {
  backend, clearLocalData,
  signIn, signUp, signOut, getUser, onAuthChange,
  listNotes, getNote, createNote, updateNote, deleteNote,
  listChat, addChat,
} from "./store.js";
import { generate, hasGeminiKey, getGeminiKey, setGeminiKey } from "./ai.js";

const app = document.getElementById("app");

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  user: null,
  view: "library",          // library | capture | note
  notes: null,              // null = not loaded yet
  search: "",
  streak: 1,
  current: null,            // full note object
  noteTab: "notes",         // notes | flashcards | quiz | chat
  captureMode: "record",    // record | paste | youtube
  transcript: "",           // captured raw text
  sourceType: "record",
  sourceRef: null,
  ytTitle: "",
  ytManual: "",             // YouTube transcript (fetched or pasted)
  ytStatus: "",
  fc: { order: [], i: 0, flipped: false },
  quiz: { answers: {} },
  chat: null,               // loaded lazily
  feynman: null,            // teach-back result
  feynmanText: "",          // teach-back explanation draft
  authMode: "signin",
};

let dictation = null;       // speech-to-text for teach-back (separate from capture)

let recognition = null;
let recording = false;
let installEvent = null;

// ── Tiny utilities ───────────────────────────────────────────────────────────
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function toast(msg, type = "") {
  const host = document.getElementById("toast-host");
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; }, 2600);
  setTimeout(() => t.remove(), 3000);
}

const BUSY_PHRASES = [
  "Skimming the boring parts…",
  "Highlighting what matters…",
  "Making it make sense…",
  "Connecting the dots…",
  "Doing the reading so you don't have to…",
  "Untangling the jargon…",
  "Thinking really hard 🤔…",
  "Turning chaos into notes…",
];
let busyTimer = null;
function busy(on, label = "Working…") {
  let o = document.getElementById("overlay");
  if (on) {
    if (!o) {
      o = document.createElement("div");
      o.id = "overlay";
      o.className = "overlay";
      document.body.appendChild(o);
    }
    o.innerHTML = `<div class="spinner"></div><p id="busy-label">${escapeHtml(label)}</p>`;
    clearInterval(busyTimer);
    busyTimer = setInterval(() => {
      const p = $("#busy-label");
      if (p) p.textContent = BUSY_PHRASES[Math.floor(Math.random() * BUSY_PHRASES.length)];
    }, 2200);
  } else if (o) {
    clearInterval(busyTimer); busyTimer = null;
    o.remove();
  }
}

const PRAISE = ["Notes ready ✨", "Boom — done 💥", "Served fresh 🍽️", "Go ace it 💪", "Nailed it 🎯"];
const praise = () => PRAISE[Math.floor(Math.random() * PRAISE.length)];

// Lightweight confetti burst for wins (no deps). Respects reduced-motion.
function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = document.createElement("canvas");
  c.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2000";
  c.width = innerWidth; c.height = innerHeight;
  document.body.appendChild(c);
  const ctx = c.getContext("2d");
  const colors = ["#5b46c9", "#9d88ff", "#b0803f", "#3f8f6b", "#c0503f", "#e8c96e"];
  const parts = Array.from({ length: 110 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 160, y: innerHeight * 0.32,
    vx: (Math.random() - 0.5) * 11, vy: Math.random() * -9 - 4,
    s: Math.random() * 7 + 4, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
    col: colors[Math.floor(Math.random() * colors.length)], life: 1,
  }));
  let t0 = performance.now();
  (function frame(t) {
    const dt = Math.min(32, t - t0) / 16; t0 = t;
    ctx.clearRect(0, 0, c.width, c.height);
    let alive = false;
    for (const p of parts) {
      p.vy += 0.35 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt; p.life -= 0.008 * dt;
      if (p.life > 0 && p.y < c.height + 20) {
        alive = true;
        ctx.save(); ctx.globalAlpha = Math.max(0, p.life);
        ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.col; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
        ctx.restore();
      }
    }
    if (alive) requestAnimationFrame(frame); else c.remove();
  })(t0);
}

// Study streak: counts consecutive days you open Recall.
function updateStreak() {
  try {
    const today = new Date().toDateString();
    const last = localStorage.getItem("recall_streak_date");
    let streak = +(localStorage.getItem("recall_streak") || 0);
    if (last !== today) {
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      streak = last === yesterday ? streak + 1 : 1;
      localStorage.setItem("recall_streak", String(streak));
      localStorage.setItem("recall_streak_date", today);
    }
    return streak || 1;
  } catch { return 1; }
}

// Ask for the Gemini key (saved in this browser only). Returns true if we have one.
async function ensureKey() {
  if (hasGeminiKey()) return true;
  const k = window.prompt(
    "Paste your free Gemini API key to enable AI.\nGet one at aistudio.google.com/apikey — it's saved only in this browser.",
    ""
  );
  if (k && k.trim().length > 20) { setGeminiKey(k.trim()); toast("Key saved on this device ✓", "success"); return true; }
  if (k !== null) toast("That doesn't look like a valid key.", "error");
  return false;
}

// Run an AI task, prompting for the key first if it's missing.
async function aiGenerate(task, payload) {
  if (!hasGeminiKey() && !(await ensureKey())) throw new Error("Add your Gemini API key to use AI features.");
  try {
    return await generate(task, payload);
  } catch (e) {
    if (e.code === "NO_KEY") {
      if (await ensureKey()) return await generate(task, payload);
      throw new Error("Add your Gemini API key to use AI features.");
    }
    throw e;
  }
}

// Minimal, safe Markdown → HTML (escapes first, then formats).
function mdToHtml(md) {
  const inline = (s) =>
    s
      .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  const lines = escapeHtml(md || "").split(/\r?\n/);
  let out = "", list = null;
  const close = () => { if (list) { out += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { close(); continue; }
    let m;
    if ((m = line.match(/^###\s+(.*)/))) { close(); out += `<h3>${inline(m[1])}</h3>`; }
    else if ((m = line.match(/^##\s+(.*)/))) { close(); out += `<h2>${inline(m[1])}</h2>`; }
    else if ((m = line.match(/^#\s+(.*)/))) { close(); out += `<h1>${inline(m[1])}</h1>`; }
    else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { close(); out += "<hr>"; }
    else if ((m = line.match(/^>\s?(.*)/))) { close(); out += `<blockquote>${inline(m[1])}</blockquote>`; }
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))) { if (list !== "ul") { close(); out += "<ul>"; list = "ul"; } out += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^\s*\d+\.\s+(.*)/))) { if (list !== "ol") { close(); out += "<ol>"; list = "ol"; } out += `<li>${inline(m[1])}</li>`; }
    else { close(); out += `<p>${inline(line.trim())}</p>`; }
  }
  close();
  return out;
}

function titleFromMarkdown(md, fallback = "Untitled note") {
  const h1 = (md || "").match(/^#\s+(.+)/m);
  if (h1) return h1[1].trim().slice(0, 120);
  const first = (md || "").split(/\r?\n/).find((l) => l.trim());
  return first ? first.trim().replace(/^#+\s*/, "").slice(0, 120) : fallback;
}

const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const sourceLabel = { record: "Recording", paste: "Pasted", youtube: "YouTube" };

// ── Theme ────────────────────────────────────────────────────────────────────
function currentTheme() {
  return document.documentElement.dataset.theme ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}
function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("recall_theme", next); } catch {}
  const btn = $("#theme-btn");
  if (btn) btn.textContent = next === "dark" ? "☀" : "☾";
}
(function initTheme() {
  try {
    const t = localStorage.getItem("recall_theme");
    if (t) document.documentElement.dataset.theme = t;
  } catch {}
})();

// ═════════════════════════════════════════════════════════════════════════════
//  RENDER
// ═════════════════════════════════════════════════════════════════════════════
function render() {
  if (!state.user) { app.innerHTML = authHTML(); wireAuth(); return; }
  app.innerHTML = topbarHTML() + `<main class="wrap" id="main"></main>`;
  wireTopbar();
  renderView();
}

function renderView() {
  const main = $("#main");
  if (!main) return;
  if (state.view === "library") { main.innerHTML = libraryHTML(); wireLibrary(); }
  else if (state.view === "capture") { main.innerHTML = captureHTML(); wireCapture(); }
  else if (state.view === "note") { main.innerHTML = noteHTML(); wireNote(); }
}

// ── Auth ─────────────────────────────────────────────────────────────────────
function authHTML() {
  const signup = state.authMode === "signup";
  return `<div class="auth"><div class="auth-card">
    <div class="auth-logo"><div class="mark">✺</div></div>
    <h1>${signup ? "Create your account" : "Welcome back"}</h1>
    <p class="sub">Turn any lecture into notes, flashcards & quizzes.</p>
    <form id="auth-form">
      <input class="input" type="email" id="email" placeholder="you@school.edu" autocomplete="email" required />
      <input class="input" type="password" id="password" placeholder="Password (min 6 chars)" autocomplete="${signup ? "new-password" : "current-password"}" minlength="6" required />
      <button class="btn btn-primary" type="submit" style="margin-top:6px">${signup ? "Sign up" : "Sign in"}</button>
      <div class="row">
        <span style="color:var(--text-2)">${signup ? "Already have an account?" : "New here?"}</span>
        <button type="button" class="toggle" id="auth-toggle">${signup ? "Sign in" : "Create one"}</button>
      </div>
    </form>
  </div></div>`;
}

function wireAuth() {
  $("#auth-toggle").onclick = () => { state.authMode = state.authMode === "signup" ? "signin" : "signup"; render(); };
  $("#auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const email = $("#email").value.trim();
    const password = $("#password").value;
    busy(true, state.authMode === "signup" ? "Creating your account…" : "Signing in…");
    try {
      if (state.authMode === "signup") {
        const data = await signUp(email, password);
        if (!data.session) {
          toast("Check your email to confirm, then sign in.", "success");
          state.authMode = "signin";
          busy(false); render(); return;
        }
      } else {
        await signIn(email, password);
      }
      // onAuthChange handles the rest
    } catch (err) {
      toast(err.message || "Authentication failed.", "error");
    } finally {
      busy(false);
    }
  };
}

// ── Topbar ───────────────────────────────────────────────────────────────────
function topbarHTML() {
  const initial = (state.user?.email || "U")[0].toUpperCase();
  const themeIcon = currentTheme() === "dark" ? "☀" : "☾";
  return `<header class="topbar">
    <div class="brand" id="brand"><span class="mark">✺</span><span class="name">Recall</span></div>
    <div class="topbar-actions">
      <button class="btn btn-icon btn-ghost" id="theme-btn" title="Toggle theme" aria-label="Toggle theme">${themeIcon}</button>
      <div class="menu-wrap">
        <button class="avatar" id="avatar-btn" aria-label="Account">${escapeHtml(initial)}</button>
      </div>
    </div>
  </header>`;
}

function wireTopbar() {
  $("#brand").onclick = goLibrary;
  $("#theme-btn").onclick = toggleTheme;
  const avatar = $("#avatar-btn");
  avatar.onclick = (e) => {
    e.stopPropagation();
    if ($("#user-menu")) { $("#user-menu").remove(); return; }
    const menu = document.createElement("div");
    menu.className = "menu";
    menu.id = "user-menu";
    menu.innerHTML =
      `<div style="padding:8px 12px;color:var(--muted);font-size:.8rem;word-break:break-all">${escapeHtml(state.user.email)}</div>
       <div class="divider"></div>
       <button id="menu-key">🔑 ${hasGeminiKey() ? "Change" : "Add"} Gemini key</button>` +
      (installEvent ? `<button id="menu-install">⬇ Install app</button>` : "") +
      (backend === "local"
        ? `<button id="menu-clear" class="btn-danger">🗑 Clear local data</button>`
        : `<button id="menu-signout" class="btn-danger">⎋ Sign out</button>`);
    avatar.parentElement.appendChild(menu);
    $("#menu-key").onclick = () => {
      menu.remove();
      const k = window.prompt("Paste your Gemini API key (from aistudio.google.com/apikey).\nSaved only in this browser.", getGeminiKey());
      if (k !== null) { setGeminiKey(k); toast(k.trim().length > 20 ? "Key saved ✓" : "Key cleared", "success"); }
    };
    if (installEvent) $("#menu-install").onclick = async () => { menu.remove(); installEvent.prompt(); installEvent = null; };
    if (backend === "local") {
      $("#menu-clear").onclick = () => {
        menu.remove();
        if (confirm("Delete all notes saved on this device? This can't be undone.")) { clearLocalData(); goLibrary(); }
      };
    } else {
      $("#menu-signout").onclick = async () => { await signOut(); };
    }
    setTimeout(() => document.addEventListener("click", function close() {
      menu.remove(); document.removeEventListener("click", close);
    }), 0);
  };
}

// ── Library ──────────────────────────────────────────────────────────────────
function libraryHTML() {
  const head = `<div class="page-head">
    <div>
      <h1>Your notes${state.streak >= 2 ? ` <span class="streak" title="${state.streak}-day study streak">🔥 ${state.streak}</span>` : ""}</h1>
      <p>${state.notes === null ? "Loading…" : `${state.notes.length} note${state.notes.length === 1 ? "" : "s"}`}${backend === "local" ? " · saved on this device" : ""}</p>
    </div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <div class="search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input class="input" id="search" placeholder="Search notes" value="${escapeHtml(state.search)}" />
      </div>
      <button class="btn btn-primary" id="new-note">＋ New note</button>
    </div>
  </div>`;

  if (state.notes === null) return head + `<div class="empty"><div class="spinner" style="margin:0 auto"></div></div>`;

  const filtered = state.notes.filter((n) =>
    !state.search || n.title.toLowerCase().includes(state.search.toLowerCase()));

  if (state.notes.length === 0) {
    return head + `<div class="empty">
      <div class="big">✎</div><h3>No notes yet</h3>
      <p>Record a lecture, paste your material, or drop a YouTube link to get started.</p>
      <button class="btn btn-primary" id="new-note-2" style="margin-top:16px">Create your first note</button>
    </div>`;
  }
  if (filtered.length === 0) return head + `<div class="empty"><p>No notes match “${escapeHtml(state.search)}”.</p></div>`;

  const cards = filtered.map((n) => `
    <button class="note-card" data-id="${n.id}">
      <h3>${escapeHtml(n.title)}</h3>
      <div class="meta">
        <span class="pill ${n.source_type}">${sourceLabel[n.source_type] || n.source_type}</span>
        <span>${fmtDate(n.updated_at)}</span>
      </div>
    </button>`).join("");
  return head + `<div class="note-grid">${cards}</div>`;
}

function wireLibrary() {
  const nb = $("#new-note"); if (nb) nb.onclick = goCapture;
  const nb2 = $("#new-note-2"); if (nb2) nb2.onclick = goCapture;
  const s = $("#search");
  if (s) s.oninput = () => {
    state.search = s.value;
    const grid = $("#main");
    // re-render just the grid area without losing focus is overkill; debounce-lite:
    const pos = s.selectionStart;
    grid.innerHTML = libraryHTML(); wireLibrary();
    const s2 = $("#search"); if (s2) { s2.focus(); s2.setSelectionRange(pos, pos); }
  };
  $$(".note-card").forEach((c) => (c.onclick = () => openNote(c.dataset.id)));
}

// ── Capture ──────────────────────────────────────────────────────────────────
function captureHTML() {
  const mode = state.captureMode;
  const seg = ["record", "paste", "youtube"].map((m) =>
    `<button data-mode="${m}" class="${m === mode ? "active" : ""}">${{ record: "🎙 Record", paste: "📄 Paste", youtube: "▶ YouTube" }[m]}</button>`).join("");

  let body = "";
  if (mode === "record") {
    const supported = "webkitSpeechRecognition" in window || "SpeechRecognition" in window;
    body = supported
      ? `<div class="record-stage">
          <button class="record-btn ${recording ? "recording" : ""}" id="rec-btn" aria-label="Record">${recording ? "■" : "●"}</button>
          <div class="record-hint">${recording ? "Listening… tap to stop" : "Tap to start recording your lecture"}</div>
          <div class="transcript-box" id="transcript">${escapeHtml(state.transcript)}<span class="interim" id="interim"></span></div>
        </div>`
      : `<div class="record-stage"><p style="color:var(--text-2)">Live recording isn't supported in this browser. Use <strong>Paste</strong> or <strong>YouTube</strong> instead — or type below.</p>
          <textarea class="input" id="paste-area" style="margin-top:16px" placeholder="Type or paste your material…">${escapeHtml(state.transcript)}</textarea></div>`;
  } else if (mode === "paste") {
    body = `<textarea class="input" id="paste-area" style="min-height:280px" placeholder="Paste your lecture transcript, textbook section, or messy notes here…">${escapeHtml(state.transcript)}</textarea>`;
  } else {
    body = `<label class="field-label" style="display:block;margin-bottom:6px">YouTube link</label>
      <input class="input" id="yt-url" placeholder="https://www.youtube.com/watch?v=…" value="${escapeHtml(state.sourceRef || "")}" />
      <p style="color:var(--muted);margin:10px 0 4px;font-size:.9rem">Paste the link and press <strong>Make lesson</strong> — Recall watches the video for you. <strong>No transcript needed.</strong></p>
      <details class="yt-fallback" ${state.ytManual ? "open" : ""}>
        <summary>Very long video or no captions? Paste a transcript instead</summary>
        <textarea class="input" id="yt-manual" style="min-height:150px;margin-top:10px" placeholder="Optional — video ⋯ → Show transcript → copy → paste here">${escapeHtml(state.ytManual || "")}</textarea>
      </details>`;
  }

  const canTurbo = state.transcript.trim().length > 0 || mode === "paste" || mode === "youtube";
  const turboLabel = mode === "youtube" ? "✺ Make lesson" : "✺ Turbo it";
  return `<div class="capture">
    <div class="note-head" style="margin-bottom:18px">
      <button class="btn btn-icon btn-ghost" id="back" aria-label="Back">←</button>
      <h1 style="font-size:1.5rem">New note</h1>
    </div>
    <div class="seg">${seg}</div>
    <div id="capture-body">${body}</div>
    <div class="turbo-bar">
      <button class="btn turbo-btn" id="turbo" ${canTurbo ? "" : "disabled"}>${turboLabel}</button>
    </div>
  </div>`;
}

function wireCapture() {
  $("#back").onclick = () => { stopRecognition(); goLibrary(); };
  $$(".seg button").forEach((b) => (b.onclick = () => {
    // capture any typed text before switching
    syncPasteArea();
    stopRecognition();
    state.captureMode = b.dataset.mode;
    renderView();
  }));

  const rec = $("#rec-btn");
  if (rec) rec.onclick = toggleRecognition;

  const turbo = $("#turbo");
  if (turbo) turbo.onclick = runTurbo;
}

function syncPasteArea() {
  const pa = $("#paste-area");
  if (pa) { state.transcript = pa.value; state.sourceType = state.captureMode === "record" ? "record" : "paste"; }
  const ym = $("#yt-manual");
  if (ym) state.ytManual = ym.value;
}

// ── Speech recognition ───────────────────────────────────────────────────────
function toggleRecognition() {
  if (recording) { stopRecognition(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";
  recognition.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) state.transcript += (state.transcript && !state.transcript.endsWith(" ") ? " " : "") + r[0].transcript.trim();
      else interim += r[0].transcript;
    }
    const box = $("#transcript");
    if (box) {
      box.innerHTML = escapeHtml(state.transcript) + `<span class="interim">${escapeHtml(interim ? " " + interim : "")}</span>`;
      box.scrollTop = box.scrollHeight;
    }
    const turbo = $("#turbo"); if (turbo && state.transcript.trim()) turbo.disabled = false;
  };
  recognition.onend = () => { if (recording) { try { recognition.start(); } catch {} } };
  recognition.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      toast("Microphone permission denied.", "error");
      stopRecognition(); renderView();
    }
  };
  try { recognition.start(); recording = true; state.sourceType = "record"; renderView(); }
  catch { toast("Couldn't start recording.", "error"); }
}

function stopRecognition() {
  recording = false;
  if (recognition) { try { recognition.stop(); } catch {} recognition = null; }
}

// ── Turbo: transcript → notes/lesson → new note ──────────────────────────────
async function runTurbo() {
  const mode = state.captureMode;
  const isYouTube = mode === "youtube";
  let task, payload, transcript = "", busyLabel;

  if (isYouTube) {
    const manual = ($("#yt-manual")?.value || "").trim();
    const url = ($("#yt-url")?.value || "").trim();
    state.sourceRef = url || null;
    if (manual) { task = "lesson"; payload = { source: manual }; transcript = manual; busyLabel = "Building your lesson…"; }
    else if (url) { task = "video"; payload = { videoUrl: url }; busyLabel = "Watching the video…"; }
    else { toast("Paste a YouTube link (or a transcript) first.", "error"); return; }
  } else {
    const source = mode === "paste" ? ($("#paste-area")?.value || "").trim() : state.transcript.trim();
    if (!source) { toast("Add some material first.", "error"); return; }
    task = "notes"; payload = { source }; transcript = source; busyLabel = "Turbo is reading your material…";
  }

  busy(true, busyLabel);
  try {
    const notes_md = await aiGenerate(task, payload);
    const note = await createNote({
      title: titleFromMarkdown(notes_md, state.ytTitle || "Untitled note"),
      source_type: isYouTube ? "youtube" : (mode === "record" ? "record" : "paste"),
      source_ref: state.sourceRef || null,
      transcript,
      notes_md,
      flashcards: [],
      quiz: [],
    });
    // reset capture state
    state.transcript = ""; state.sourceRef = null; state.ytTitle = ""; state.ytManual = ""; state.ytStatus = "";
    openNoteObject(note);
    toast(praise(), "success");
    confetti();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    busy(false);
  }
}

// ── Note view ────────────────────────────────────────────────────────────────
async function openNote(id) {
  busy(true, "Opening…");
  try {
    const note = await getNote(id);
    openNoteObject(note);
  } catch (err) {
    toast(err.message, "error");
  } finally {
    busy(false);
  }
}

function openNoteObject(note) {
  state.current = note;
  state.view = "note";
  state.noteTab = "notes";
  state.fc = { order: (note.flashcards || []).map((_, i) => i), i: 0, flipped: false };
  state.quiz = { answers: {} };
  state.chat = null;
  state.feynman = null;
  state.feynmanText = "";
  render();
}

function noteHTML() {
  const n = state.current;
  const tabs = [
    ["notes", "Notes"], ["flashcards", "Flashcards"], ["quiz", "Quiz"], ["teach", "Teach-back"], ["chat", "Chat"],
  ].map(([k, label]) => `<button data-tab="${k}" class="${state.noteTab === k ? "active" : ""}">${label}</button>`).join("");

  return `<div>
    <div class="note-head">
      <button class="btn btn-icon btn-ghost" id="back" aria-label="Back">←</button>
      <h1 id="note-title">${escapeHtml(n.title)}</h1>
      <button class="btn btn-icon btn-ghost" id="rename" title="Rename" aria-label="Rename">✎</button>
      <button class="btn btn-icon btn-ghost btn-danger" id="delete" title="Delete" aria-label="Delete">🗑</button>
    </div>
    <div class="note-sub">
      <span class="pill ${n.source_type}">${sourceLabel[n.source_type] || n.source_type}</span>
      <span>${fmtDate(n.updated_at)}</span>
      ${n.source_ref ? `· <a href="${escapeHtml(n.source_ref)}" target="_blank" rel="noopener">source</a>` : ""}
    </div>
    <div class="tabs">${tabs}</div>
    <div id="note-panel"></div>
  </div>`;
}

function wireNote() {
  $("#back").onclick = goLibrary;
  $("#rename").onclick = renameNote;
  $("#delete").onclick = removeNote;
  $$(".tabs button").forEach((b) => (b.onclick = () => { state.noteTab = b.dataset.tab; renderNotePanel(); syncTabActive(); }));
  renderNotePanel();
}

function syncTabActive() {
  $$(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.noteTab));
}

function renderNotePanel() {
  stopDictation();
  const p = $("#note-panel");
  if (!p) return;
  const tab = state.noteTab;
  if (tab === "notes") p.innerHTML = notesTabHTML();
  else if (tab === "flashcards") { p.innerHTML = flashTabHTML(); wireFlash(); }
  else if (tab === "quiz") { p.innerHTML = quizTabHTML(); wireQuiz(); }
  else if (tab === "teach") { p.innerHTML = teachTabHTML(); wireTeach(); }
  else if (tab === "chat") { p.innerHTML = `<div class="empty"><div class="spinner" style="margin:0 auto"></div></div>`; loadAndRenderChat(); }
  if (tab === "notes") wireNotesTab();
}

// Notes tab
function notesTabHTML() {
  const n = state.current;
  if (!n.notes_md) {
    return genCTA("✎", "No notes yet", "Generate clean study notes from the captured material.", "gen-notes", "Generate notes");
  }
  return `<div class="panel"><div class="prose">${mdToHtml(n.notes_md)}</div>
    <div style="margin-top:24px;display:flex;gap:10px">
      <button class="btn btn-outline btn-sm" id="regen-notes">↻ Regenerate</button>
    </div></div>`;
}
function wireNotesTab() {
  const g = $("#gen-notes"); if (g) g.onclick = () => generateNotes();
  const r = $("#regen-notes"); if (r) r.onclick = () => generateNotes();
}
async function generateNotes() {
  const n = state.current;
  const source = n.transcript || n.notes_md;
  if (!source) { toast("Nothing to summarize.", "error"); return; }
  busy(true, "Writing your notes…");
  try {
    const result = await aiGenerate("notes", { source });
    await patchNote({ notes_md: result, title: titleFromMarkdown(result, n.title) });
    renderNotePanel();
  } catch (err) { toast(err.message, "error"); } finally { busy(false); }
}

// Flashcards tab
function flashTabHTML() {
  const cards = state.current.flashcards || [];
  if (cards.length === 0) {
    return genCTA("🎴", "No flashcards yet", "Generate a deck from your notes and start studying.", "gen-fc", "Generate flashcards");
  }
  const order = state.fc.order.length ? state.fc.order : cards.map((_, i) => i);
  const idx = order[state.fc.i];
  const card = cards[idx];
  return `<div class="panel fc-stage">
    <div class="fc-progress">Card ${state.fc.i + 1} of ${cards.length}</div>
    <div class="flashcard ${state.fc.flipped ? "flipped" : ""}" id="flashcard">
      <div class="flashcard-inner">
        <div class="fc-face fc-front"><div><div class="kicker">Question</div><div class="body">${escapeHtml(card.front)}</div></div></div>
        <div class="fc-face fc-back"><div><div class="kicker">Answer</div><div class="body">${escapeHtml(card.back)}</div></div></div>
      </div>
    </div>
    <div class="fc-nav">
      <button class="btn btn-ghost btn-sm" id="fc-prev">← Prev</button>
      <button class="btn btn-outline btn-sm" id="fc-shuffle">⤮ Shuffle</button>
      <button class="btn btn-ghost btn-sm" id="fc-next">Next →</button>
    </div>
    <div style="text-align:center;margin-top:18px"><button class="btn btn-outline btn-sm" id="regen-fc">↻ Regenerate deck</button></div>
  </div>`;
}
function wireFlash() {
  const g = $("#gen-fc"); if (g) { g.onclick = () => generateFlashcards(); return; }
  $("#flashcard").onclick = () => { state.fc.flipped = !state.fc.flipped; $("#flashcard").classList.toggle("flipped"); };
  $("#fc-prev").onclick = () => { state.fc.i = (state.fc.i - 1 + state.current.flashcards.length) % state.current.flashcards.length; state.fc.flipped = false; renderNotePanel(); };
  $("#fc-next").onclick = () => { state.fc.i = (state.fc.i + 1) % state.current.flashcards.length; state.fc.flipped = false; renderNotePanel(); };
  $("#fc-shuffle").onclick = () => {
    const o = state.current.flashcards.map((_, i) => i);
    for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
    state.fc = { order: o, i: 0, flipped: false }; renderNotePanel();
  };
  $("#regen-fc").onclick = () => generateFlashcards();
}
async function generateFlashcards() {
  const n = state.current;
  busy(true, "Making flashcards…");
  try {
    const result = await aiGenerate("flashcards", { source: n.notes_md || n.transcript });
    const cards = (Array.isArray(result) ? result : []).filter((c) => c && c.front && c.back);
    if (!cards.length) throw new Error("No cards were generated. Try again.");
    await patchNote({ flashcards: cards });
    state.fc = { order: cards.map((_, i) => i), i: 0, flipped: false };
    renderNotePanel();
  } catch (err) { toast(err.message, "error"); } finally { busy(false); }
}

// Quiz tab
function quizTabHTML() {
  const quiz = state.current.quiz || [];
  if (quiz.length === 0) {
    return genCTA("❓", "No quiz yet", "Generate a practice quiz from your notes.", "gen-quiz", "Generate quiz");
  }
  const answered = state.quiz.answers;
  const done = Object.keys(answered).length === quiz.length;
  const score = quiz.reduce((s, q, i) => s + (answered[i] === q.answer ? 1 : 0), 0);

  const cards = quiz.map((q, qi) => {
    const sel = answered[qi];
    const opts = q.options.map((opt, oi) => {
      let cls = "q-opt";
      let tick = String.fromCharCode(65 + oi);
      if (sel !== undefined) {
        if (oi === q.answer) { cls += " correct"; tick = "✓"; }
        else if (oi === sel) { cls += " wrong"; tick = "✕"; }
      }
      return `<button class="${cls}" data-q="${qi}" data-o="${oi}" ${sel !== undefined ? "disabled" : ""}>
        <span class="tick">${tick}</span><span>${escapeHtml(opt)}</span></button>`;
    }).join("");
    const explain = sel !== undefined && q.explanation
      ? `<div class="q-explain">${sel === q.answer ? "✓ Correct. " : "✗ "}${escapeHtml(q.explanation)}</div>` : "";
    return `<div class="q-card"><div class="q">${qi + 1}. ${escapeHtml(q.question)}</div><div class="q-opts">${opts}</div>${explain}</div>`;
  }).join("");

  const scoreCard = done
    ? `<div class="quiz-score"><div class="num">${score}/${quiz.length}</div>
        <p style="color:var(--text-2);margin:6px 0 14px">${score === quiz.length ? "Perfect! 🎉" : score >= quiz.length * 0.7 ? "Nicely done." : "Keep studying — review the explanations above."}</p>
        <button class="btn btn-primary btn-sm" id="quiz-retake">↻ Retake</button></div>`
    : "";

  return `<div class="panel quiz">${cards}${scoreCard}
    <div style="text-align:center"><button class="btn btn-outline btn-sm" id="regen-quiz">↻ New quiz</button></div></div>`;
}
function wireQuiz() {
  const g = $("#gen-quiz"); if (g) { g.onclick = () => generateQuiz(); return; }
  $$(".q-opt").forEach((b) => (b.onclick = () => {
    const qi = +b.dataset.q;
    if (state.quiz.answers[qi] !== undefined) return;
    state.quiz.answers[qi] = +b.dataset.o;
    const quiz = state.current.quiz || [];
    const done = Object.keys(state.quiz.answers).length === quiz.length;
    renderNotePanel();
    if (done) {
      const score = quiz.reduce((s, q, i) => s + (state.quiz.answers[i] === q.answer ? 1 : 0), 0);
      if (quiz.length && score / quiz.length >= 0.7) confetti();
    }
  }));
  const rt = $("#quiz-retake"); if (rt) rt.onclick = () => { state.quiz = { answers: {} }; renderNotePanel(); };
  const rq = $("#regen-quiz"); if (rq) rq.onclick = () => generateQuiz();
}
async function generateQuiz() {
  const n = state.current;
  busy(true, "Writing quiz questions…");
  try {
    const result = await aiGenerate("quiz", { source: n.notes_md || n.transcript });
    const quiz = (Array.isArray(result) ? result : []).filter(
      (q) => q && q.question && Array.isArray(q.options) && q.options.length >= 2 && Number.isInteger(q.answer));
    if (!quiz.length) throw new Error("No questions were generated. Try again.");
    await patchNote({ quiz });
    state.quiz = { answers: {} };
    renderNotePanel();
  } catch (err) { toast(err.message, "error"); } finally { busy(false); }
}

// Teach-back tab (Feynman technique)
function teachTabHTML() {
  const n = state.current;
  const material = (n.notes_md || n.transcript || "").trim();
  if (!material) {
    return genCTA("🧑‍🏫", "Nothing to teach yet", "Generate notes first, then explain them back in your own words.", "gen-notes-teach", "Go to Notes");
  }
  return `<div class="panel teach">
    <p style="color:var(--text-2);margin-bottom:14px">Explain <strong>${escapeHtml(n.title)}</strong> in your own words — like you're teaching a friend. Retrieving it from memory is what makes it stick; then I'll score your understanding and show your gaps.</p>
    <div style="position:relative">
      <textarea class="input" id="feynman-input" style="min-height:170px" placeholder="Start explaining in your own words… (or tap the mic to speak)">${escapeHtml(state.feynmanText || "")}</textarea>
      <button class="btn btn-icon btn-ghost" id="feynman-mic" title="Speak your explanation" aria-label="Speak" style="position:absolute;right:10px;bottom:10px">🎤</button>
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px">
      <button class="btn btn-primary" id="feynman-grade">Grade my understanding</button>
    </div>
    <div id="feynman-result">${state.feynman ? feynmanResultHTML(state.feynman) : ""}</div>
  </div>`;
}

function feynmanResultHTML(r) {
  const score = Math.max(0, Math.min(100, Math.round(Number(r.score) || 0)));
  const ring = score >= 80 ? "var(--good)" : score >= 50 ? "var(--accent-2)" : "var(--bad)";
  const verdict = score >= 80 ? "Strong understanding 🎉" : score >= 50 ? "Getting there — mind the gaps." : "Worth another pass.";
  const block = (title, arr, cls) =>
    (arr && arr.length) ? `<div class="teach-block"><div class="teach-h ${cls}">${title}</div><ul>${arr.map((x) => `<li>${escapeHtml(String(x))}</li>`).join("")}</ul></div>` : "";
  return `<div class="teach-result">
    <div class="score-ring" style="--val:${score};--ring:${ring}"><span>${score}<small>%</small></span></div>
    <p style="text-align:center;color:var(--text-2);margin:-4px 0 16px">${verdict}</p>
    <div class="teach-cols">
      ${block("✓ You nailed", r.nailed, "good")}
      ${block("△ Gaps to review", r.gaps, "warn")}
      ${block("✗ Misconceptions", r.misconceptions, "bad")}
    </div>
    ${r.tip ? `<div class="teach-tip">💡 ${escapeHtml(String(r.tip))}</div>` : ""}
  </div>`;
}

function wireTeach() {
  const g = $("#gen-notes-teach");
  if (g) { g.onclick = () => { state.noteTab = "notes"; renderNotePanel(); syncTabActive(); }; return; }
  const ta = $("#feynman-input");
  if (ta) ta.oninput = () => { state.feynmanText = ta.value; };
  const mic = $("#feynman-mic");
  if (mic) mic.onclick = () => dictateInto(ta, mic);
  const grade = $("#feynman-grade");
  if (grade) grade.onclick = gradeFeynman;
}

async function gradeFeynman() {
  const ta = $("#feynman-input");
  const explanation = (ta?.value || "").trim();
  if (explanation.length < 15) { toast("Write a bit more of your explanation first.", "error"); return; }
  state.feynmanText = explanation;
  stopDictation();
  busy(true, "Grading your understanding…");
  try {
    const r = await aiGenerate("feynman", { context: state.current.notes_md || state.current.transcript, explanation });
    state.feynman = r;
    renderNotePanel();
    if ((Number(r.score) || 0) >= 80) confetti();
    $("#feynman-result")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) { toast(err.message, "error"); } finally { busy(false); }
}

// Voice dictation into a textarea (independent of the capture recorder).
function dictateInto(ta, btn) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast("Voice input isn't supported in this browser.", "error"); return; }
  if (dictation) { stopDictation(); btn.classList.remove("recording"); return; }
  dictation = new SR();
  dictation.continuous = true;
  dictation.interimResults = false;
  dictation.lang = "en-US";
  dictation.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) {
        const t = e.results[i][0].transcript.trim();
        ta.value += (ta.value && !ta.value.endsWith(" ") ? " " : "") + t;
        state.feynmanText = ta.value;
      }
    }
  };
  dictation.onend = () => { if (dictation) { try { dictation.start(); } catch {} } };
  dictation.onerror = () => { stopDictation(); btn.classList.remove("recording"); };
  try { dictation.start(); btn.classList.add("recording"); }
  catch { toast("Couldn't start the mic.", "error"); }
}

function stopDictation() {
  if (dictation) { try { dictation.stop(); } catch {} dictation = null; }
}

// Chat tab
async function loadAndRenderChat() {
  try {
    if (state.chat === null) state.chat = await listChat(state.current.id);
  } catch (err) {
    state.chat = [];
    toast(err.message, "error");
  }
  const p = $("#note-panel");
  if (!p || state.noteTab !== "chat") return;
  p.innerHTML = `<div class="panel chat">
    <div class="chat-scroll" id="chat-scroll">${state.chat.length ? state.chat.map(chatMsgHTML).join("") : `<div class="chat-empty">Ask anything about “${escapeHtml(state.current.title)}”. I'll answer from your notes.</div>`}</div>
    <form class="chat-form" id="chat-form">
      <input class="input" id="chat-input" placeholder="Ask a question about your notes…" autocomplete="off" />
      <button class="btn btn-primary" type="submit" aria-label="Send">↑</button>
    </form>
  </div>`;
  const scroll = $("#chat-scroll"); scroll.scrollTop = scroll.scrollHeight;
  $("#chat-form").onsubmit = onChatSubmit;
  $("#chat-input").focus();
}
function chatMsgHTML(m) {
  return `<div class="msg ${m.role}">${m.role === "assistant" ? `<div class="prose">${mdToHtml(m.content)}</div>` : escapeHtml(m.content)}</div>`;
}
async function onChatSubmit(e) {
  e.preventDefault();
  const input = $("#chat-input");
  const q = input.value.trim();
  if (!q) return;
  input.value = "";
  const scroll = $("#chat-scroll");
  if (state.chat.length === 0) scroll.innerHTML = "";
  const userMsg = { role: "user", content: q };
  state.chat.push(userMsg);
  scroll.insertAdjacentHTML("beforeend", chatMsgHTML(userMsg));
  scroll.insertAdjacentHTML("beforeend", `<div class="msg assistant" id="pending"><div class="spinner"></div></div>`);
  scroll.scrollTop = scroll.scrollHeight;
  try {
    addChat(state.current.id, "user", q).catch(() => {}); // fire-and-forget persistence
    const history = state.chat.slice(0, -1).slice(-10);
    const result = await aiGenerate("chat", {
      context: state.current.notes_md || state.current.transcript,
      history,
      question: q,
    });
    $("#pending")?.remove();
    const aMsg = { role: "assistant", content: result };
    state.chat.push(aMsg);
    scroll.insertAdjacentHTML("beforeend", chatMsgHTML(aMsg));
    scroll.scrollTop = scroll.scrollHeight;
    addChat(state.current.id, "assistant", result).catch(() => {});
  } catch (err) {
    $("#pending")?.remove();
    toast(err.message, "error");
  }
}

// ── Note actions ─────────────────────────────────────────────────────────────
async function patchNote(patch) {
  const updated = await updateNote(state.current.id, patch);
  state.current = updated;
  return updated;
}
async function renameNote() {
  const title = window.prompt("Rename note", state.current.title);
  if (!title || !title.trim()) return;
  try { await patchNote({ title: title.trim() }); $("#note-title").textContent = title.trim(); toast("Renamed", "success"); }
  catch (err) { toast(err.message, "error"); }
}
async function removeNote() {
  if (!window.confirm("Delete this note and its flashcards, quiz, and chat? This can't be undone.")) return;
  busy(true, "Deleting…");
  try { await deleteNote(state.current.id); toast("Note deleted", "success"); await goLibrary(); }
  catch (err) { toast(err.message, "error"); } finally { busy(false); }
}

// Shared generate call-to-action block
function genCTA(icon, title, sub, btnId, btnLabel) {
  return `<div class="panel gen-cta"><div class="big">${icon}</div>
    <h3 style="font-family:var(--font-display);font-weight:600;font-size:1.25rem">${title}</h3>
    <p>${sub}</p><button class="btn btn-primary" id="${btnId}">${btnLabel}</button></div>`;
}

// ── Navigation ───────────────────────────────────────────────────────────────
function goCapture() {
  stopRecognition();
  state.view = "capture";
  state.captureMode = "record";
  state.transcript = ""; state.sourceRef = null; state.ytTitle = ""; state.sourceType = "record";
  state.ytManual = ""; state.ytStatus = "";
  renderView();
}
async function goLibrary() {
  stopRecognition();
  state.view = "library";
  state.notes = null;
  render();
  try { state.notes = await listNotes(); renderView(); }
  catch (err) { toast(err.message, "error"); state.notes = []; renderView(); }
}

// ═════════════════════════════════════════════════════════════════════════════
//  BOOTSTRAP
// ═════════════════════════════════════════════════════════════════════════════
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; });

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

async function boot() {
  state.streak = updateStreak();
  onAuthChange((user) => {
    const was = state.user;
    state.user = user;
    if (user && !was) goLibrary();
    else if (!user) { state.notes = null; state.current = null; render(); }
  });
  state.user = await getUser();
  if (state.user) await goLibrary();
  else render();
}
boot();
