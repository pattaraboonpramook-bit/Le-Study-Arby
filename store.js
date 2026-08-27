// store.js — data-layer facade.
// Uses Supabase when it's configured (cloud sync), otherwise falls back to the
// local (localStorage) backend so the app runs with zero setup. app.js imports
// only from here, so the rest of the app doesn't care which backend is active.
import { isConfigured } from "./supabase.js";
import * as cloud from "./supabase.js";
import * as local from "./local.js";

export const backend = isConfigured ? "cloud" : "local";
const impl = isConfigured ? cloud : local;

export const getUser = impl.getUser;
export const onAuthChange = impl.onAuthChange;
export const signIn = impl.signIn;
export const signUp = impl.signUp;
export const signOut = impl.signOut;
export const listNotes = impl.listNotes;
export const getNote = impl.getNote;
export const createNote = impl.createNote;
export const updateNote = impl.updateNote;
export const deleteNote = impl.deleteNote;
export const listChat = impl.listChat;
export const addChat = impl.addChat;
export const clearLocalData = local.clearLocalData;
