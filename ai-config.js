// ai-config.js — Recall AI settings (Google Gemini, free tier)
// ─────────────────────────────────────────────────────────────────────────────
// Paste your free Gemini API key below.
//   Get it at: https://aistudio.google.com/apikey  (Create API key → copy)
//   The key starts with "AIza...". No credit card needed for the free tier.
//
// ⚠ This is a static site, so the key ships inside the page and is visible to
// anyone who opens your deployed URL. With a FREE key that's low-stakes — worst
// case someone uses up your free quota. If that happens, delete the key in AI
// Studio and paste a new one here.
//
// Privacy note: Google's free tier may use your inputs to improve their models.
// Fine for lecture notes; just so you know.
// ─────────────────────────────────────────────────────────────────────────────

export const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY";

// Free, fast model. You can change this to another Gemini "flash" model later.
export const GEMINI_MODEL = "gemini-2.0-flash";

export const isAIConfigured = GEMINI_API_KEY.startsWith("AIza");
