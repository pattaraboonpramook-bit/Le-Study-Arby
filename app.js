// app.js — Recall single-page app
// ─────────────────────────────────────────────────────────────────────────────
import {
  backend, clearLocalData,
  signIn, signUp, signOut, getUser, onAuthChange,
  getProfile, listUsers, setUserRole,
  listNotes, getNote, createNote, updateNote, deleteNote,
  listChat, addChat,
} from "./store.js";
import { generate, hasGeminiKey, getGeminiKey, setGeminiKey, getLang, setLang, onAiStatus } from "./ai.js";
import { GOOGLE_CLIENT_ID, GOOGLE_API_KEY } from "./drive-config.js";

// Output languages: value is the name used in the AI prompt; label is the native name.
const LANGS = [
  { v: "auto", n: "🌐 Auto (match source)" },
  { v: "English", n: "English" }, { v: "French", n: "Français" }, { v: "Spanish", n: "Español" },
  { v: "German", n: "Deutsch" }, { v: "Italian", n: "Italiano" }, { v: "Portuguese", n: "Português" },
  { v: "Dutch", n: "Nederlands" }, { v: "Thai", n: "ไทย" }, { v: "Chinese", n: "中文" },
  { v: "Japanese", n: "日本語" }, { v: "Korean", n: "한국어" }, { v: "Arabic", n: "العربية" },
  { v: "Hindi", n: "हिन्दी" }, { v: "Indonesian", n: "Bahasa Indonesia" }, { v: "Vietnamese", n: "Tiếng Việt" },
  { v: "Russian", n: "Русский" },
];
import { levelInfo, addXP, ACHIEVEMENTS, getEarned, earnedCount, unlock } from "./gamify.js";
import { fmtDate, fmtSize, titleFromMarkdown, safeName, sourceLabel, downloadText, downloadJSON } from "./utils.js";

const app = document.getElementById("app");

// Ambient animated gradient orbs behind the app (energy, tasteful, motion-safe).
if (!document.querySelector(".bg-orbs")) {
  const orbs = document.createElement("div");
  orbs.className = "bg-orbs";
  orbs.setAttribute("aria-hidden", "true");
  orbs.innerHTML = "<span></span><span></span>";
  document.body.appendChild(orbs);
}

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  user: null,
  role: null,               // pending | member | admin | blocked (cloud mode)
  view: "library",          // library | capture | note | admin | ask
  notes: null,              // null = not loaded yet
  adminUsers: null,         // loaded for the admin panel
  search: "",
  streak: 1,
  streakGained: false,
  current: null,            // full note object
  noteTab: "notes",         // notes | flashcards | quiz | chat
  captureMode: "record",    // record | paste | youtube
  transcript: "",           // captured raw text
  sourceType: "record",
  sourceRef: null,
  ytTitle: "",
  ytManual: "",             // YouTube transcript (fetched or pasted)
  ytStatus: "",
  images: [],               // picked photos for the Photo capture mode
  files: [],                // picked files (PDF/text) for the Files capture mode
  fc: { order: [], i: 0, flipped: false },
  quiz: { answers: {} },
  chat: null,               // loaded lazily
  feynman: null,            // teach-back result
  feynmanText: "",          // teach-back explanation draft
  podcastScript: null,      // [{speaker,text}] audio-overview script
  advanced: null,           // {deepDive, mainPoints[]}
  authMode: "signin",
  selectMode: false,        // library multi-select (for combining notes)
  selected: new Set(),      // ids picked while in select mode
  subjectFilter: "",        // library filter: "" = all, "__none__" = unlabelled, else a subject
  notesEditing: false,      // notes tab: hand-edit mode
};

let dictation = null;       // speech-to-text for teach-back (separate from capture)
let ttsState = { playing: false, paused: false, rate: 1, volume: 1, curTurn: 0 }; // podcast playback

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
let busyNote = ""; // sticky status (e.g. "retrying…") that overrides the fun phrases
function busy(on, label = "Working…") {
  let o = document.getElementById("overlay");
  if (on) {
    busyNote = "";
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
      if (p) p.textContent = busyNote || BUSY_PHRASES[Math.floor(Math.random() * BUSY_PHRASES.length)];
    }, 2200);
  } else if (o) {
    clearInterval(busyTimer); busyTimer = null;
    busyNote = "";
    o.remove();
  }
}
// Pin a steady status line in the loading overlay (overrides the fun phrases).
function busyNoteSet(msg) {
  busyNote = msg || "";
  const p = $("#busy-label");
  if (p && msg) p.textContent = msg;
}
// When the AI layer is retrying through an overload, say so instead of looking frozen.
onAiStatus(busyNoteSet);

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
  const colors = ["#d4af37", "#e6c86b", "#b8902b", "#f0d98a", "#8e6d14", "#3f8f6b"];
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

// Study streak: counts consecutive days you open Recall. Returns { streak, gained }.
function updateStreak() {
  try {
    const today = new Date().toDateString();
    const last = localStorage.getItem("recall_streak_date");
    let streak = +(localStorage.getItem("recall_streak") || 0);
    let gained = false;
    if (last !== today) {
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      streak = last === yesterday ? streak + 1 : 1;
      localStorage.setItem("recall_streak", String(streak));
      localStorage.setItem("recall_streak_date", today);
      gained = true;
    }
    return { streak: streak || 1, gained };
  } catch { return { streak: 1, gained: false }; }
}

// ── Gamification (XP / levels / achievements) ────────────────────────────────
function award(amount, achievements = []) {
  const res = addXP(amount);
  if (res.leveledUp) {
    confetti();
    toast(`⭐ Level up! You hit Level ${res.to}`, "success");
    if (res.to >= 5) celebrate("level-5");
  }
  for (const id of achievements) celebrate(id);
  updateXpChip();
}
function celebrate(id) {
  const a = unlock(id);
  if (a) { confetti(); toast(`🏅 Achievement unlocked — ${a.name}!`, "success"); updateXpChip(); }
}
function updateXpChip() {
  const chip = $("#xp-chip"); if (!chip) return;
  const info = levelInfo();
  const lvl = chip.querySelector(".xp-lvl"); if (lvl) lvl.textContent = "Lv " + info.level;
  const ring = chip.querySelector(".xp-ring"); if (ring) ring.style.setProperty("--pct", info.pct);
}
// Track which study tools were used on a note; all five unlocks "Polymath".
const POLY_TOOLS = ["advanced", "flashcards", "quiz", "teach", "podcast"];
function markTool(tool) {
  const id = state.current && state.current.id; if (!id) return;
  const key = "recall_tools_" + id;
  let set = {}; try { set = JSON.parse(localStorage.getItem(key) || "{}"); } catch {}
  set[tool] = 1; try { localStorage.setItem(key, JSON.stringify(set)); } catch {}
  if (POLY_TOOLS.every((t) => set[t])) celebrate("polymath");
}
function openStats() {
  const info = levelInfo();
  const earned = getEarned();
  const notes = state.notes ? state.notes.length : "—";
  const grid = ACHIEVEMENTS.map((a) => {
    const got = !!earned[a.id];
    return `<div class="ach ${got ? "got" : "locked"}"><div class="ach-ic">${got ? a.icon : "🔒"}</div><div><div class="ach-name">${a.name}</div><div class="ach-desc">${a.desc}</div></div></div>`;
  }).join("");
  const o = document.createElement("div");
  o.className = "stats-overlay"; o.id = "stats-overlay";
  o.innerHTML = `<div class="stats-card">
    <button class="stats-close" id="stats-close" aria-label="Close">✕</button>
    <div class="stats-hero">
      <div class="big-ring" style="--pct:${info.pct}"><div class="big-ring-in"><span class="big-lvl">${info.level}</span><small>LEVEL</small></div></div>
      <div class="stats-meta">
        <div class="stats-name">Level ${info.level}</div>
        <div class="stats-xp">${info.into} / ${info.need} XP to Level ${info.level + 1}</div>
        <div class="stats-chips"><span class="spill">🔥 ${state.streak}-day streak</span><span class="spill">📚 ${notes} notes</span><span class="spill">🏅 ${earnedCount()}/${ACHIEVEMENTS.length}</span></div>
      </div>
    </div>
    <h3 class="stats-h">Achievements</h3>
    <div class="ach-grid">${grid}</div>
  </div>`;
  document.body.appendChild(o);
  o.addEventListener("click", (e) => { if (e.target === o) o.remove(); });
  $("#stats-close").onclick = () => o.remove();
}

// Ask for the Gemini key (saved in this browser only). Returns true if we have one.
// Friendly, guided key setup (replaces a bare prompt()). Resolves true once a
// key is saved. Walks the student through getting their own free key.
function keyWizard(prefill = "") {
  return new Promise((resolve) => {
    const o = document.createElement("div");
    o.className = "stats-overlay";
    o.innerHTML = `<div class="stats-card key-wizard" style="max-width:480px">
      <button class="stats-close" id="kw-close" aria-label="Close">✕</button>
      <h3 class="stats-h" style="margin-bottom:6px">Turn on AI ✨</h3>
      <p style="color:var(--text-2);font-size:.92rem;margin-bottom:16px">Recall runs on Google's <strong>free</strong> Gemini AI. It takes about a minute to connect your own free key — then notes, flashcards, quizzes and the rest all work on this device.</p>
      <ol class="kw-steps">
        <li><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Open Google AI Studio ↗</a> &nbsp;(sign in with any Google account)</li>
        <li>Click <strong>Create API key</strong> and copy it</li>
        <li>Paste it below and save</li>
      </ol>
      <input class="input" id="kw-input" placeholder="Paste your key here (starts with AI…)" autocomplete="off" spellcheck="false" value="${escapeHtml(prefill)}" />
      <div id="kw-err" class="kw-err"></div>
      <div class="kw-actions">
        ${prefill ? `<button class="btn btn-ghost" id="kw-remove">Remove key</button>` : ""}
        <button class="btn btn-primary" id="kw-save">Save &amp; turn on AI</button>
      </div>
      <p class="kw-foot">🔒 Your key is stored only in this browser — never uploaded or shared. The free tier has a daily limit that resets each day.</p>
    </div>`;
    document.body.appendChild(o);
    const input = $("#kw-input");
    const err = $("#kw-err");
    const done = (ok) => { o.remove(); resolve(ok); };
    $("#kw-close").onclick = () => done(hasGeminiKey());
    o.addEventListener("click", (e) => { if (e.target === o) done(hasGeminiKey()); });
    const save = () => {
      const k = (input.value || "").trim();
      if (k.length < 20) { err.textContent = "That key looks too short — copy the whole thing from AI Studio."; input.focus(); return; }
      setGeminiKey(k);
      toast("AI is on — key saved on this device ✓", "success");
      done(true);
    };
    $("#kw-save").onclick = save;
    const rm = $("#kw-remove");
    if (rm) rm.onclick = () => { setGeminiKey(""); toast("Key removed", "success"); done(false); };
    input.onkeydown = (e) => { if (e.key === "Enter") save(); };
    setTimeout(() => input.focus(), 50);
  });
}

