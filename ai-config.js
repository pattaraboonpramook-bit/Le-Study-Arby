// ai-config.js — Recall AI settings (Google Gemini, free tier)
// ─────────────────────────────────────────────────────────────────────────────
// Your Gemini key is NOT stored in the code. You paste it into the app itself
// (the first time you use an AI feature, or from the account menu), and it's
// saved privately in your browser — so it never goes into the repo or the
// deployed page, and can't be scraped by other visitors.
//
// Get a free key at: https://aistudio.google.com/apikey  (Create API key)
// ─────────────────────────────────────────────────────────────────────────────

// Primary model. "flash-lite" has the best free-tier availability (the bigger
// flash models get "high demand" 503s), and it's a stable alias so it won't get
// retired. ai.js also falls back to other models automatically if this one is busy.
export const GEMINI_MODEL = "gemini-flash-lite-latest";
