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
- 🧑‍🏫 **Teach-back (Feynman mode)** — explain a topic in your own words (type or **speak** it) and get graded on your *actual understanding*: a mastery score, what you nailed, your gaps, and misconceptions. Most study apps generate content *for* you — this makes you recall it, which is what makes it stick.
- 🎙️ **Podcast mode** — turns a note into a fun two-host "audio overview" and reads it aloud (browser text-to-speech, two voices, current line highlighted) so you can study hands-free. Free — no audio API.
- 🧠 **Advanced** & 📌 **Main Points** — two tabs from one analysis: **Advanced** is a meticulous, sophisticated elaboration of the material; **Main Points** distils the significant events, actions, and plans into simple, easy takeaways.
- 📱 Installable PWA, light/dark themes.

## Storage

- **Local by default** — notes save in your browser, zero setup, no accounts. (No access control — anyone who opens the page can use it with their own key.)
- **Cloud + access control** — configure Supabase (below) to get real accounts, an admin approval list, and cross-device sync.
- **Your data survives app updates** — redeploying only replaces the code, never the saved data (browser storage in local mode; the Supabase database in cloud mode).
- **Backup / restore** — the account menu (top-right ✺) has **Back up my notes** (downloads a JSON file) and **Restore from backup**, so an individual's notes are never truly lost, even if they clear their browser or move to a new device.

---

## 🔒 Access control (who can use the app)

> **Important:** a static site *cannot* enforce security in the browser — anyone can read the code and bypass a client-side check. Real access control needs a server that enforces the rules. This app uses **Supabase Row-Level Security (RLS)** for that, so the rules hold even though the front-end is static.

**How it works:** people sign up → they land as **`pending`** and can do *nothing* (the database itself refuses to give them any data) → an **admin** approves them in the **Admin panel** → they become a **`member`**. Admins can **block** (revoke) anyone or **promote** trusted people to admin. Roles are checked by Postgres RLS on every request, so this can't be bypassed from the browser.

**Set it up:**
1. Create a free project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query →** paste [supabase/schema.sql](supabase/schema.sql) → **Run**.
3. **Settings → API →** copy your **Project URL** + **anon public** key into [supabase.js](supabase.js).
4. **Authentication → Providers → Email →** turn **ON** "Confirm email" (stops people signing up with fake addresses).
5. **Sign up in the app with *your* email first.** Then in the SQL editor run — with your email — the last line of `schema.sql`:
   ```sql
   update public.profiles set role = 'admin' where email = 'YOU@EXAMPLE.COM';
   ```
   Reload — you're now the admin, and the **🛡 Admin panel** appears in your account menu.
6. Everyone else who signs up shows up as **pending** for you to approve (or reject/block).

**Given you don't fully trust this person, some plain advice:**
- **Stay the only admin.** Never press "Make admin" for someone you don't trust — admins can approve/remove *other* users.
- **Approve, don't pre-share.** Let them sign up, then approve just their account. Block them instantly if needed — it takes effect on their next request.
- **Make the GitHub repo private** if you don't want them to have the source code. (Repo → Settings → Change visibility → Private. Vercel still deploys from a private repo.)
- **Their data is isolated** — RLS means each user only ever sees their *own* notes; one user can't read another's.
- **Never share your Supabase *service_role* key** (Settings → API). Only the **anon** key goes in the app; the service_role key bypasses all security — keep it secret.
- The **Gemini key is per-person** — each user enters their own in their own browser, so no one can spend your quota.

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