async function ensureKey() {
  if (hasGeminiKey()) return true;
  return keyWizard("");
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

// titleFromMarkdown, fmtDate, sourceLabel → utils.js

// Difficulty + count for flashcards / quizzes (stored per-device).
const getDifficulty = () => { try { return localStorage.getItem("recall_difficulty") || "Medium"; } catch { return "Medium"; } };
const setDifficulty = (d) => { try { localStorage.setItem("recall_difficulty", d); } catch {} };
const getCount = (kind, def) => { try { const v = parseInt(localStorage.getItem("recall_count_" + kind), 10); return v > 0 ? v : def; } catch { return def; } };
const setCount = (kind, n) => { try { localStorage.setItem("recall_count_" + kind, String(n)); } catch {} };

// Podcast length (minutes) + playback volume (0–1), stored per-device.
const getPodMinutes = () => { try { const v = parseInt(localStorage.getItem("recall_pod_minutes"), 10); return v > 0 ? v : 5; } catch { return 5; } };
const setPodMinutes = (n) => { try { localStorage.setItem("recall_pod_minutes", String(n)); } catch {} };
const getPodVolume = () => { try { const v = parseInt(localStorage.getItem("recall_pod_volume"), 10); return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) / 100 : 1; } catch { return 1; } };
const setPodVolume = (v01) => { try { localStorage.setItem("recall_pod_volume", String(Math.round(v01 * 100))); } catch {} };

// Flashcard spaced-repetition levels, per note: { [cardIndex]: level 0..5 }.
// Higher = better known. Weak cards (low level) are studied first. Per-device.
const getSRS = (id) => { try { return JSON.parse(localStorage.getItem("recall_srs_" + id) || "{}") || {}; } catch { return {}; } };
const setSRS = (id, map) => { try { localStorage.setItem("recall_srs_" + id, JSON.stringify(map)); } catch {} };
const SRS_MASTERED = 3; // level at/above which a card counts as "mastered"
// Order card indices weakest-first so review targets what you don't know yet.
function srsOrder(id, cards) {
  const srs = getSRS(id);
  return cards.map((_, i) => i).sort((a, b) => (srs[a] || 0) - (srs[b] || 0));
}

// Quiz attempt history, per note: [{ at, score, total }]. Per-device.
const getQuizHist = (id) => { try { return JSON.parse(localStorage.getItem("recall_quizhist_" + id) || "[]") || []; } catch { return []; } };
function pushQuizHist(id, score, total) {
  try {
    const h = getQuizHist(id);
    h.push({ at: new Date().toISOString(), score, total });
    localStorage.setItem("recall_quizhist_" + id, JSON.stringify(h.slice(-50)));
  } catch {}
}

// Per-note subject/folder (a simple label), stored per-device as { [id]: "Subject" }.
const getSubjects = () => { try { return JSON.parse(localStorage.getItem("recall_subjects") || "{}") || {}; } catch { return {}; } };
const getSubject = (id) => getSubjects()[id] || "";
const setSubject = (id, s) => {
  try {
    const m = getSubjects();
    if (s && s.trim()) m[id] = s.trim().slice(0, 40); else delete m[id];
    localStorage.setItem("recall_subjects", JSON.stringify(m));
  } catch {}
};

// downloadText, safeName → utils.js

// Study-tools bar (difficulty + how many) for the Flashcards / Quiz tabs.
function toolsBar(kind) {
  const cur = getDifficulty();
  const label = kind === "quiz" ? "Questions" : "Cards";
  const n = getCount(kind, kind === "quiz" ? 8 : 10);
  const counts = [5, 8, 10, 15, 20, 25];
  const diff = ["Easy", "Medium", "Hard"].map((d) => `<button class="diff-opt ${d === cur ? "active" : ""}" data-diff="${d}">${d}</button>`).join("");
  const nums = counts.map((c) => `<button class="num-opt ${c === n ? "active" : ""}" data-kind="${kind}" data-count="${c}">${c}</button>`).join("");
  return `<div class="tab-tools">
    <span class="tt-label">Difficulty</span><div class="diffbar">${diff}</div>
    <span class="tt-label">${label}</span><div class="numbar">${nums}</div>
  </div>`;
}

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
  else if (state.view === "ask") { main.innerHTML = askHTML(); wireAsk(); }
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
    <p class="sub">Lectures in — notes, flashcards & quizzes out. Let's make it stick.</p>
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
  const info = levelInfo();
  return `<header class="topbar">
    <div class="brand" id="brand"><span class="mark">✺</span><span class="name">Recall</span></div>
    <div class="topbar-actions">
      <button class="xp-chip" id="xp-chip" title="Your progress, streak & achievements">
        <span class="xp-ring" style="--pct:${info.pct}"><span class="xp-lvl">Lv ${info.level}</span></span>
        <span class="xp-streak">🔥 ${state.streak}</span>
      </button>
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
  const xp = $("#xp-chip"); if (xp) xp.onclick = openStats;
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
       <button id="menu-key">🔑 ${hasGeminiKey() ? "Change" : "Add"} Gemini key</button>
       <div class="menu-lang"><span>🌐 Language</span><select id="menu-lang-select">${LANGS.map((l) => `<option value="${l.v}"${getLang() === l.v ? " selected" : ""}>${l.n}</option>`).join("")}</select></div>` +
      (state.role === "admin" ? `<button id="menu-admin">🛡 Admin panel</button>` : "") +
      `<button id="menu-export">⬇ Back up my notes</button>
       <button id="menu-import">⬆ Restore from backup</button>` +
      (backend === "cloud" ? `<button id="menu-migrate">⤴ Import notes from this device</button>` : "") +
      (installEvent ? `<button id="menu-install">⬇ Install app</button>` : "") +
      (backend === "local"
        ? `<button id="menu-clear" class="btn-danger">🗑 Clear local data</button>`
        : `<button id="menu-signout" class="btn-danger">⎋ Sign out</button>`);
    avatar.parentElement.appendChild(menu);
    $("#menu-key").onclick = () => { menu.remove(); keyWizard(getGeminiKey()); };
    const langSel = $("#menu-lang-select");
    if (langSel) langSel.onchange = () => {
      setLang(langSel.value);
      const name = (LANGS.find((l) => l.v === langSel.value) || {}).n || langSel.value;
      toast(langSel.value === "auto" ? "Language: auto — matches your material" : `Output language: ${name} ✓`, "success");
      menu.remove();
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
    setTimeout(() => document.addEventListener("click", function close(e) {
      if (menu.contains(e.target)) return; // keep open while using the menu (e.g. the language picker)
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
      ${state.selectMode
        ? `<button class="btn btn-ghost" id="combine-cancel">Cancel</button>`
        : `${(state.notes && state.notes.length >= 1) ? `<div class="menu-wrap"><button class="btn btn-icon btn-ghost" id="lib-more" title="More actions" aria-label="More actions" aria-haspopup="menu">⋯</button></div>` : ""}
           <button class="btn btn-primary" id="new-note">＋ New note</button>`}
    </div>
  </div>`;

  if (state.notes === null) return head + `<div class="empty"><div class="spinner" style="margin:0 auto"></div></div>`;

  if (state.notes.length === 0) {
    return head + `<div class="empty">
      <div class="big">✨</div><h3>A blank slate — let's change that</h3>
      <p>Record a lecture, paste your notes, or drop a YouTube link. I'll turn it into something you can actually study — and you'll rack up XP doing it.</p>
      <button class="btn btn-primary" id="new-note-2" style="margin-top:16px">Make your first note</button>
    </div>`;
  }

  const sel = state.selectMode;
  const subjectsMap = getSubjects();
  const present = [...new Set(state.notes.map((n) => subjectsMap[n.id]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const anyNoSubject = state.notes.some((n) => !subjectsMap[n.id]);
  const chipsBar = (!sel && present.length)
    ? `<div class="subject-bar">
        <button class="subj-opt ${!state.subjectFilter ? "active" : ""}" data-subj="">All</button>
        ${present.map((s) => `<button class="subj-opt ${state.subjectFilter === s ? "active" : ""}" data-subj="${escapeHtml(s)}">🏷 ${escapeHtml(s)}</button>`).join("")}
        ${anyNoSubject ? `<button class="subj-opt ${state.subjectFilter === "__none__" ? "active" : ""}" data-subj="__none__">No subject</button>` : ""}
      </div>`
    : "";

  const filtered = state.notes.filter((n) => {
    if (state.search && !n.title.toLowerCase().includes(state.search.toLowerCase())) return false;
    if (state.subjectFilter) {
      const s = subjectsMap[n.id] || "";
      if (state.subjectFilter === "__none__") return !s;
      return s === state.subjectFilter;
    }
    return true;
  });

  if (filtered.length === 0) return head + chipsBar + `<div class="empty"><p>No notes here${state.search ? ` matching “${escapeHtml(state.search)}”` : ""}.</p></div>`;

  const cards = filtered.map((n) => {
    const on = state.selected.has(n.id);
    const subj = subjectsMap[n.id];
    return `<button class="note-card ${sel ? "selectable" : ""} ${on ? "selected" : ""}" data-id="${n.id}">
      ${sel ? `<span class="note-check">${on ? "✓" : ""}</span>` : ""}
      <h3>${escapeHtml(n.title)}</h3>
      <div class="meta">
        ${subj ? `<span class="pill subject">🏷 ${escapeHtml(subj)}</span>` : ""}
        <span class="pill ${n.source_type}">${sourceLabel[n.source_type] || n.source_type}</span>
        <span>${fmtDate(n.updated_at)}</span>
      </div>
    </button>`;
  }).join("");
  const bar = sel
    ? `<div class="combine-bar">
        <span>${state.selected.size} selected</span>
        <button class="btn btn-primary" id="combine-go"${state.selected.size < 2 ? " disabled" : ""}>⛓ Combine ${state.selected.size >= 2 ? state.selected.size + " notes" : "notes"}</button>
       </div>`
    : "";
  return head + chipsBar + `<div class="note-grid">${cards}</div>` + bar;
}

function wireLibrary() {
  const nb = $("#new-note"); if (nb) nb.onclick = goCapture;
  const nb2 = $("#new-note-2"); if (nb2) nb2.onclick = goCapture;
  const more = $("#lib-more"); if (more) more.onclick = (e) => { e.stopPropagation(); openLibMenu(more); };
  const cc = $("#combine-cancel"); if (cc) cc.onclick = exitSelectMode;
  const cg = $("#combine-go"); if (cg) cg.onclick = combineSelected;
  $$(".subj-opt").forEach((b) => (b.onclick = () => { state.subjectFilter = b.dataset.subj; renderView(); }));
  const s = $("#search");
  if (s) s.oninput = () => {
    state.search = s.value;
    const grid = $("#main");
    // re-render just the grid area without losing focus is overkill; debounce-lite:
    const pos = s.selectionStart;
    grid.innerHTML = libraryHTML(); wireLibrary();
    const s2 = $("#search"); if (s2) { s2.focus(); s2.setSelectionRange(pos, pos); }
  };
  $$(".note-card").forEach((c) => (c.onclick = () => {
    if (state.selectMode) {
      const id = c.dataset.id;
      if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
      renderView();
    } else openNote(c.dataset.id);
  }));
}

// Library "⋯" overflow menu — holds the secondary actions (Ask, Combine) so the
// header stays calm. Mirrors the account menu's build + outside-click-to-close.
function openLibMenu(btn) {
  if ($("#lib-menu")) { $("#lib-menu").remove(); return; } // toggle closed
  const n = (state.notes || []).length;
  const menu = document.createElement("div");
  menu.className = "menu lib-menu";
  menu.id = "lib-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML =
    `<button id="lm-ask">✦ Ask across notes</button>` +
    (n >= 2 ? `<button id="lm-combine">⛓ Combine notes</button>` : "");
  btn.parentElement.appendChild(menu);
  const ask = $("#lm-ask"); if (ask) ask.onclick = () => { menu.remove(); goAsk(); };
  const comb = $("#lm-combine"); if (comb) comb.onclick = () => { menu.remove(); state.selectMode = true; state.selected = new Set(); renderView(); };
  setTimeout(() => document.addEventListener("click", function close(e) {
    if (menu.contains(e.target) || e.target === btn) return;
    menu.remove(); document.removeEventListener("click", close);
  }), 0);
}

function exitSelectMode() { state.selectMode = false; state.selected = new Set(); renderView(); }

// Merge several notes into one new note (concatenates their content under
// per-source headings; the student can then regenerate/enhance from the result).
async function combineSelected() {
  const picked = (state.notes || []).filter((n) => state.selected.has(n.id));
  if (picked.length < 2) { toast("Pick at least 2 notes to combine.", "error"); return; }
  const defTitle = picked.map((n) => n.title).join(" + ").slice(0, 80);
  const title = (window.prompt("Name the combined note", defTitle) || "").trim();
  if (!title) return;
  busy(true, "Combining notes…");
  try {
    const stripTop = (md) => String(md || "").replace(/^\s*#\s+.*(\r?\n)+/, "");
    const parts = [], transcripts = [];
    for (const meta of picked) {
      const full = await getNote(meta.id);
      const body = (full.notes_md || full.transcript || "").trim();
      if (body) parts.push(`## ${full.title}\n\n${full.notes_md ? stripTop(body) : body}`);
      if (full.transcript && full.transcript.trim()) transcripts.push(`— ${full.title} —\n${full.transcript.trim()}`);
    }
    if (!parts.length) throw new Error("Those notes have no content to combine yet.");
    const notes_md = `# ${title}\n\n${parts.join("\n\n---\n\n")}`;
    const created = await createNote({
      title, source_type: "paste", source_ref: null,
      transcript: transcripts.join("\n\n"), notes_md, flashcards: [], quiz: [],
    });
    state.selectMode = false; state.selected = new Set();
    toast(`Combined ${picked.length} notes ✓`, "success");
    openNoteObject(created);
  } catch (err) { toast(err.message, "error"); } finally { busy(false); }
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
  const seg = ["record", "paste", "youtube", "image", "file"].map((m) =>
    `<button data-mode="${m}" class="${m === mode ? "active" : ""}">${{ record: "🎙 Record", paste: "📄 Paste", youtube: "▶ YouTube", image: "📷 Photo", file: "📎 Files" }[m]}</button>`).join("");

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
  } else if (mode === "youtube") {
    body = `<label class="field-label" style="display:block;margin-bottom:6px">YouTube link</label>
      <input class="input" id="yt-url" placeholder="https://www.youtube.com/watch?v=…" value="${escapeHtml(state.sourceRef || "")}" />
      <p style="color:var(--muted);margin:10px 0 4px;font-size:.9rem">Paste the link and press <strong>Make lesson</strong> — Recall watches the video for you (no transcript needed). Best for clips under ~30&nbsp;min; watching a long video can take a minute or two.</p>
      <details class="yt-fallback" ${state.ytManual ? "open" : ""}>
        <summary>⚡ Faster for long videos — paste the transcript instead</summary>
        <textarea class="input" id="yt-manual" style="min-height:150px;margin-top:10px" placeholder="YouTube: ⋯ (or “Show transcript”) → select all → copy → paste here. This skips the slow video-watching step.">${escapeHtml(state.ytManual || "")}</textarea>
      </details>`;
  } else if (mode === "image") {
    const thumbs = state.images.map((im, i) =>
      `<div class="imgthumb"><img src="${im.url}" alt="" /><button class="imgrm" data-i="${i}" title="Remove" aria-label="Remove">✕</button></div>`).join("");
    body = `<label class="dropzone" id="imgdrop">
        <input type="file" id="img-input" accept="image/*" multiple hidden />
        <div class="dz-ic">📷</div>
        <div class="dz-main">Tap to add photos</div>
        <div class="dz-sub">Textbook pages, slides, handwriting, diagrams — add several, I'll read them all.</div>
      </label>
      ${state.images.length ? `<div class="imggrid">${thumbs}</div>` : ""}`;
  } else {
    const items = state.files.map((f, i) =>
      `<div class="filechip"><span class="fc-ic">${f.kind === "pdf" ? "📕" : "📄"}</span><span class="fc-name">${escapeHtml(f.name)}</span><span class="fc-size">${fmtSize(f.size)}</span><button class="filerm" data-i="${i}" title="Remove" aria-label="Remove">✕</button></div>`).join("");
    body = `<label class="dropzone" id="filedrop">
        <input type="file" id="file-input" accept=".pdf,.txt,.md,.markdown,.csv,application/pdf,text/plain,text/markdown,text/csv" multiple hidden />
        <div class="dz-ic">📎</div>
        <div class="dz-main">Tap to add files</div>
        <div class="dz-sub">PDFs and text files — including from Google Drive, iCloud, or Files on your phone. I'll read them into notes.</div>
      </label>
      ${driveEnabled() ? `<button class="btn btn-outline drive-btn" id="drive-btn" type="button">📁 Import from Google Drive</button>` : ""}
      ${state.files.length ? `<div class="filelist">${items}</div>` : ""}`;
  }

  const canTurbo = state.transcript.trim().length > 0 || mode === "paste" || mode === "youtube"
    || (mode === "image" && state.images.length > 0) || (mode === "file" && state.files.length > 0);
  const turboLabel = mode === "youtube" ? "✺ Make lesson" : (mode === "image" || mode === "file") ? "✺ Read & make notes" : "✺ Turbo it";
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

  const imgInput = $("#img-input");
  if (imgInput) imgInput.onchange = () => { addImages(imgInput.files); imgInput.value = ""; };
  $$(".imgrm").forEach((b) => (b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); state.images.splice(+b.dataset.i, 1); renderView(); }));

  const fileInput = $("#file-input");
  if (fileInput) fileInput.onchange = () => { addFiles(fileInput.files); fileInput.value = ""; };
  $$(".filerm").forEach((b) => (b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); state.files.splice(+b.dataset.i, 1); renderView(); }));
  const driveBtn = $("#drive-btn");
  if (driveBtn) driveBtn.onclick = importFromDrive;

  const turbo = $("#turbo");
  if (turbo) turbo.onclick = runTurbo;
}

