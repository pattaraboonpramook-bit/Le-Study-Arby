# ✺ Recall — AI Study Notes

Turn any lecture, pasted text, or YouTube transcript into clean study **notes**, **flashcards**, and **quizzes** — then **chat** with your material. Installable as an app (PWA).

**Pure static site** — same shape as MedPath/LexPath: just HTML/CSS/JS, no build, no server. Deploy it the exact same way you deploy the other apps.

---

## The one thing you must do: add your (free) Gemini key

The other apps (Doctor, Lawyer) don't use a key because they don't use real AI. Recall does — it calls **Google Gemini**. Gemini has a **free tier** (no credit card).

1. Get a free key at **[aistudio.google.com/apikey](https://aistudio.google.com/apikey)** → **Create API key**. (New keys start with `AQ.`; older ones `AIza`.)
2. Open the app. The first time you press an AI button — or via the account menu (top-right ✺) → **Add Gemini key** — it asks for the key. Paste it.

That's it. Your key is saved **only in your browser** — never in the code, the repo, or the deployed page, so other visitors can't see it. Each device/browser you use enters it once.

---

## Deploy

Exactly like your other apps — it's a static site:

- **Vercel:** import the `Recall` folder (or run `vercel`). No environment variables, no build settings. `vercel.json` already sets a static build.
- Or drag the folder into any static host (Netlify, GitHub Pages, etc.).

Open the URL and go. On the deployed HTTPS URL, recording and "Install app" work too.

---

## Features

- 🎙 **Record & transcribe** a lecture live (Web Speech API — Chrome/Edge; works on the deployed HTTPS site or `localhost`).
- 📄 **Paste** any text → notes.
- ▶ **YouTube → lesson** — paste a link and Gemini **watches the video** (audio + visuals) to build a structured lesson. (Very long videos can exceed the free tier; if so, paste the transcript as a fallback — video **⋯ → Show transcript**.)
- ✺ **Turbo notes**, 🎴 **flashcards**, ❓ **quizzes**, 💬 **chat with your notes**.
- 📱 Installable PWA, light/dark themes.

## Storage

- **Local by default** — notes save in your browser, zero setup.
- **Optional cloud sync** — add your Supabase URL + anon key in [supabase.js](supabase.js) and run [supabase/schema.sql](supabase/schema.sql). Then notes sync across devices with accounts. (Same pattern the other apps use for Supabase.)

---

## Trying it locally

Because it uses ES modules and calls the Anthropic API, open it through a tiny static server rather than `file://` (any will do), e.g. from the `Recall` folder:

```powershell
npx serve .      # then open the printed http://localhost:... URL
```

Recording, install, and the AI calls all work from `localhost` and from your deployed HTTPS URL.

---

## Project structure

| Path | Purpose |
|------|---------|
| `index.html` | App shell |
| `app.js` | The whole app: auth, capture, notes/flashcards/quiz/chat |
| `ai.js` | Calls Google Gemini directly from the browser |
| `ai-config.js` | Gemini model name (your key is entered in-app, not here) |
| `store.js` / `local.js` | Data facade — local (browser) or Supabase backend |
| `supabase.js` | Optional cloud sync (add keys) |
| `supabase/schema.sql` | Tables + row-level security (only if you use Supabase) |
| `styles.css` | Theme + components (light/dark) |
| `manifest.webmanifest`, `sw.js`, `icons/` | PWA install + offline |
| `vercel.json` | Static-build config |
