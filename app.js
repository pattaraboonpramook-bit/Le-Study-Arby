// app.js — Recall single-page app
// ─────────────────────────────────────────────────────────────────────────────
import {
  backend, clearLocalData,
  signIn, signUp, signOut, getUser, onAuthChange,
  getProfile, listUsers, setUserRole,
  listNotes, getNote, createNote, updateNote, deleteNote,
  listChat, addChat,
} from "./store.js";
import { generate, hasGeminiKey, getGeminiKey, setGeminiKey } from "./ai.js";

const app = document.getElementById("app");

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  user: null,
  role: null,               // pending | member | admin | blocked (cloud mode)
  view: "library",          // library | capture | note | admin
  notes: null,              // null = not loaded yet
  adminUsers: null,         // loaded for the admin panel
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
  podcastScript: null,      // [{speaker,text}] audio-overview script
  authMode: "signin",
};

let dictation = null;       // speech-to-text for teach-back (separate from capture)
let ttsState = { playing: false, paused: false, rate: 1, curTurn: 0 }; // podcast playback

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
  // Cloud mode: block anyone who isn't an approved member/admin (server-enforced too).
  if (backend === "cloud" && state.role !== "member" && state.role !== "admin") {
    app.innerHTML = gateHTML(); wireGate(); return;
  }
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
  else if (state.view === "admin") { main.innerHTML = adminHTML(); wireAdmin(); }
}