// Read + downscale picked images to keep requests small and fast.
function resizeImage(file, max = 1568, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > max || h > max) { const s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        const url = c.toDataURL("image/jpeg", quality);
        resolve({ url, data: url.split(",")[1] });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function addImages(fileList) {
  const files = [...(fileList || [])].filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;
  const room = 10 - state.images.length;
  if (room <= 0) { toast("That's the max of 10 photos.", "error"); return; }
  busy(true, "Processing photos…");
  try {
    for (const f of files.slice(0, room)) {
      const { data, url } = await resizeImage(f);
      state.images.push({ name: f.name, mime: "image/jpeg", data, url });
    }
    renderView();
  } catch { toast("Couldn't read one of those images.", "error"); } finally { busy(false); }
}

// ── File upload (PDF / text) for the Files capture mode ───────────────────────
const FILE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB/file — base64 inflation keeps us under Gemini's inline limit
const TOTAL_PDF_MAX = 14 * 1024 * 1024;  // ~14 MB of PDFs → ~18.6 MB base64, under Gemini's ~20 MB inline request cap
// fmtSize → utils.js
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = reject;
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.readAsDataURL(file);
  });
}
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = reject;
    r.onload = () => resolve(String(r.result || ""));
    r.readAsText(file);
  });
}
async function addFiles(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  const room = 5 - state.files.length;
  if (room <= 0) { toast("That's the max of 5 files.", "error"); return; }
  busy(true, "Adding files…");
  try {
    for (const f of files.slice(0, room)) {
      const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
      const isText = (f.type && f.type.startsWith("text/")) || /\.(txt|md|markdown|csv|text|log)$/i.test(f.name);
      if (!isPdf && !isText) {
        toast(`"${f.name}" isn't a PDF or text file. For Word/PowerPoint, export to PDF first.`, "error");
        continue;
      }
      if (f.size > FILE_MAX_BYTES) {
        toast(`"${f.name}" is too large (max ${fmtSize(FILE_MAX_BYTES)}). Try splitting it.`, "error");
        continue;
      }
      if (isPdf) {
        const pdfBytes = state.files.filter((x) => x.kind === "pdf").reduce((s, x) => s + x.size, 0);
        if (pdfBytes + f.size > TOTAL_PDF_MAX) { toast(`Adding "${f.name}" would exceed the ${fmtSize(TOTAL_PDF_MAX)} total for PDFs. Add fewer or smaller PDFs.`, "error"); continue; }
        const data = await readFileAsBase64(f);
        if (!data) { toast(`Couldn't read "${f.name}".`, "error"); continue; }
        state.files.push({ name: f.name, kind: "pdf", mime: "application/pdf", data, size: f.size });
      } else {
        const text = await readFileAsText(f);
        if (!text.trim()) { toast(`"${f.name}" looks empty.`, "error"); continue; }
        state.files.push({ name: f.name, kind: "text", text, size: f.size });
      }
    }
    renderView();
  } catch { toast("Couldn't read one of those files.", "error"); } finally { busy(false); }
}

// ── Google Drive import (Picker) ─────────────────────────────────────────────
// One-tap import straight from Drive. Uses the drive.file scope, so the app only
// ever sees the files the user explicitly picks — no broad Drive access, and no
// Google verification review needed. Credentials live in drive-config.js.
function driveEnabled() { return !!(GOOGLE_CLIENT_ID && GOOGLE_API_KEY); }

let driveToken = null; // cached access token for this session

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Couldn't reach Google — check your connection."));
    document.head.appendChild(s);
  });
}

async function getDriveToken() {
  await loadScript("https://accounts.google.com/gsi/client");
  return new Promise((resolve, reject) => {
    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: "https://www.googleapis.com/auth/drive.file",
        callback: (resp) => {
          if (resp && resp.access_token) { driveToken = resp.access_token; resolve(resp.access_token); }
          else reject(new Error("Google sign-in didn't complete."));
        },
        error_callback: () => reject(new Error("Google sign-in was cancelled or blocked.")),
      });
      client.requestAccessToken({ prompt: driveToken ? "" : "consent" });
    } catch (e) { reject(e); }
  });
}

