// supabase.js
// ─────────────────────────────────────────────────────────────────────────────
// Recall — Supabase client + data-access layer.
//
// 1. Create a free project at https://supabase.com
// 2. Run supabase/schema.sql in the SQL editor.
// 3. Paste your project URL and the *anon* public key below.
//    (The anon key is safe to ship in the browser — Row-Level Security in the
//     schema is what actually protects each user's data.)
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "YOUR_SUPABASE_URL";          // e.g. https://abcxyz.supabase.co
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY"; // the long "anon public" key

export const isConfigured =
  !SUPABASE_URL.includes("YOUR_") && !SUPABASE_ANON_KEY.includes("YOUR_");

export const supabase = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// ── Auth ─────────────────────────────────────────────────────────────────────
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getUser() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

export function onAuthChange(cb) {
  if (!supabase) return;
  supabase.auth.onAuthStateChange((_event, session) => cb(session?.user ?? null));
}

// ── Notes ────────────────────────────────────────────────────────────────────
export async function listNotes() {
  const { data, error } = await supabase
    .from("notes")
    .select("id, title, source_type, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getNote(id) {
  const { data, error } = await supabase.from("notes").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function createNote(note) {
  const user = await getUser();
  const row = { ...note, user_id: user.id };
  const { data, error } = await supabase.from("notes").insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function updateNote(id, patch) {
  const { data, error } = await supabase.from("notes").update(patch).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteNote(id) {
  const { error } = await supabase.from("notes").delete().eq("id", id);
  if (error) throw error;
}

// ── Chat ─────────────────────────────────────────────────────────────────────
export async function listChat(noteId) {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("note_id", noteId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function addChat(noteId, role, content) {
  const user = await getUser();
  const { error } = await supabase
    .from("chat_messages")
    .insert({ note_id: noteId, user_id: user.id, role, content });
  if (error) throw error;
}

export async function clearChat(noteId) {
  const { error } = await supabase.from("chat_messages").delete().eq("note_id", noteId);
  if (error) throw error;
}