// ── Access gate (pending / blocked / loading) ────────────────────────────────
function gateHTML() {
  const r = state.role;
  let icon = "✺", title = "Checking your access…", msg = "";
  if (r === "blocked") {
    icon = "⛔"; title = "Access revoked";
    msg = "Your access to this app has been turned off. Contact the administrator if you think this is a mistake.";
  } else if (r === "pending") {
    icon = "⏳"; title = "Waiting for approval";
    msg = "Your account was created and is waiting for an administrator to approve it. You'll be able to sign in once they do.";
  }
  return `<div class="auth"><div class="auth-card" style="text-align:center">
    <div class="auth-logo" style="justify-content:center"><div class="mark">${icon}</div></div>
    <h1 style="font-size:1.5rem">${title}</h1>
    ${msg ? `<p class="sub">${msg}</p>` : `<div class="spinner" style="margin:18px auto"></div>`}
    <div style="font-size:.82rem;color:var(--muted);margin:6px 0 16px;word-break:break-all">${escapeHtml(state.user?.email || "")}</div>
    <button class="btn btn-outline" id="gate-signout" style="width:100%">Sign out</button>
  </div></div>`;
}
function wireGate() {
  const b = $("#gate-signout"); if (b) b.onclick = async () => { await signOut(); };
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
      (state.role === "admin" ? `<button id="menu-admin">🛡 Admin panel</button>` : "") +
      `<button id="menu-export">⬇ Back up my notes</button>
       <button id="menu-import">⬆ Restore from backup</button>` +
      (backend === "cloud" ? `<button id="menu-migrate">⤴ Import notes from this device</button>` : "") +
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
    if (state.role === "admin") { const a = $("#menu-admin"); if (a) a.onclick = () => { menu.remove(); goAdmin(); }; }
    $("#menu-export").onclick = () => { menu.remove(); exportData(); };
    $("#menu-import").onclick = () => { menu.remove(); pickImportFile(); };
    if (backend === "cloud") { const m = $("#menu-migrate"); if (m) m.onclick = () => { menu.remove(); migrateFromDevice(); }; }
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

// ── Admin panel (admins only; RLS enforces this on the server too) ───────────
async function goAdmin() {
  state.view = "admin";
  state.adminUsers = null;
  render();
  try { state.adminUsers = await listUsers(); }
  catch (err) { toast(err.message, "error"); state.adminUsers = []; }
  renderView();
}

function adminHTML() {
  const users = state.adminUsers;
  const head = `<div class="page-head">
    <div><h1>Admin</h1><p>Approve, block, or promote who can use Recall. Changes take effect immediately.</p></div>
    <button class="btn btn-ghost" id="admin-back">← Back to notes</button>
  </div>`;
  if (users === null) return head + `<div class="empty"><div class="spinner" style="margin:0 auto"></div></div>`;
  if (!users.length) return head + `<div class="empty"><p>No users yet.</p></div>`;

  const pending = users.filter((u) => u.role === "pending").length;
  const banner = pending
    ? `<div class="admin-banner">⏳ ${pending} ${pending === 1 ? "person is" : "people are"} waiting for approval.</div>` : "";

  const btn = (act, label, cls, id) => `<button class="btn btn-sm ${cls}" data-act="${act}" data-id="${id}">${label}</button>`;
  const rows = users.map((u) => {
    let actions;
    if (u.id === state.user.id) actions = `<span class="admin-you">you</span>`;
    else if (u.role === "pending") actions = btn("approve", "Approve", "btn-primary", u.id) + btn("block", "Reject", "btn-outline", u.id);
    else if (u.role === "member") actions = btn("promote", "Make admin", "btn-outline", u.id) + btn("block", "Block", "btn-outline btn-danger", u.id);
    else if (u.role === "admin") actions = btn("demote", "Remove admin", "btn-outline", u.id);
    else actions = btn("approve", "Restore", "btn-primary", u.id); // blocked
    return `<div class="admin-row">
      <div class="admin-user">
        <div class="admin-email">${escapeHtml(u.email || "—")}</div>
        <div class="admin-meta"><span class="role-badge ${u.role}">${u.role}</span> · joined ${fmtDate(u.created_at)}</div>
      </div>
      <div class="admin-actions">${actions}</div>
    </div>`;
  }).join("");
  return head + banner + `<div class="admin-list">${rows}</div>`;
}

function wireAdmin() {
  const back = $("#admin-back"); if (back) back.onclick = goLibrary;
  const ROLE = { approve: "member", block: "blocked", promote: "admin", demote: "member" };
  $$("[data-act]").forEach((b) => (b.onclick = async () => {
    const role = ROLE[b.dataset.act];
    if (b.dataset.act === "block" && !confirm("Remove this person's access? They won't be able to use the app until you restore them.")) return;
    if (b.dataset.act === "promote" && !confirm("Make this person an admin? They'll be able to manage users too.")) return;
    busy(true, "Updating access…");
    try {
      await setUserRole(b.dataset.id, role);
      state.adminUsers = await listUsers();
      renderView();
      toast("Access updated", "success");
    } catch (err) { toast(err.message, "error"); } finally { busy(false); }
  }));
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
  state.podcastScript = getPodcastLS(note.id);
  ttsState = { playing: false, paused: false, rate: 1, curTurn: 0 };
  render();
}

function noteHTML() {
  const n = state.current;
  const tabs = [
    ["notes", "Notes"], ["flashcards", "Flashcards"], ["quiz", "Quiz"], ["teach", "Teach-back"], ["podcast", "Podcast"], ["chat", "Chat"],
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
  stopSpeech();
  const p = $("#note-panel");
  if (!p) return;
  const tab = state.noteTab;
  if (tab === "notes") p.innerHTML = notesTabHTML();
  else if (tab === "flashcards") { p.innerHTML = flashTabHTML(); wireFlash(); }
  else if (tab === "quiz") { p.innerHTML = quizTabHTML(); wireQuiz(); }
  else if (tab === "teach") { p.innerHTML = teachTabHTML(); wireTeach(); }
  else if (tab === "podcast") { p.innerHTML = podcastTabHTML(); wirePodcast(); }
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

// Podcast tab (AI script + browser text-to-speech "audio overview")
const getPodcastLS = (id) => { try { const s = localStorage.getItem("recall_podcast_" + id); return s ? JSON.parse(s) : null; } catch { return null; } };
const setPodcastLS = (id, script) => { try { localStorage.setItem("recall_podcast_" + id, JSON.stringify(script)); } catch {} };
const HOSTS = { A: "Alex", B: "Sam" };

function podcastTabHTML() {
  const n = state.current;
  const material = (n.notes_md || n.transcript || "").trim();
  if (!material) return genCTA("🎧", "Nothing to narrate yet", "Generate notes first, then turn them into a listen-along podcast.", "gen-notes-pod", "Go to Notes");
  const script = state.podcastScript;
  if (!script) return genCTA("🎙️", "Podcast mode", "Turn this note into a fun audio overview — two hosts chatting through the key ideas, read aloud so you can study hands-free.", "gen-podcast", "Generate podcast");

  const supported = "speechSynthesis" in window;
  const lines = script.map((t, i) =>
    `<div class="pod-line ${t.speaker === "B" ? "b" : "a"}" data-idx="${i}"><span class="pod-who">${HOSTS[t.speaker] || HOSTS.A}</span><span class="pod-text">${escapeHtml(t.text)}</span></div>`).join("");
  const player = supported
    ? `<div class="pod-player">
        <button class="btn btn-primary btn-icon" id="pod-play" aria-label="Play">▶</button>
        <button class="btn btn-ghost btn-icon" id="pod-stop" aria-label="Stop">■</button>
        <label class="pod-rate">Speed
          <select id="pod-rate"><option value="0.8">0.8×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option></select>
        </label>
        <button class="btn btn-outline btn-sm" id="regen-pod" style="margin-left:auto">↻ New script</button>
      </div>`
    : `<p style="color:var(--text-2);margin-bottom:12px">Audio playback isn't supported in this browser — here's the script to read:</p>
       <div style="text-align:right;margin-bottom:8px"><button class="btn btn-outline btn-sm" id="regen-pod">↻ New script</button></div>`;
  return `<div class="panel podcast">${player}<div class="pod-script" id="pod-script">${lines}</div>
    <p style="color:var(--muted);font-size:.8rem;margin-top:14px;text-align:center">Voices come from your device — tap a line to start from there.</p></div>`;
}

function wirePodcast() {
  const gn = $("#gen-notes-pod"); if (gn) { gn.onclick = () => { state.noteTab = "notes"; renderNotePanel(); syncTabActive(); }; return; }
  const gp = $("#gen-podcast"); if (gp) { gp.onclick = generatePodcast; return; }
  const play = $("#pod-play"); if (play) play.onclick = togglePodcast;
  const stop = $("#pod-stop"); if (stop) stop.onclick = stopPodcast;
  const rate = $("#pod-rate"); if (rate) rate.onchange = () => { ttsState.rate = parseFloat(rate.value) || 1; };
  const rg = $("#regen-pod"); if (rg) rg.onclick = generatePodcast;
  $$(".pod-line").forEach((el) => (el.onclick = () => startPodcast(+el.dataset.idx)));
}

async function generatePodcast() {
  const n = state.current;
  stopSpeech();
  busy(true, "Recording your podcast…");
  try {
    const raw = await aiGenerate("podcast", { source: n.notes_md || n.transcript });
    const script = (Array.isArray(raw) ? raw : [])
      .filter((t) => t && t.text)
      .map((t) => ({ speaker: (t.speaker === "B" || /sam|host ?2|b\b/i.test(String(t.speaker))) ? "B" : "A", text: String(t.text) }));
    if (!script.length) throw new Error("Couldn't write a script — try again.");
    state.podcastScript = script;
    setPodcastLS(n.id, script);
    renderNotePanel();
  } catch (err) { toast(err.message, "error"); } finally { busy(false); }
}

// ── Text-to-speech engine ────────────────────────────────────────────────────
function pickVoices() {
  const all = (window.speechSynthesis?.getVoices() || []).filter((v) => /^en/i.test(v.lang));
  const a = all[0] || null;
  const b = all.find((v) => v.name !== a?.name) || all[1] || a;
  return { a, b };
}
function setPlayBtn(sym) { const b = $("#pod-play"); if (b) b.textContent = sym; }
function highlightPodLine(ti) {
  ttsState.curTurn = ti;
  $$(".pod-line").forEach((el) => el.classList.toggle("speaking", +el.dataset.idx === ti));
  const el = $(`.pod-line[data-idx="${ti}"]`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}
function togglePodcast() {
  const synth = window.speechSynthesis;
  if (!synth) return;
  if (ttsState.playing && !ttsState.paused) { synth.pause(); ttsState.paused = true; setPlayBtn("▶"); return; }
  if (ttsState.playing && ttsState.paused) { synth.resume(); ttsState.paused = false; setPlayBtn("⏸"); return; }
  startPodcast(ttsState.curTurn || 0);
}
function startPodcast(startTurn) {
  const synth = window.speechSynthesis;
  const script = state.podcastScript || [];
  if (!synth || !script.length) return;
  synth.cancel();
  ttsState.playing = true; ttsState.paused = false; setPlayBtn("⏸");
  const voices = pickVoices();
  const queue = [];
  script.forEach((turn, ti) => {
    if (ti < startTurn) return;
    (String(turn.text).match(/[^.!?]+[.!?]*/g) || [turn.text]).forEach((s) => { if (s.trim()) queue.push({ ti, sp: turn.speaker, text: s.trim() }); });
  });
  let qi = 0;
  (function next() {
    if (!ttsState.playing) return;
    if (qi >= queue.length) { finishPodcast(); return; }
    const item = queue[qi];
    highlightPodLine(item.ti);
    const u = new SpeechSynthesisUtterance(item.text);
    u.rate = ttsState.rate || 1;
    const v = item.sp === "B" ? voices.b : voices.a;
    if (v) u.voice = v;
    u.onend = () => { qi++; next(); };
    u.onerror = () => { qi++; next(); };
    synth.speak(u);
  })();
}
function finishPodcast() {
  ttsState.playing = false; ttsState.paused = false; ttsState.curTurn = 0;
  setPlayBtn("▶");
  $$(".pod-line").forEach((el) => el.classList.remove("speaking"));
}
function stopPodcast() { stopSpeech(); setPlayBtn("▶"); $$(".pod-line").forEach((el) => el.classList.remove("speaking")); }
function stopSpeech() {
  if (window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch {} }
  ttsState.playing = false; ttsState.paused = false;
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

// ── Backup / restore (export & import the individual's data) ─────────────────
function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportData() {
  busy(true, "Preparing your backup…");
  try {
    const list = await listNotes();
    const notes = [];
    for (const meta of list) {
      const full = await getNote(meta.id);
      let chat = [];
      try { chat = await listChat(meta.id); } catch {}
      notes.push({
        title: full.title, source_type: full.source_type, source_ref: full.source_ref,
        transcript: full.transcript, notes_md: full.notes_md,
        flashcards: full.flashcards, quiz: full.quiz, chat,
      });
    }
    downloadJSON({ app: "recall", version: 1, exportedAt: new Date().toISOString(), notes },
      `recall-backup-${new Date().toISOString().slice(0, 10)}.json`);
    toast(`Backed up ${notes.length} note${notes.length === 1 ? "" : "s"} ✓`, "success");
  } catch (err) { toast(err.message, "error"); } finally { busy(false); }
}

function pickImportFile() {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "application/json,.json";
  inp.onchange = () => { if (inp.files && inp.files[0]) importData(inp.files[0]); };
  inp.click();
}

async function importData(file) {
  let backup;
  try { backup = JSON.parse(await file.text()); }
  catch { toast("That file isn't valid JSON.", "error"); return; }
  if (!backup || !Array.isArray(backup.notes)) { toast("That's not a Recall backup file.", "error"); return; }
  if (!confirm(`Restore ${backup.notes.length} note${backup.notes.length === 1 ? "" : "s"}? They'll be added to your current notes.`)) return;
  busy(true, "Restoring your notes…");
  try {
    for (const n of backup.notes) {
      const created = await createNote({
        title: n.title || "Untitled note", source_type: n.source_type || "paste",
        source_ref: n.source_ref || null, transcript: n.transcript || "",
        notes_md: n.notes_md || "", flashcards: n.flashcards || [], quiz: n.quiz || [],
      });
      if (Array.isArray(n.chat)) {
        for (const m of n.chat) { if (m && m.role && m.content) { try { await addChat(created.id, m.role, m.content); } catch {} } }
      }
    }
    toast("Backup restored ✓", "success");
    await goLibrary();
  } catch (err) { toast(err.message, "error"); } finally { busy(false); }
}

// Import notes saved in this browser's local mode into the cloud account.
async function migrateFromDevice() {
  let localNotes = [];
  try { localNotes = JSON.parse(localStorage.getItem("recall_notes") || "[]"); } catch {}
  if (!localNotes.length) { toast("No notes are saved on this device to import.", "error"); return; }
  if (!confirm(`Import ${localNotes.length} note${localNotes.length === 1 ? "" : "s"} saved on this device into your account?`)) return;
  busy(true, "Importing your notes…");
  try {
    let done = 0;
    for (const ln of localNotes) {
      const created = await createNote({
        title: ln.title || "Untitled note", source_type: ln.source_type || "paste",
        source_ref: ln.source_ref || null, transcript: ln.transcript || "",
        notes_md: ln.notes_md || "", flashcards: ln.flashcards || [], quiz: ln.quiz || [],
      });
      let chat = [];
      try { chat = JSON.parse(localStorage.getItem("recall_chat_" + ln.id) || "[]"); } catch {}
      for (const m of chat) { if (m && m.role && m.content) { try { await addChat(created.id, m.role, m.content); } catch {} } }
      done++;
    }
    toast(`Imported ${done} note${done === 1 ? "" : "s"} into your account ✓`, "success");
    await goLibrary();
  } catch (err) { toast(err.message, "error"); } finally { busy(false); }
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
  stopSpeech();
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

// Warm up TTS voices (some browsers load them asynchronously).
if (window.speechSynthesis) {
  try { window.speechSynthesis.getVoices(); window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices(); } catch {}
}
// Stop any narration if the app is closed/backgrounded.
window.addEventListener("pagehide", () => { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch {} });

// Resolve the signed-in user's role, then route to the app or the access gate.
async function enterApp() {
  if (backend === "local") { state.role = "member"; await goLibrary(); return; }
  state.role = null; render(); // show "checking access…" gate while we load the role
  try {
    const profile = await getProfile();
    state.role = profile?.role || "pending";
  } catch { state.role = "pending"; }
  if (state.role === "member" || state.role === "admin") await goLibrary();
  else render(); // pending / blocked
}

async function boot() {
  state.streak = updateStreak();
  onAuthChange((user) => {
    const was = state.user;
    state.user = user;
    if (user && !was) enterApp();
    else if (!user) { state.role = null; state.notes = null; state.current = null; render(); }
  });
  state.user = await getUser();
  if (state.user) await enterApp();
  else render();
}
boot();
