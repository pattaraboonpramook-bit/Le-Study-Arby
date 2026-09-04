// local.js — offline backend (no Supabase).
// Notes + chat live in localStorage on this device. Same interface as supabase.js
// so the app can run with zero database setup; add Supabase keys later for sync.
const K_NOTES = "recall_notes";
const K_CHAT = (id) => `recall_chat_${id}`;
const LOCAL_USER = { id: "local-user", email: "On this device" };

const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
const readNotes = () => { try { return JSON.parse(localStorage.getItem(K_NOTES) || "[]"); } catch { return []; } };
const writeNotes = (a) => localStorage.setItem(K_NOTES, JSON.stringify(a));

// ── Auth (auto-signed-in locally) ────────────────────────────────────────────
export async function getUser() { return LOCAL_USER; }
export function onAuthChange(cb) { setTimeout(() => cb(LOCAL_USER), 0); }
export async function signIn() { return { user: LOCAL_USER }; }
export async function signUp() { return { user: LOCAL_USER, session: {} }; }
export async function signOut() { /* stay signed in in local mode */ }

// ── Profiles (local mode is single-user: always an approved member) ──────────
export async function getProfile() { return { id: LOCAL_USER.id, email: LOCAL_USER.email, role: "member" }; }
export async function listUsers() { return []; }
export async function setUserRole() {}

// ── Notes ────────────────────────────────────────────────────────────────────
export async function listNotes() {
  return readNotes()
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .map((n) => ({ id: n.id, title: n.title, source_type: n.source_type, updated_at: n.updated_at }));
}
export async function getNote(id) {
  const n = readNotes().find((x) => x.id === id);
  if (!n) throw new Error("Note not found");
  return n;
}
export async function createNote(note) {
  const now = new Date().toISOString();
  const row = { id: uid(), created_at: now, updated_at: now, transcript: "", notes_md: "", flashcards: [], quiz: [], ...note };
  const all = readNotes(); all.push(row); writeNotes(all);
  return row;
}
export async function updateNote(id, patch) {
  const all = readNotes();
  const i = all.findIndex((x) => x.id === id);
  if (i < 0) throw new Error("Note not found");
  all[i] = { ...all[i], ...patch, updated_at: new Date().toISOString() };
  writeNotes(all);
  return all[i];
}
export async function deleteNote(id) {
  writeNotes(readNotes().filter((x) => x.id !== id));
  localStorage.removeItem(K_CHAT(id));
}

// ── Chat ─────────────────────────────────────────────────────────────────────
export async function listChat(noteId) {
  try { return JSON.parse(localStorage.getItem(K_CHAT(noteId)) || "[]"); } catch { return []; }
}
export async function addChat(noteId, role, content) {
  const arr = await listChat(noteId);
  arr.push({ role, content, created_at: new Date().toISOString() });
  localStorage.setItem(K_CHAT(noteId), JSON.stringify(arr));
}

// Wipe everything stored locally.
export function clearLocalData() {
  localStorage.removeItem(K_NOTES);
  Object.keys(localStorage)
    .filter((k) => k.startsWith("recall_chat_"))
    .forEach((k) => localStorage.removeItem(k));
}
