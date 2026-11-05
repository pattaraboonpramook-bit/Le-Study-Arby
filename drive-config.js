// drive-config.js — Google Drive Picker credentials.
// These two values are PUBLIC by design (OAuth web client ID + a referrer-
// restricted API key), so it's safe to commit them. Leave them empty to keep
// the "Import from Google Drive" button hidden.
//
// Setup (one time, ~10 min — see the notes the app gave you):
//   1. console.cloud.google.com → create/select a project.
//   2. APIs & Services → Library → enable "Google Picker API" AND "Google Drive API".
//   3. Credentials → Create credentials → API key  → paste below as GOOGLE_API_KEY.
//      (Restrict it to the Picker API + your site's HTTP referrers.)
//   4. Credentials → Create credentials → OAuth client ID → Web application.
//      Authorized JavaScript origins: http://localhost:<your-port> and
//      https://le-study-arby.vercel.app  → paste the client ID below.
//   5. OAuth consent screen → External; add the scope .../auth/drive.file;
//      add your classmates as test users (or Publish — drive.file needs no review).
export const GOOGLE_CLIENT_ID = ""; // e.g. "1234-abc.apps.googleusercontent.com"
export const GOOGLE_API_KEY = "";   // e.g. "AIza..."