async function openDrivePicker(token) {
  await loadScript("https://apis.google.com/js/api.js");
  await new Promise((res) => gapi.load("picker", res));
  return new Promise((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setMimeTypes("application/pdf,text/plain,text/markdown,text/csv,application/vnd.google-apps.document")
      .setIncludeFolders(false)
      .setSelectFolderEnabled(false);
    const picker = new google.picker.PickerBuilder()
      .setOAuthToken(token)
      .setDeveloperKey(GOOGLE_API_KEY)
      .addView(view)
      .setCallback((data) => {
        const act = data[google.picker.Response.ACTION];
        if (act === google.picker.Action.PICKED) resolve(data[google.picker.Response.DOCUMENTS] || []);
        else if (act === google.picker.Action.CANCEL) resolve([]);
      })
      .build();
    picker.setVisible(true);
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = reject;
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.readAsDataURL(blob);
  });
}

// Download a picked Drive file into the same shape addFiles produces.
async function fetchDriveFile(doc, token) {
  const id = doc.id;
  const name = doc.name || "Drive file";
  const isGoogleDoc = doc.mimeType === "application/vnd.google-apps.document";
  const url = isGoogleDoc
    ? `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=application/pdf`
    : `https://www.googleapis.com/drive/v3/files/${id}?alt=media`;
  const resp = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (!resp.ok) throw new Error(`Couldn't download "${name}" from Drive.`);
  const isPdf = isGoogleDoc || doc.mimeType === "application/pdf" || /\.pdf$/i.test(name);
  if (isPdf) {
    const blob = await resp.blob();
    if (blob.size > FILE_MAX_BYTES) throw new Error(`"${name}" is too large (max ${fmtSize(FILE_MAX_BYTES)}).`);
    const data = await blobToBase64(blob);
    const outName = isGoogleDoc && !/\.pdf$/i.test(name) ? name + ".pdf" : name;
    return { name: outName, kind: "pdf", mime: "application/pdf", data, size: blob.size };
  }
  const text = await resp.text();
  return { name, kind: "text", text, size: text.length };
}

