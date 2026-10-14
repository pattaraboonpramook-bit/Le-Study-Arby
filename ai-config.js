// ai-config.js — Recall AI settings (Google Gemini, free tier)
// ─────────────────────────────────────────────────────────────────────────────
// Your Gemini key is NOT stored in the code. You paste it into the app itself
// (the first time you use an AI feature, or from the account menu), and it's
// saved privately in your browser — so it never goes into the repo or the
// deployed page, and can't be scraped by other visitors.
//
// Get a free key at: https://aistudio.google.com/apikey  (Create API key)
// ─────────────────────────────────────────────────────────────────────────────

// Primary model. The "…-latest" aliases (flash-latest / flash-lite-latest) are
// heavily rate-limited on the free tier right now — they frequently return 503
// "high demand" or stall for 20s+. The concrete "gemini-3.5-flash" version has
// far more free-tier headroom and responds reliably, so it's the primary.
// ai.js falls back through a chain (incl. the aliases) automatically if it's busy.
export const GEMINI_MODEL = "gemini-3.5-flash";