async function importFromDrive() {
  if (!driveEnabled()) { toast("Google Drive isn't set up yet — add credentials in drive-config.js.", "error"); return; }
  if (state.files.length >= 5) { toast("That's the max of 5 files.", "error"); return; }
  try {
    busy(true, "Connecting to Google Drive…");
    const token = await getDriveToken();
    busy(false); // let the Picker modal show unobstructed
    const docs = await openDrivePicker(token);
    if (!docs.length) return;
    busy(true, "Importing from Drive…");
    for (const d of docs) {
      if (state.files.length >= 5) { toast("That's the max of 5 files.", "error"); break; }
      try {
        const f = await fetchDriveFile(d, token);
        if (f.kind === "pdf") {
          const pdfBytes = state.files.filter((x) => x.kind === "pdf").reduce((s, x) => s + x.size, 0);
          if (pdfBytes + f.size > TOTAL_PDF_MAX) { toast(`"${f.name}" would exceed the ${fmtSize(TOTAL_PDF_MAX)} total for PDFs.`, "error"); continue; }
        } else if (!f.text.trim()) { toast(`"${f.name}" looks empty.`, "error"); continue; }
        state.files.push(f);
      } catch (e) { toast(e.message, "error"); }
    }
    renderView();
  } catch (err) {
    toast(err.message || "Google Drive import failed.", "error");
  } finally {
    busy(false);
  }
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

  if (mode === "file") {
    if (!state.files.length) { toast("Add at least one file first.", "error"); return; }
    const pdfs = state.files.filter((f) => f.kind === "pdf");
    const texts = state.files.filter((f) => f.kind === "text");
    const extraText = texts.map((f) => `# ${f.name}\n\n${f.text}`).join("\n\n");
    if (pdfs.length) {
      task = "document";
      payload = { docs: pdfs.map((f) => ({ mime: f.mime, data: f.data })), extraText };
      transcript = extraText; // PDFs carry no text transcript; keep any text files' content
      busyLabel = "Reading your files…";
    } else {
      task = "notes"; payload = { source: extraText }; transcript = extraText; busyLabel = "Reading your files…";
    }
  } else if (mode === "image") {
    if (!state.images.length) { toast("Add at least one photo first.", "error"); return; }
    task = "image"; payload = { images: state.images.map((i) => ({ mime: i.mime, data: i.data })) }; busyLabel = "Reading your photos…";
  } else if (isYouTube) {
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
  // Watching a video genuinely takes a while — keep a steady, honest message up
  // (with the faster alternative) instead of cycling the quick-task phrases.
  if (task === "video") busyNoteSet("Watching the video — this can take a minute or two for longer clips. Tip: pasting the transcript is much faster.");
  if (task === "document") busyNoteSet("Reading your file — a long PDF can take a minute.");
  try {
    const notes_md = await aiGenerate(task, payload);
    const note = await createNote({
      title: titleFromMarkdown(notes_md, state.ytTitle || "Untitled note"),
      source_type: mode === "file" ? "file" : mode === "image" ? "image" : isYouTube ? "youtube" : (mode === "record" ? "record" : "paste"),
      source_ref: state.sourceRef || null,
      transcript,
      notes_md,
      flashcards: [],
      quiz: [],
    });
    // reset capture state
    state.transcript = ""; state.sourceRef = null; state.ytTitle = ""; state.ytManual = ""; state.ytStatus = ""; state.images = []; state.files = [];
    openNoteObject(note);
    toast(praise(), "success");
    confetti();
    award(12);
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
  state.notesEditing = false;
  state.fc = { order: srsOrder(note.id, note.flashcards || []), i: 0, flipped: false };
  state.quiz = { answers: {} };
  state.chat = null;
  state.feynman = null;
  state.feynmanText = "";
  state.podcastScript = getPodcastLS(note.id);
  state.advanced = getAdvancedLS(note.id);
  ttsState = { playing: false, paused: false, rate: 1, volume: getPodVolume(), curTurn: 0 };
  render();
}

// Note sub-views, split into the reading tabs (shown on the bar) and the study
// tools (folded into one "✦ Study" menu to keep the bar calm instead of a
// scrolling strip of eight equal choices).
const READ_TABS = [["notes", "Notes"], ["mainpoints", "Main Points"], ["advanced", "Advanced"]];
const STUDY_TABS = [["flashcards", "Flashcards", "🎴"], ["quiz", "Quiz", "✓"], ["teach", "Teach-back", "🗣"], ["podcast", "Podcast", "🎙"], ["chat", "Chat", "💬"]];

function noteHTML() {
  const n = state.current;
  const readTabs = READ_TABS
    .map(([k, label]) => `<button data-tab="${k}" class="${state.noteTab === k ? "active" : ""}">${label}</button>`)
    .join("");
  const studyHit = STUDY_TABS.find(([k]) => k === state.noteTab);
  const studyBtn = `<button id="study-btn" class="study-btn${studyHit ? " active" : ""}" aria-haspopup="menu" aria-expanded="false">✦ ${studyHit ? studyHit[1] : "Study"} <span class="caret">▾</span></button>`;

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
      <button class="subject-chip" id="note-subject">🏷 ${getSubject(n.id) ? escapeHtml(getSubject(n.id)) : "Add subject"}</button>
    </div>
    <div class="tabs"><div class="tabs-read">${readTabs}</div><div class="menu-wrap">${studyBtn}</div></div>
    <div id="note-panel"></div>
  </div>`;
}

function wireNote() {
  $("#back").onclick = goLibrary;
  $("#rename").onclick = renameNote;
  $("#delete").onclick = removeNote;
  const sub = $("#note-subject");
  if (sub) sub.onclick = () => {
    const cur = getSubject(state.current.id);
    const v = window.prompt("Subject / folder for this note (leave blank to clear):", cur);
    if (v === null) return;
    setSubject(state.current.id, v);
    sub.textContent = "🏷 " + (getSubject(state.current.id) || "Add subject");
    toast(v.trim() ? "Subject set ✓" : "Subject cleared", "success");
  };
  $$(".tabs-read button").forEach((b) => (b.onclick = () => { state.noteTab = b.dataset.tab; state.notesEditing = false; renderNotePanel(); syncTabActive(); }));
  const studyBtn = $("#study-btn");
  if (studyBtn) studyBtn.onclick = (e) => { e.stopPropagation(); openStudyMenu(studyBtn); };
  renderNotePanel();
}

function syncTabActive() {
  $$(".tabs-read button").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.noteTab));
  const sbtn = $("#study-btn");
  if (sbtn) {
    const hit = STUDY_TABS.find(([k]) => k === state.noteTab);
    sbtn.classList.toggle("active", !!hit);
    sbtn.innerHTML = `✦ ${hit ? hit[1] : "Study"} <span class="caret">▾</span>`;
  }
}

// The "✦ Study" dropdown: folds Flashcards / Quiz / Teach-back / Podcast / Chat
// into one menu so the tab bar stays calm. Mirrors the account menu's behaviour
// (reuses the .menu component + outside-click / Escape to close).
let studyMenuCleanup = null;
function openStudyMenu(btn) {
  if (studyMenuCleanup) { studyMenuCleanup(); return; } // toggle closed
  const menu = document.createElement("div");
  menu.className = "menu study-menu";
  menu.id = "study-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = STUDY_TABS
    .map(([k, label, icon]) => `<button role="menuitem" data-tab="${k}" class="${state.noteTab === k ? "active" : ""}"><span class="si-ico">${icon}</span>${label}</button>`)
    .join("");
  btn.parentElement.appendChild(menu);
  btn.setAttribute("aria-expanded", "true");

  const onDocClick = (e) => { if (!menu.contains(e.target) && !btn.contains(e.target)) studyMenuCleanup && studyMenuCleanup(); };
  const onKey = (e) => { if (e.key === "Escape") studyMenuCleanup && studyMenuCleanup(); };
  studyMenuCleanup = () => {
    menu.remove();
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onKey);
    studyMenuCleanup = null;
  };

  $$("#study-menu button").forEach((mi) => (mi.onclick = () => {
    if (studyMenuCleanup) studyMenuCleanup();
    state.noteTab = mi.dataset.tab;
    state.notesEditing = false;
    renderNotePanel();
    syncTabActive();
  }));

  setTimeout(() => document.addEventListener("click", onDocClick), 0);
  document.addEventListener("keydown", onKey);
}

function renderNotePanel() {
  stopDictation();
  stopSpeech();
  const p = $("#note-panel");
  if (!p) return;
  const tab = state.noteTab;
  if (tab === "notes") p.innerHTML = notesTabHTML();
  else if (tab === "advanced") { p.innerHTML = advancedTabHTML(); wireAdvanced(); }
  else if (tab === "mainpoints") { p.innerHTML = mainPointsTabHTML(); wireAdvanced(); }
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
  if (state.notesEditing) {
    return `<div class="panel"><textarea class="input notes-editor" id="notes-editor" spellcheck="true">${escapeHtml(n.notes_md)}</textarea>
      <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" id="notes-save">✓ Save</button>
        <button class="btn btn-ghost btn-sm" id="notes-cancel">Cancel</button>
        <span class="notes-edithint">Markdown: # Heading · - bullet · **bold**</span>
      </div></div>`;
  }
  return `<div class="panel"><div class="prose">${mdToHtml(n.notes_md)}</div>
    <div style="margin-top:24px;display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-outline btn-sm" id="edit-notes">✎ Edit</button>
      <button class="btn btn-outline btn-sm" id="regen-notes">↻ Regenerate</button>
      <button class="btn btn-outline btn-sm" id="translate-notes">🌐 Translate</button>
      <button class="btn btn-outline btn-sm" id="export-notes">⬇ Markdown</button>
      <button class="btn btn-outline btn-sm" id="print-notes">🖨 Print / PDF</button>
    </div></div>`;
}
function wireNotesTab() {
  const g = $("#gen-notes"); if (g) g.onclick = () => generateNotes();
  const r = $("#regen-notes"); if (r) r.onclick = () => generateNotes();
  const t = $("#translate-notes"); if (t) t.onclick = translateNote;
  const e = $("#edit-notes"); if (e) e.onclick = () => { state.notesEditing = true; renderNotePanel(); };
  const ex = $("#export-notes"); if (ex) ex.onclick = exportNoteMarkdown;
  const pr = $("#print-notes"); if (pr) pr.onclick = printNote;
  const sv = $("#notes-save"); if (sv) sv.onclick = saveEditedNotes;
  const cx = $("#notes-cancel"); if (cx) cx.onclick = () => { state.notesEditing = false; renderNotePanel(); };
}

async function saveEditedNotes() {
  const ta = $("#notes-editor");
  if (!ta) return;
  const md = ta.value.trim();
  if (!md) { toast("Notes can't be empty.", "error"); return; }
  busy(true, "Saving…");
  try {
    await patchNote({ notes_md: md, title: titleFromMarkdown(md, state.current.title) });
    state.notesEditing = false;
    renderNotePanel();
    const tt = $("#note-title"); if (tt) tt.textContent = state.current.title;
    toast("Saved ✓", "success");
  } catch (err) { toast(err.message, "error"); } finally { busy(false); }
}

// Export / print the current note's Markdown.
function exportNoteMarkdown() {
  const n = state.current;
  const md = n.notes_md || n.transcript || "";
  if (!md.trim()) { toast("Nothing to export yet.", "error"); return; }
  downloadText(md, `${safeName(n.title)}.md`);
  toast("Markdown downloaded ✓", "success");
}
function printNote() {
  const n = state.current;
  const md = n.notes_md || "";
  if (!md.trim()) { toast("Nothing to print yet.", "error"); return; }
  const w = window.open("", "_blank");
  if (!w) { toast("Allow pop-ups to print.", "error"); return; }
  const css = `body{font:16px/1.6 Georgia,'Times New Roman',serif;max-width:720px;margin:40px auto;padding:0 24px;color:#111}
    h1{font-size:1.8rem;margin:0 0 .4em} h2{font-size:1.3rem;margin:1.4em 0 .3em;border-bottom:1px solid #ddd;padding-bottom:.2em}
    h3{font-size:1.1rem} code{background:#f2f2f2;padding:1px 5px;border-radius:4px;font-size:.9em}
    blockquote{border-left:3px solid #ccc;margin:1em 0;padding-left:1em;color:#555} ul,ol{padding-left:1.4em} a{color:#1a5fb4}
    @media print{a[href]:after{content:""}}`;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(n.title)}</title><style>${css}</style></head><body>${mdToHtml(md)}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch {} }, 350);
}

// Pop a language chooser overlay; calls onPick(languageValue) when one is chosen.
function pickLanguage(onPick) {
  const o = document.createElement("div");
  o.className = "stats-overlay";
  o.innerHTML = `<div class="stats-card" style="max-width:440px">
    <button class="stats-close" id="lp-close" aria-label="Close">✕</button>
    <h3 class="stats-h" style="margin-bottom:14px">Translate this note into…</h3>
    <div class="lang-grid">${LANGS.filter((l) => l.v !== "auto").map((l) => `<button class="lang-opt" data-v="${l.v}">${l.n}</button>`).join("")}</div>
  </div>`;
  document.body.appendChild(o);
  const close = () => o.remove();
  o.addEventListener("click", (e) => { if (e.target === o) close(); });
  $("#lp-close").onclick = close;
  o.querySelectorAll(".lang-opt").forEach((b) => (b.onclick = () => { close(); onPick(b.dataset.v); }));
}

// ── Explainer: an on-demand "explain this to me" conversation ────────────────
// Reused by the quiz (why an answer is right/wrong) and by selecting text in a
// note. Seeded with one question, then the student can ask for it simpler,
// deeper, like-they're-five, or in their own words. Answers come from the note.
function openExplainer({ heading, seedQuestion, seedLabel }) {
  const n = state.current || {};
  const context = (n.notes_md || n.transcript || "").trim();
  const history = [];

  const o = document.createElement("div");
  o.className = "stats-overlay explainer-overlay";
  o.innerHTML = `<div class="stats-card explainer-card">
    <button class="stats-close" id="ex-close" aria-label="Close">✕</button>
    <h3 class="stats-h" style="margin-bottom:12px">${escapeHtml(heading || "Explain this")}</h3>
    <div class="ex-body" id="ex-body"></div>
    <div class="ex-quick" id="ex-quick">
      <button class="chip-btn" data-style="eli5">🧒 Like I'm 5</button>
      <button class="chip-btn" data-style="more">🔬 More detail</button>
      <button class="chip-btn" data-style="simpler">🙂 Still confused</button>
      <button class="chip-btn" data-style="example">🧩 Give an example</button>
    </div>
    <form class="ex-form" id="ex-form">
      <input class="input" id="ex-input" placeholder="Ask a follow-up…" autocomplete="off" />
      <button class="btn btn-primary btn-sm" type="submit" aria-label="Ask">↑</button>
    </form>
  </div>`;
  document.body.appendChild(o);
  const body = $("#ex-body");
  const close = () => o.remove();
  $("#ex-close").onclick = close;
  o.addEventListener("click", (e) => { if (e.target === o) close(); });
  document.addEventListener("keydown", function esc(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); } });

  let asking = false;
  async function ask(question, label) {
    if (asking || !question) return;
    asking = true;
    body.insertAdjacentHTML("beforeend",
      `<div class="ex-q">${escapeHtml(label || question)}</div><div class="ex-a" data-pending="1"><span class="spinner spinner-sm"></span></div>`);
    body.scrollTop = body.scrollHeight;
    const pending = body.querySelector('.ex-a[data-pending="1"]');
    try {
      const ans = await aiGenerate("chat", { context, history, question });
      history.push({ role: "user", content: question }, { role: "assistant", content: ans });
      if (history.length > 20) history.splice(0, history.length - 20);
      pending.innerHTML = `<div class="prose">${mdToHtml(ans)}</div>`;
    } catch (err) {
      pending.innerHTML = `<span style="color:var(--bad)">${escapeHtml(err.message)}</span>`;
    }
    pending.removeAttribute("data-pending");
    body.scrollTop = body.scrollHeight;
    asking = false;
  }

  const STYLES = {
    eli5: "Explain that again as if I were five years old — very simple words and an everyday analogy.",
    more: "Go deeper on that: more detail and the underlying reasoning, while keeping it clear.",
    simpler: "I'm still confused — explain that more simply, step by step.",
    example: "Give me one concrete example that makes that click.",
  };
  o.querySelectorAll("#ex-quick .chip-btn").forEach((b) =>
    (b.onclick = () => ask(STYLES[b.dataset.style], b.textContent)));
  $("#ex-form").onsubmit = (e) => {
    e.preventDefault();
    const i = $("#ex-input"); const q = i.value.trim(); if (!q) return;
    i.value = ""; ask(q);
  };

  ask(seedQuestion, seedLabel || "Explain this");
}

// Explain a specific quiz question — why the right answer is right (and, if they
// missed it, why their pick was wrong), then let them dig in further.
function explainQuizQuestion(qi) {
  const quiz = state.current.quiz || [];
  const q = quiz[qi];
  if (!q) return;
  const sel = state.quiz.answers[qi];
  const letters = q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join("\n");
  const correct = String.fromCharCode(65 + q.answer);
  const chose = sel !== undefined ? String.fromCharCode(65 + sel) : null;
  const wrong = chose && sel !== q.answer;
  const seed = `I'm revising and just did this multiple-choice question. In clear detail, explain why the correct answer is right${wrong ? `, and why my answer (${chose}) is wrong` : ""}. Base it on the study notes.\n\nQuestion: ${q.question}\nOptions:\n${letters}\nCorrect answer: ${correct}.${chose ? ` My answer: ${chose}.` : ""}`;
  openExplainer({ heading: wrong ? "Why that's not quite right" : "Why this is the answer", seedQuestion: seed, seedLabel: q.question });
}

async function translateNote() {
  const n = state.current;
  const src = n.notes_md || n.transcript;
  if (!src || !src.trim()) { toast("Nothing to translate yet.", "error"); return; }
  pickLanguage(async (lang) => {
    const name = (LANGS.find((l) => l.v === lang) || {}).n || lang;
    busy(true, `Translating into ${name}…`);
    try {
      const translated = await aiGenerate("translate", { source: src, lang });
      await patchNote({ notes_md: translated, title: titleFromMarkdown(translated, n.title) });
      renderNotePanel();
      $("#note-title") && ($("#note-title").textContent = state.current.title);
      toast(`Translated into ${name} ✓`, "success");
    } catch (err) { toast(err.message, "error"); } finally { busy(false); }
  });
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
    award(8);
  } catch (err) { toast(err.message, "error"); } finally { busy(false); }
}

// Advanced tab (Main Points + sophisticated Deep Dive)
const getAdvancedLS = (id) => { try { const s = localStorage.getItem("recall_advanced_" + id); return s ? JSON.parse(s) : null; } catch { return null; } };
const setAdvancedLS = (id, adv) => { try { localStorage.setItem("recall_advanced_" + id, JSON.stringify(adv)); } catch {} };

// Advanced tab — the meticulous, sophisticated elaboration (deep dive).
function advancedTabHTML() {
  const n = state.current;
  const material = (n.notes_md || n.transcript || "").trim();
  if (!material) return genCTA("🧠", "Nothing to analyze yet", "Generate notes first, then unlock the advanced elaboration.", "gen-notes-adv", "Go to Notes");
  const adv = state.advanced;
  if (!adv || !adv.deepDive) return genCTA("🧠", "Advanced", "A meticulous, precise, sophisticated elaboration of this material.", "gen-advanced", "Generate");
  return `<div class="panel advanced">
    <div class="adv-section">
      <h2 class="adv-h">✦ Advanced</h2>
      <p class="adv-sub">A meticulous, precise elaboration.</p>
      <div class="prose">${mdToHtml(adv.deepDive)}</div>
    </div>
    <div style="text-align:center"><button class="btn btn-outline btn-sm" id="regen-advanced">↻ Regenerate</button></div>
  </div>`;
}

// Main Points tab — the simple, easy layer (significant events, actions, plans).
function mainPointsTabHTML() {
  const n = state.current;
  const material = (n.notes_md || n.transcript || "").trim();
  if (!material) return genCTA("📌", "Nothing to break down yet", "Generate notes first, then get the main points.", "gen-notes-adv", "Go to Notes");
  const adv = state.advanced;
  if (!adv || !(adv.mainPoints || []).length) return genCTA("📌", "Main Points", "The most important events, actions, and plans — explained simply.", "gen-advanced", "Generate");
  const mp = adv.mainPoints.map((m, i) =>
    `<div class="mp-item"><div class="mp-num">${i + 1}</div><div><div class="mp-point">${escapeHtml(m.point || "")}</div><div class="mp-simple">${escapeHtml(m.simple || "")}</div></div></div>`).join("");
  return `<div class="panel advanced">
    <div class="adv-section">
      <h2 class="adv-h">✦ Main Points</h2>
      <p class="adv-sub">The most important events, actions &amp; plans — kept simple.</p>
      <div class="mp-list">${mp}</div>
    </div>
    <div style="text-align:center"><button class="btn btn-outline btn-sm" id="regen-advanced">↻ Regenerate</button></div>
  </div>`;
}

function wireAdvanced() {
  const gn = $("#gen-notes-adv"); if (gn) { gn.onclick = () => { state.noteTab = "notes"; renderNotePanel(); syncTabActive(); }; return; }
  const g = $("#gen-advanced"); if (g) { g.onclick = generateAdvanced; return; }
  const rg = $("#regen-advanced"); if (rg) rg.onclick = generateAdvanced;
}

async function generateAdvanced() {
  const n = state.current;
  busy(true, "Assembling the advanced breakdown…");
  try {
    const res = await aiGenerate("advanced", { source: n.notes_md || n.transcript });
    const adv = {
      deepDive: String(res && res.deepDive || ""),
      mainPoints: (res && Array.isArray(res.mainPoints) ? res.mainPoints : []).filter((m) => m && m.point),
    };
    if (!adv.deepDive && !adv.mainPoints.length) throw new Error("Couldn't generate the breakdown — try again.");
    state.advanced = adv;
    setAdvancedLS(n.id, adv);
    renderNotePanel();
    award(6, ["advanced"]); markTool("advanced");
  } catch (err) { toast(err.message, "error"); } finally { busy(false); }
}

// Flashcards tab
function flashTabHTML() {
  const cards = state.current.flashcards || [];
  if (cards.length === 0) {
    return toolsBar("flashcards") + genCTA("🎴", "No flashcards yet", "Generate a deck from your notes and start studying.", "gen-fc", "Generate flashcards");
  }
  const order = state.fc.order.length ? state.fc.order : cards.map((_, i) => i);
  const idx = order[state.fc.i];
  const card = cards[idx];
  const srs = getSRS(state.current.id);
  const mastered = cards.reduce((m, _, i) => m + ((srs[i] || 0) >= SRS_MASTERED ? 1 : 0), 0);
  return toolsBar("flashcards") + `<div class="panel fc-stage${state.fc.flipped ? " flipped" : ""}">
    <div class="fc-progress">Card ${state.fc.i + 1} of ${cards.length} · <span class="fc-mastered">Mastered ${mastered}/${cards.length}</span></div>
    <div class="flashcard ${state.fc.flipped ? "flipped" : ""}" id="flashcard">
      <div class="flashcard-inner">
        <div class="fc-face fc-front"><div><div class="kicker">Question</div><div class="body">${escapeHtml(card.front)}</div></div></div>
        <div class="fc-face fc-back"><div><div class="kicker">Answer</div><div class="body">${escapeHtml(card.back)}</div></div></div>
      </div>
    </div>
    <div class="fc-hint">Tap the card to reveal the answer</div>
    <div class="fc-rate">
      <span class="fc-rate-label">How well did you know it?</span>
      <div class="fc-rate-btns">
        <button class="fc-rate-btn again" data-rate="again">Again</button>
        <button class="fc-rate-btn good" data-rate="good">Good</button>
        <button class="fc-rate-btn easy" data-rate="easy">Easy</button>
      </div>
    </div>
    <div class="fc-nav">
      <button class="btn btn-ghost btn-sm" id="fc-prev">← Prev</button>
      <button class="btn btn-outline btn-sm" id="fc-shuffle">⤮ Shuffle</button>
      <button class="btn btn-ghost btn-sm" id="fc-next">Next →</button>
    </div>
    <div style="text-align:center;margin-top:18px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <button class="btn btn-outline btn-sm" id="regen-fc">↻ Regenerate deck</button>
      <button class="btn btn-ghost btn-sm" id="reset-fc">Reset progress</button>
    </div>
  </div>`;
}
function wireFlash() {
  $$(".diff-opt").forEach((b) => (b.onclick = () => { setDifficulty(b.dataset.diff); renderNotePanel(); }));
  $$(".num-opt").forEach((b) => (b.onclick = () => { setCount(b.dataset.kind, +b.dataset.count); renderNotePanel(); }));
  const g = $("#gen-fc"); if (g) { g.onclick = () => generateFlashcards(); return; }
  $("#flashcard").onclick = () => {
    state.fc.flipped = !state.fc.flipped;
    $("#flashcard").classList.toggle("flipped");
    const stage = $(".fc-stage"); if (stage) stage.classList.toggle("flipped");
  };
  $$(".fc-rate-btn").forEach((b) => (b.onclick = (ev) => { ev.stopPropagation(); rateCard(b.dataset.rate); }));
  $("#fc-prev").onclick = () => { state.fc.i = (state.fc.i - 1 + state.current.flashcards.length) % state.current.flashcards.length; state.fc.flipped = false; renderNotePanel(); };
  $("#fc-next").onclick = () => { state.fc.i = (state.fc.i + 1) % state.current.flashcards.length; state.fc.flipped = false; renderNotePanel(); };
  $("#fc-shuffle").onclick = () => {
    const o = state.current.flashcards.map((_, i) => i);
    for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
    state.fc = { order: o, i: 0, flipped: false }; renderNotePanel();
  };
  $("#regen-fc").onclick = () => generateFlashcards();
  const rp = $("#reset-fc"); if (rp) rp.onclick = () => {
    if (!window.confirm("Reset your mastery progress for this deck?")) return;
    setSRS(state.current.id, {});
    state.fc = { order: srsOrder(state.current.id, state.current.flashcards || []), i: 0, flipped: false };
    renderNotePanel();
  };
}
// Rate the current card (spaced repetition): raises/lowers its mastery level,
// persists it, and moves on. Weak cards float to the front next session.
function rateCard(rate) {
  const n = state.current;
  const cards = n.flashcards || [];
  if (!cards.length) return;
  const order = state.fc.order.length ? state.fc.order : cards.map((_, i) => i);
  const idx = order[state.fc.i];
  const srs = getSRS(n.id);
  const cur = srs[idx] || 0;
  const next = rate === "again" ? 0 : rate === "easy" ? Math.min(5, cur + 2) : Math.min(5, cur + 1);
  srs[idx] = next;
  setSRS(n.id, srs);
  if (cur < SRS_MASTERED && next >= SRS_MASTERED) award(2); // first time this card is mastered
  state.fc.i = (state.fc.i + 1) % cards.length;
  state.fc.flipped = false;
  renderNotePanel();
}
async function generateFlashcards() {
  const n = state.current;
  busy(true, "Making flashcards…");
  try {
    const result = await aiGenerate("flashcards", { source: n.notes_md || n.transcript, difficulty: getDifficulty(), count: getCount("flashcards", 10) });
    const cards = (Array.isArray(result) ? result : []).filter((c) => c && c.front && c.back);
    if (!cards.length) throw new Error("No cards were generated. Try again.");
    await patchNote({ flashcards: cards });
    setSRS(n.id, {}); // fresh deck — reset mastery
    state.fc = { order: cards.map((_, i) => i), i: 0, flipped: false };
    renderNotePanel();
    award(6); markTool("flashcards");
  } catch (err) { toast(err.message, "error"); } finally { busy(false); }
}

// Quiz tab
function quizTabHTML() {
  const quiz = state.current.quiz || [];
  if (quiz.length === 0) {
    return toolsBar("quiz") + genCTA("❓", "No quiz yet", "Generate a practice quiz from your notes.", "gen-quiz", "Generate quiz");
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
    const explain = sel !== undefined
      ? `<div class="q-explain ${sel === q.answer ? "ok" : "no"}">
          <div>${q.explanation ? `${sel === q.answer ? "✓ Correct. " : "✗ "}${escapeHtml(q.explanation)}` : (sel === q.answer ? "✓ Correct." : "✗ Not quite.")}</div>
          <button class="btn btn-ghost btn-sm q-why" data-q="${qi}">💡 Explain in detail</button>
        </div>` : "";
    return `<div class="q-card"><div class="q">${qi + 1}. ${escapeHtml(q.question)}</div><div class="q-opts">${opts}</div>${explain}</div>`;
  }).join("");

  const scoreCard = done
    ? `<div class="quiz-score"><div class="num">${score}/${quiz.length}</div>
        <p style="color:var(--text-2);margin:6px 0 14px">${score === quiz.length ? "Perfect! 🎉" : score >= quiz.length * 0.7 ? "Nicely done." : "Keep studying — review the explanations above."}</p>
        <button class="btn btn-primary btn-sm" id="quiz-retake">↻ Retake</button></div>`
    : "";

  return toolsBar("quiz") + `<div class="panel quiz">${quizHistLine(state.current.id)}${cards}${scoreCard}
    <div style="text-align:center"><button class="btn btn-outline btn-sm" id="regen-quiz">↻ New quiz</button></div></div>`;
}
// A compact history strip of past attempts on this quiz (persisted per device).
function quizHistLine(id) {
  const h = getQuizHist(id);
  if (!h.length) return "";
  const best = h.reduce((b, a) => (a.total && a.score / a.total >= (b.total ? b.score / b.total : -1)) ? a : b, h[0]);
  const chips = h.slice(-6).map((a) => `<span class="qh-chip">${a.score}/${a.total}</span>`).join("");
  return `<div class="quiz-hist"><span class="qh-label">Best ${best.score}/${best.total} · ${h.length} attempt${h.length === 1 ? "" : "s"}</span><div class="qh-chips">${chips}</div></div>`;
}
function wireQuiz() {
  $$(".diff-opt").forEach((b) => (b.onclick = () => { setDifficulty(b.dataset.diff); renderNotePanel(); }));
  $$(".num-opt").forEach((b) => (b.onclick = () => { setCount(b.dataset.kind, +b.dataset.count); renderNotePanel(); }));
  $$(".q-why").forEach((b) => (b.onclick = () => explainQuizQuestion(+b.dataset.q)));
  const g = $("#gen-quiz"); if (g) { g.onclick = () => generateQuiz(); return; }
  $$(".q-opt").forEach((b) => (b.onclick = () => {
    const qi = +b.dataset.q;
    if (state.quiz.answers[qi] !== undefined) return;
    state.quiz.answers[qi] = +b.dataset.o;
    const quiz = state.current.quiz || [];
    const done = Object.keys(state.quiz.answers).length === quiz.length;
    if (done) {
      const score = quiz.reduce((s, q, i) => s + (state.quiz.answers[i] === q.answer ? 1 : 0), 0);
      pushQuizHist(state.current.id, score, quiz.length); // record before re-render so it shows
      renderNotePanel();
      if (quiz.length && score / quiz.length >= 0.7) confetti();
      award(4 + score * 2);
      if (quiz.length && score === quiz.length) celebrate("quiz-ace");
    } else {
      renderNotePanel();
    }
  }));
  const rt = $("#quiz-retake"); if (rt) rt.onclick = () => { state.quiz = { answers: {} }; renderNotePanel(); };
  const rq = $("#regen-quiz"); if (rq) rq.onclick = () => generateQuiz();
}
async function generateQuiz() {
  const n = state.current;
  busy(true, "Writing quiz questions…");
  try {
    const result = await aiGenerate("quiz", { source: n.notes_md || n.transcript, difficulty: getDifficulty(), count: getCount("quiz", 8) });
    const quiz = (Array.isArray(result) ? result : []).filter(
      (q) => q && q.question && Array.isArray(q.options) && q.options.length >= 2 && Number.isInteger(q.answer));
    if (!quiz.length) throw new Error("No questions were generated. Try again.");
    await patchNote({ quiz });
    state.quiz = { answers: {} };
    renderNotePanel();
    award(6); markTool("quiz");
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
    const sc = Number(r.score) || 0;
    if (sc >= 80) confetti();
    award(4 + Math.round(sc / 10)); markTool("teach");
    if (sc >= 90) celebrate("teach-master");
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
  const picks = pickVoices();
  const voices = allEnglishVoices();
  const vopts = (curName) => voices.map((v) =>
    `<option value="${escapeHtml(v.name)}"${v.name === curName ? " selected" : ""}>${escapeHtml(v.name.replace(/\(.*?\)/g, "").trim() || v.name)}${v.localService === false ? " · online" : ""}</option>`).join("");
  const voiceRow = (supported && voices.length)
    ? `<div class="pod-voices">
        <label>🔊 Alex<select id="voice-a">${vopts(picks.a && picks.a.name)}</select></label>
        <label>Sam<select id="voice-b">${vopts(picks.b && picks.b.name)}</select></label>
      </div>` : "";
  const vol = Math.round(getPodVolume() * 100);
  const mins = getPodMinutes();
  const minOpts = [2, 3, 5, 8, 10].map((m) => `<option value="${m}"${m === mins ? " selected" : ""}>${m} min</option>`).join("");
  const player = supported
    ? `<div class="pod-player">
        <button class="btn btn-primary btn-icon" id="pod-play" aria-label="Play">▶</button>
        <button class="btn btn-ghost btn-icon" id="pod-stop" aria-label="Stop">■</button>
        <label class="pod-rate">Speed
          <select id="pod-rate"><option value="0.8">0.8×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option></select>
        </label>
        <label class="pod-vol" title="Volume">🔊<input type="range" id="pod-vol" min="0" max="100" value="${vol}" aria-label="Volume"></label>
        <label class="pod-rate" title="Applies when you make a new script">Length
          <select id="pod-minutes">${minOpts}</select>
        </label>
        <button class="btn btn-outline btn-sm" id="regen-pod" style="margin-left:auto">↻ New script</button>
      </div>`
    : `<p style="color:var(--text-2);margin-bottom:12px">Audio playback isn't supported in this browser — here's the script to read:</p>
       <div style="display:flex;gap:10px;align-items:center;justify-content:flex-end;margin-bottom:8px">
         <label class="pod-rate" title="Applies when you make a new script">Length<select id="pod-minutes">${minOpts}</select></label>
         <button class="btn btn-outline btn-sm" id="regen-pod">↻ New script</button>
       </div>`;
  return `<div class="panel podcast">${player}${voiceRow}<div class="pod-script" id="pod-script">${lines}</div>
    <p style="color:var(--muted);font-size:.8rem;margin-top:14px;text-align:center">${voices.length ? "Pick the voices you like — then press play. " : "Voices load from your device. "}Tap any line to start from there.</p></div>`;
}

function wirePodcast() {
  const gn = $("#gen-notes-pod"); if (gn) { gn.onclick = () => { state.noteTab = "notes"; renderNotePanel(); syncTabActive(); }; return; }
  const gp = $("#gen-podcast"); if (gp) { gp.onclick = generatePodcast; return; }
  const play = $("#pod-play"); if (play) play.onclick = togglePodcast;
  const stop = $("#pod-stop"); if (stop) stop.onclick = stopPodcast;
  const rate = $("#pod-rate"); if (rate) rate.onchange = () => { ttsState.rate = parseFloat(rate.value) || 1; };
  ttsState.volume = getPodVolume();
  const vol = $("#pod-vol"); if (vol) vol.oninput = () => { ttsState.volume = (parseInt(vol.value, 10) || 0) / 100; setPodVolume(ttsState.volume); };
  const mins = $("#pod-minutes"); if (mins) mins.onchange = () => setPodMinutes(parseInt(mins.value, 10) || 5);
  const rg = $("#regen-pod"); if (rg) rg.onclick = generatePodcast;
  const va = $("#voice-a"); if (va) va.onchange = () => { setSavedVoice("a", va.value); previewVoice(va.value, "Hi, I'm Alex — this is how I'll sound."); };
  const vb = $("#voice-b"); if (vb) vb.onchange = () => { setSavedVoice("b", vb.value); previewVoice(vb.value, "And I'm Sam. Ready when you are."); };
  $$(".pod-line").forEach((el) => (el.onclick = () => startPodcast(+el.dataset.idx)));
}

// Speak a short sample so the user can hear a voice before committing.
function previewVoice(name, text) {
  const synth = window.speechSynthesis; if (!synth) return;
  stopSpeech();
  const u = new SpeechSynthesisUtterance(text);
  const v = voiceByName(name); if (v) u.voice = v;
  u.rate = ttsState.rate || 1;
  u.volume = getPodVolume();
  try { synth.speak(u); } catch {}
}

async function generatePodcast() {
  const n = state.current;
  stopSpeech();
  busy(true, "Recording your podcast…");
  try {
    const raw = await aiGenerate("podcast", { source: n.notes_md || n.transcript, minutes: getPodMinutes() });
    const script = (Array.isArray(raw) ? raw : [])
      .filter((t) => t && t.text)
      .map((t) => ({ speaker: (t.speaker === "B" || /sam|host ?2|b\b/i.test(String(t.speaker))) ? "B" : "A", text: String(t.text) }));
    if (!script.length) throw new Error("Couldn't write a script — try again.");
    state.podcastScript = script;
    setPodcastLS(n.id, script);
    renderNotePanel();
    award(6, ["podcast"]); markTool("podcast");
  } catch (err) { toast(err.message, "error"); } finally { busy(false); }
}

// ── Text-to-speech engine ────────────────────────────────────────────────────
const allEnglishVoices = () => (window.speechSynthesis?.getVoices() || []).filter((v) => /^en/i.test(v.lang));
const savedVoice = (who) => { try { return localStorage.getItem("recall_voice_" + who) || ""; } catch { return ""; } };
const setSavedVoice = (who, name) => { try { localStorage.setItem("recall_voice_" + who, name || ""); } catch {} };
const voiceByName = (name) => (name ? allEnglishVoices().find((v) => v.name === name) || null : null);

// Score a voice — higher is more natural/pleasant.
function rankVoice(v) {
  const n = v.name.toLowerCase(), l = (v.lang || "").toLowerCase();
  let s = 0;
  if (/natural|neural/.test(n)) s += 60;               // MS "Natural" neural voices
  if (/\bgoogle\b/.test(n)) s += 50;                   // Chrome Google voices
  if (/online/.test(n)) s += 40;
  if (/premium|enhanced|siri/.test(n)) s += 30;
  if (v.localService === false) s += 12;               // network voices tend to be nicer
  if (l.startsWith("en-us")) s += 14; else if (l.startsWith("en-gb")) s += 11; else if (l.startsWith("en")) s += 6;
  if (/david|mark|hazel|zira|microsoft (david|mark|zira|hazel)/.test(n)) s -= 10; // dated/robotic
  return s;
}

// Two distinct, pleasant voices (honours saved preferences; tries female + male for variety).
function pickVoices() {
  const all = allEnglishVoices();
  if (!all.length) return { a: null, b: null };
  const ranked = [...all].sort((x, y) => rankVoice(y) - rankVoice(x));
  const FEM = /female|aria|jenny|michelle|clara|sonia|libby|natasha|samantha|emma|ava|nova|zira|google us english$|uk english female/i;
  const MALE = /\bmale\b|guy|davis|david|mark|ryan|william|brian|eric|uk english male/i;
  const a = voiceByName(savedVoice("a")) || ranked.find((v) => FEM.test(v.name)) || ranked[0];
  const b = voiceByName(savedVoice("b")) || ranked.find((v) => v.name !== a.name && MALE.test(v.name)) || ranked.find((v) => v.name !== a.name) || a;
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
  let qi = 0, prevTi = -1;
  (function next() {
    if (!ttsState.playing) return;
    if (qi >= queue.length) { finishPodcast(); return; }
    const item = queue[qi];
    // A short breath between speakers makes the exchange feel more human.
    const gap = (prevTi !== -1 && item.ti !== prevTi) ? 280 : 55;
    prevTi = item.ti;
    setTimeout(() => {
      if (!ttsState.playing) return;
      highlightPodLine(item.ti);
      const u = new SpeechSynthesisUtterance(item.text);
      u.rate = ttsState.rate || 1;
      u.volume = ttsState.volume ?? 1;
      u.pitch = item.sp === "B" ? 0.92 : 1.08;   // give the two hosts distinct voices
      const v = item.sp === "B" ? voices.b : voices.a;
      if (v) u.voice = v;
      u.onend = () => { qi++; next(); };
      u.onerror = () => { qi++; next(); };
      synth.speak(u);
    }, gap);
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

// ── Ask across all notes ─────────────────────────────────────────────────────
// A library-wide tutor (NotebookLM-style): searches every note, answers only
// from them, and cites which note each part of the answer came from. The thread
// is kept in memory for the session so it survives opening a cited note.
let askThread = [];       // [{ role, content, sources? }]
let askCorpus = null;     // { sig, items:[{id,title,text}] } — cached note bodies
const ASK_STOPWORDS = new Set("the a an and or of to in on for is are was were be been being with as at by from that this these those it its into about over under than then so if but not no do does did can could should would will your you my our their his her they them we us what which who whom whose how why when where".split(" "));
const ASK_SUGGESTIONS = [
  "What are the key themes across all my notes?",
  "Give me a 5-point summary of everything.",
  "What should I review before an exam?",
];

function corpusSig(notes) { return (notes || []).map((n) => n.id + ":" + (n.updated_at || "")).join("|"); }

// Load every note's body once and cache it; re-loads only when the note set or
// any note's updated_at changes (so edits/new notes/deletes invalidate it).
async function loadAskCorpus() {
  const notes = state.notes || [];
  const sig = corpusSig(notes);
  if (askCorpus && askCorpus.sig === sig) return askCorpus.items;
  const items = await Promise.all(notes.map(async (meta) => {
    try {
      const full = await getNote(meta.id);
      return { id: meta.id, title: full.title || meta.title || "Untitled", text: String(full.notes_md || full.transcript || "").trim() };
    } catch {
      return { id: meta.id, title: meta.title || "Untitled", text: "" };
    }
  }));
  askCorpus = { sig, items: items.filter((it) => it.text) };
  return askCorpus.items;
}

function askKeywords(q) {
  return [...new Set(String(q).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !ASK_STOPWORDS.has(w)))];
}

// Pick the notes most relevant to the question (keyword overlap, title weighted).
// Falls back to the most recent notes when nothing matches, so the model can
// still say "your notes don't cover this".
function rankNotes(items, q, k) {
  const kw = askKeywords(q);
  if (!kw.length) return items.slice(0, Math.min(k, items.length));
  const scored = items.map((it) => {
    const title = it.title.toLowerCase(), body = it.text.toLowerCase();
    let score = 0;
    for (const w of kw) {
      if (title.includes(w)) score += 5;
      let idx = 0, c = 0;
      while (c < 25 && (idx = body.indexOf(w, idx)) !== -1) { c++; idx += w.length; }
      score += c;
    }
    return { it, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const hits = scored.filter((s) => s.score > 0).slice(0, k).map((s) => s.it);
  return hits.length ? hits : items.slice(0, Math.min(k, items.length));
}

function buildAskContext(sources) {
  const CAP = 2600; // keep each source compact so several fit comfortably
  return sources.map((s) => `[${s.n}] "${s.title}"\n${s.text.slice(0, CAP)}`).join("\n\n----\n\n");
}

// Render an answer: Markdown + inline [n] citation chips + a Sources footer.
function renderAskAnswer(content, sources) {
  let html = mdToHtml(content);
  const cited = new Set();
  html = html.replace(/\[(\d+)\]/g, (m, d) => {
    const n = +d;
    const src = sources.find((s) => s.n === n);
    if (!src) return m;
    cited.add(n);
    return `<button class="cite" data-note="${escapeHtml(src.id)}" title="${escapeHtml(src.title)}">${n}</button>`;
  });
  const used = sources.filter((s) => cited.has(s.n));
  const foot = used.length
    ? `<div class="cite-sources"><span class="cs-label">Sources</span>${used.map((s) => `<button class="cite-src" data-note="${escapeHtml(s.id)}">${escapeHtml(s.title.slice(0, 44))} ↗</button>`).join("")}</div>`
    : "";
  return `<div class="prose">${html}</div>${foot}`;
}

function askMsgHTML(m) {
  if (m.role === "user") return `<div class="msg user">${escapeHtml(m.content)}</div>`;
  return `<div class="msg assistant">${renderAskAnswer(m.content, m.sources || [])}</div>`;
}

function askHTML() {
  const n = (state.notes || []).length;
  const body = askThread.length
    ? askThread.map(askMsgHTML).join("")
    : `<div class="chat-empty">
        <div class="ask-hi">Ask anything across your ${n} note${n === 1 ? "" : "s"}.<br>I'll answer from them and show which note each part came from.</div>
        <div class="ask-suggest">${ASK_SUGGESTIONS.map((s) => `<button class="ask-sugg" type="button">${escapeHtml(s)}</button>`).join("")}</div>
      </div>`;
  return `<div class="page-head">
      <div style="display:flex;align-items:center;gap:8px">
        <button class="btn btn-icon btn-ghost" id="ask-back" aria-label="Back">←</button>
        <div>
          <h1>Ask your notes</h1>
          <p>Answered from all ${n} of your note${n === 1 ? "" : "s"}, with sources.</p>
        </div>
      </div>
      ${askThread.length ? `<button class="btn btn-ghost" id="ask-clear">Clear</button>` : ""}
    </div>
    <div class="chat ask-chat">
      <div class="chat-scroll" id="ask-scroll">${body}</div>
      <form class="chat-form" id="ask-form">
        <input class="input" id="ask-input" placeholder="Ask across all your notes…" autocomplete="off" />
        <button class="btn btn-primary" type="submit" aria-label="Send">↑</button>
      </form>
    </div>`;
}

function wireAsk() {
  const back = $("#ask-back"); if (back) back.onclick = goLibrary;
  const clear = $("#ask-clear"); if (clear) clear.onclick = () => { askThread = []; renderView(); };
  const scroll = $("#ask-scroll");
  if (scroll) {
    scroll.scrollTop = scroll.scrollHeight;
    scroll.onclick = (e) => { const b = e.target.closest(".cite,.cite-src"); if (b && b.dataset.note) openNote(b.dataset.note); };
  }
  $$(".ask-sugg").forEach((b) => (b.onclick = () => { const inp = $("#ask-input"); if (inp) inp.value = b.textContent; submitAsk(); }));
  const form = $("#ask-form"); if (form) form.onsubmit = (e) => { e.preventDefault(); submitAsk(); };
  const inp = $("#ask-input"); if (inp) inp.focus();
}

async function submitAsk() {
  const input = $("#ask-input");
  if (!input) return;
  const q = input.value.trim();
  if (!q) return;
  const scroll = $("#ask-scroll");
  if (!scroll) return;
  input.value = "";
  const firstTurn = askThread.length === 0;
  if (firstTurn) scroll.innerHTML = ""; // drop the empty-state / suggestions
  const userMsg = { role: "user", content: q };
  askThread.push(userMsg);
  scroll.insertAdjacentHTML("beforeend", askMsgHTML(userMsg));
  scroll.insertAdjacentHTML("beforeend", `<div class="msg assistant" id="ask-pending"><div class="spinner"></div><span class="ask-pending-label">Searching your notes…</span></div>`);
  scroll.scrollTop = scroll.scrollHeight;
  if (firstTurn) ensureAskClearBtn();
  try {
    const corpus = await loadAskCorpus();
    if (!corpus.length) throw new Error("None of your notes have content to search yet.");
    const picked = rankNotes(corpus, q, 5);
    const sources = picked.map((it, i) => ({ n: i + 1, id: it.id, title: it.title, text: it.text }));
    const context = buildAskContext(sources);
    const history = askThread.slice(0, -1).slice(-8).map((m) => ({ role: m.role, content: String(m.content).replace(/\[(\d+)\]/g, "") }));
    const answer = await aiGenerate("ask", { context, history, question: q });
    $("#ask-pending")?.remove();
    const msg = { role: "assistant", content: answer, sources: sources.map(({ n, id, title }) => ({ n, id, title })) };
    askThread.push(msg);
    const sc = $("#ask-scroll");
    if (sc) { sc.insertAdjacentHTML("beforeend", askMsgHTML(msg)); sc.scrollTop = sc.scrollHeight; }
  } catch (err) {
    $("#ask-pending")?.remove();
    toast(err.message, "error");
  }
}

// Reveal the header "Clear" button once a conversation has started (the header
// isn't re-rendered mid-thread, so add it in place the first time).
function ensureAskClearBtn() {
  if ($("#ask-clear")) return;
  const h = $(".page-head");
  if (!h) return;
  h.insertAdjacentHTML("beforeend", `<button class="btn btn-ghost" id="ask-clear">Clear</button>`);
  const c = $("#ask-clear"); if (c) c.onclick = () => { askThread = []; renderView(); };
}

function goAsk() { state.view = "ask"; renderView(); }

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
// downloadJSON → utils.js

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
  state.ytManual = ""; state.ytStatus = ""; state.images = []; state.files = [];
  renderView();
}
async function goLibrary() {
  stopRecognition();
  stopSpeech();
  state.view = "library";
  state.notes = null;
  state.selectMode = false; state.selected = new Set();
  state.subjectFilter = "";
  render();
  try {
    state.notes = await listNotes();
    renderView();
    if (state.notes.length >= 1) celebrate("first-note");
    if (state.notes.length >= 10) celebrate("ten-notes");
    if (state.streakGained) {
      state.streakGained = false;
      award(15);
      if (state.streak >= 3) celebrate("streak-3");
      if (state.streak >= 7) celebrate("streak-7");
      toast(`🔥 ${state.streak}-day streak — +15 XP`, "success");
    }
  } catch (err) { toast(err.message, "error"); state.notes = []; renderView(); }
}

// ═════════════════════════════════════════════════════════════════════════════
//  BOOTSTRAP
// ═════════════════════════════════════════════════════════════════════════════
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; });

if ("serviceWorker" in navigator) {
  // When a new version takes over, reload once so the user always gets the latest.
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

// Warm up TTS voices (some browsers load them asynchronously).
if (window.speechSynthesis) {
  try {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.getVoices();
      // Voices often load a moment late — refresh the podcast picker once they do.
      if (state.view === "note" && state.noteTab === "podcast" && !ttsState.playing) renderNotePanel();
    };
  } catch {}
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

// ── Select-to-explain: highlight text in a note to get a deeper explanation ──
let explainPill = null;
function hideExplainPill() { if (explainPill) { explainPill.remove(); explainPill = null; } }
function setupSelectExplain() {
  const onSelect = () => {
    if (state.view !== "note") { hideExplainPill(); return; }
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : "";
    const panel = document.getElementById("note-panel");
    if (!text || text.length < 8 || !panel || !sel.rangeCount || !panel.contains(sel.anchorNode)) { hideExplainPill(); return; }
    let rect;
    try { rect = sel.getRangeAt(0).getBoundingClientRect(); } catch { return; }
    if (!rect || (!rect.width && !rect.height)) return;
    hideExplainPill();
    const snippet = text.slice(0, 600);
    const b = document.createElement("button");
    b.className = "explain-pill";
    b.textContent = "💡 Explain";
    b.style.left = Math.max(10, Math.min(window.innerWidth - 110, rect.left + rect.width / 2)) + "px";
    b.style.top = Math.max(8, rect.top - 44) + "px";
    b.addEventListener("mousedown", (e) => e.preventDefault()); // don't drop the selection
    b.onclick = () => {
      hideExplainPill();
      openExplainer({
        heading: "Explain this",
        seedQuestion: `Explain this in more detail so a student really understands it. Use the study notes for context:\n\n"${snippet}"`,
        seedLabel: snippet.length > 120 ? snippet.slice(0, 120) + "…" : snippet,
      });
      try { window.getSelection().removeAllRanges(); } catch {}
    };
    document.body.appendChild(b);
    explainPill = b;
  };
  document.addEventListener("mouseup", () => setTimeout(onSelect, 10));
  document.addEventListener("touchend", () => setTimeout(onSelect, 10));
  document.addEventListener("scroll", hideExplainPill, true);
  document.addEventListener("mousedown", (e) => { if (explainPill && e.target !== explainPill) hideExplainPill(); });
}
setupSelectExplain();

async function boot() {
  const s = updateStreak();
  state.streak = s.streak;
  state.streakGained = s.gained;
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
