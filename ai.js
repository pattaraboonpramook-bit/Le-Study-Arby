// ai.js — client-side AI calls via Google Gemini (free tier).
// Calls the Gemini API directly from the browser using the key in ai-config.js.
// Tasks: notes | lesson | flashcards | quiz | chat
import { GEMINI_MODEL } from "./ai-config.js";

const MAX_SOURCE = 600_000;

// ── API key — stored privately in this browser (never in the code/repo) ──────
const KEY_LS = "recall_gemini_key";
export function getGeminiKey() {
  try { return (localStorage.getItem(KEY_LS) || "").trim(); } catch { return ""; }
}
export function setGeminiKey(k) {
  try { localStorage.setItem(KEY_LS, (k || "").trim()); } catch {}
}
export function hasGeminiKey() {
  return getGeminiKey().length > 20;
}

// ── Output language (stored per-device; "auto" = match the source) ───────────
const LANG_LS = "recall_lang";
export function getLang() { try { return localStorage.getItem(LANG_LS) || "auto"; } catch { return "auto"; } }
export function setLang(v) { try { localStorage.setItem(LANG_LS, v || "auto"); } catch {} }

// Append a language directive to the request's system instruction, when set.
function applyLanguage(body) {
  const lang = getLang();
  if (!lang || lang === "auto") return;
  const dir = `\n\nLANGUAGE REQUIREMENT: Write your entire response in ${lang}. If the output is JSON, keep the JSON keys and structure exactly as specified (in English) but write every human-readable text value in ${lang}.`;
  if (body.system_instruction && body.system_instruction.parts && body.system_instruction.parts[0]) {
    body.system_instruction.parts[0].text += dir;
  } else {
    body.system_instruction = { parts: [{ text: dir.trim() }] };
  }
}

const NOTES_SYSTEM = `You are an expert study-notes creator for students. Turn the raw material the student gives you — a lecture transcript, pasted text, or messy notes — into clean, faithful, well-structured study notes in GitHub-flavoured Markdown.

Rules:
- Start with a single short title line: "# <Title>".
- Organise the content under clear "## " section headings, in the order the material presents it.
- Use concise bullet points. Bold the **key terms** and give a short definition inline.
- Preserve important formulas, dates, names, and examples exactly as given.
- Never invent facts that aren't supported by the source. If the source is thin or unclear, say so briefly rather than padding.
- End with a "## Key Takeaways" section: 3–6 bullet points a student should remember.
Output only the Markdown notes — no preamble, no sign-off.`;

const LESSON_SYSTEM = `You are an expert teacher. You are given the transcript of a video (often auto-captioned, so it may be messy or lack punctuation). Turn it into a structured, self-contained lesson in GitHub-flavoured Markdown that a student could learn from without watching the video.

Rules:
- Start with "# <Lesson Title>".
- Add a short "## Overview" (2–3 sentences) framing what this lesson teaches.
- Teach the material in "## " sections with real explanations in full sentences — don't just list bullet fragments; explain concepts so they make sense.
- Bold **key terms** and define them. Include any worked examples or steps the video covers.
- Add a "## Key Terms" glossary if there are several important terms.
- End with "## What to Remember": the 3–6 most important points.
- Clean up transcription noise and fix obvious caption errors, but stay faithful to the actual content. Do not invent facts.
Output only the Markdown lesson.`;

const FLASHCARDS_SYSTEM = `You create study flashcards from the student's material.
Return ONLY a JSON array of objects shaped exactly:
{"front": "a specific question or term", "back": "a concise answer or definition"}
Cover the most important, testable ideas. Fronts must be answerable from the material; backs should be short and precise. The exact number of cards and the required difficulty level are specified below — follow them precisely.`;

const QUIZ_SYSTEM = `You create a multiple-choice quiz from the student's material.
Return ONLY a JSON array of objects shaped exactly:
{"question": "string", "options": ["a","b","c","d"], "answer": 0, "explanation": "why the correct option is right"}
Rules: exactly 4 options per question; "answer" is the 0-based index of the correct option; base every question strictly on the provided material. The exact number of questions and the required difficulty level are specified below — follow them precisely.`;

const CHAT_SYSTEM = `You are a friendly, sharp study tutor. Answer the student's questions using their study notes below as your primary source. Be clear and concise, use short examples where they help, and format with Markdown when useful. If the notes don't cover something, say so briefly and then give your best general explanation. Don't make up specifics that would appear in their course if they aren't in the notes.`;

const PODCAST_SYSTEM = `You write a warm, natural two-host study podcast (an "audio overview") that sounds like two real people actually talking — not a script being read aloud. Two hosts — A (Alex) and B (Sam) — walk through the student's material together in a friendly, curious way that helps them understand and remember it.
Return ONLY a JSON array of turns that alternate speakers, shaped exactly:
[{"speaker":"A","text":"..."},{"speaker":"B","text":"..."}]
Make it sound genuinely human:
- Real back-and-forth: the hosts react to each other ("Right —", "Oh, that's the important bit", "Wait, so…"), ask each other questions, finish thoughts, and add the occasional light, tasteful quip.
- Natural speech: use contractions and everyday phrasing, and vary the rhythm — mix short punchy lines with a couple of longer ones. Never write stage directions, sound effects, markdown, or the speaker's name inside the text.
- Teach, don't recite: drop in quick analogies and concrete examples so the ideas actually land.
Rules: base everything strictly on the provided material (don't invent facts); each turn is 1–3 sentences of spoken language; open with a quick hook and end with a one-line recap of what to remember.`;

const FEYNMAN_SYSTEM = `You are a supportive but rigorous tutor using the Feynman technique. A student has tried to explain a topic in their own words. Compare their explanation to the REFERENCE NOTES and judge how well they actually understand it.
Return ONLY a JSON object (no prose, no code fences):
{"score": <integer 0-100, overall understanding>, "nailed": [<up to 5 short strings: things they explained correctly>], "gaps": [<up to 5 short strings: important points they missed or were too vague on>], "misconceptions": [<up to 3 short strings: things they stated incorrectly; empty array if none>], "tip": "<one specific, encouraging sentence on what to review or do next>"}
Be fair: reward correct understanding even when worded differently or informally, and don't penalize missing minor trivia. Judge only against the reference notes.`;

const ADVANCED_SYSTEM = `You produce an ADVANCED study breakdown of the student's material, in two complementary parts.
Return ONLY a JSON object shaped exactly:
{
  "mainPoints": [ {"point": "a concise headline naming one of the MOST significant points — a pivotal event, decision, cause, turning point, or strategy that mattered or worked greatly", "simple": "explain that point in plain, beginner-friendly language in 1-2 sentences"} ],
  "deepDive": "a meticulous, precise analysis in GitHub-flavoured Markdown"
}
Rules for "mainPoints" (the SIMPLE layer): select the 4-8 most important or significant items — key events, actions, decisions, or plans — and order them logically; the "point" is a short, punchy headline, and "simple" explains it plainly and comprehensibly, as if to someone brand new to the subject. Keep this layer genuinely easy to understand.
Rules for "deepDive" (the ADVANCED layer): elaborate with meticulous, precise detail and sophisticated but exact terminology (briefly defining specialised terms); illuminate underlying mechanisms, tensions, and consequences, and articulate *why* each element matters. Be thorough yet economical — dense and exact, no filler. Go deeper than the surface notes, yet never fabricate facts beyond the provided material. Use "## " headings and tight paragraphs.
Output only the JSON object.`;

const TASKS = {
  notes:      { system: NOTES_SYSTEM,      max_tokens: 8000, json: false },
  image:      { system: NOTES_SYSTEM,      max_tokens: 8000, json: false },
  translate:  { system: "",                max_tokens: 8000, json: false },
  advanced:   { system: ADVANCED_SYSTEM,   max_tokens: 6000, json: true },
  lesson:     { system: LESSON_SYSTEM,     max_tokens: 8000, json: false },
  video:      { system: LESSON_SYSTEM,     max_tokens: 8000, json: false },
  flashcards: { system: FLASHCARDS_SYSTEM, max_tokens: 6000, json: true },
  quiz:       { system: QUIZ_SYSTEM,       max_tokens: 8000, json: true },
  chat:       { system: CHAT_SYSTEM,       max_tokens: 4000, json: false },
  feynman:    { system: FEYNMAN_SYSTEM,    max_tokens: 2000, json: true },
  podcast:    { system: PODCAST_SYSTEM,    max_tokens: 8000, json: true },
};

function extractJson(text) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.search(/[[{]/);
  const end = Math.max(t.lastIndexOf("]"), t.lastIndexOf("}"));
  if (start === -1 || end === -1 || end < start) throw new Error("No JSON found");
  return JSON.parse(t.slice(start, end + 1));
}

function endpoint(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(getGeminiKey())}`;
}

// Try the configured model first, then fall back to others if it's overloaded.
// Order: two reliable concrete models, then the (often-saturated) "latest" aliases
// as a last resort in case demand shifts.
const MODEL_CHAIN = [...new Set([GEMINI_MODEL, "gemini-3.5-flash", "gemini-3.6-flash", "gemini-flash-latest", "gemini-flash-lite-latest"])];

// Normalize any YouTube URL to the clean form Gemini accepts. Extra params like
// &t= (timestamp) or &list= (playlist) make Gemini reject the request, and they
// get added automatically when you copy a link from a playlist or at a timestamp.
function canonicalYouTube(url) {
  const s = String(url || "").trim();
  const id =
    (s.match(/[?&]v=([a-zA-Z0-9_-]{11})/) || [])[1] ||
    (s.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/) || [])[1] ||
    (s.match(/\/(?:embed|shorts|live|v)\/([a-zA-Z0-9_-]{11})/) || [])[1] ||
    (s.match(/^([a-zA-Z0-9_-]{11})$/) || [])[1];
  return id ? `https://www.youtube.com/watch?v=${id}` : s;
}

// Concrete, prescriptive difficulty rubric. This is deliberately strong and
// specific — vague directives produce levels that all feel the same.
function difficultyDirective(task, d) {
  const quiz = task === "quiz";
  if (d === "Easy") {
    return quiz
      ? `\n\nDIFFICULTY — EASY (this is the single most important constraint). Every question must test simple, direct recall of a fact, definition, or term stated explicitly in the material; the correct answer should be findable almost word-for-word in the source. Use one-step "What is…/Which of these is…" questions. Make the three wrong options clearly and obviously incorrect, so a student who read the material once can rule them out. Do NOT require reasoning, application, or combining ideas.`
      : `\n\nDIFFICULTY — EASY (this is the single most important constraint). Each card is a basic term-and-definition or a simple fact stated directly in the material (e.g. "What is X?" → a short definition). Keep fronts short and answerable from memory after a single read. No application, no multi-step reasoning.`;
  }
  if (d === "Hard") {
    return quiz
      ? `\n\nDIFFICULTY — HARD (this is the single most important constraint). Every question must demand real reasoning: applying concepts to new situations, multi-step thinking, analysing subtle distinctions, or spotting edge cases and common misconceptions. The three wrong options must be genuinely tempting traps that reflect typical student mistakes, so only someone with deep understanding can eliminate them. Do NOT ask anything answerable by simple recall or by matching words from the text.`
      : `\n\nDIFFICULTY — HARD (this is the single most important constraint). Each card must probe deep understanding: explain a mechanism, apply a concept to a scenario, compare/contrast nuanced cases, or reason through "why does X lead to Y". Fronts must demand genuine understanding and synthesis — never simple term-matching or verbatim recall.`;
  }
  return quiz
    ? `\n\nDIFFICULTY — MEDIUM (this is the single most important constraint). Each question should require understanding a concept and applying or connecting it — "why", "how", "what happens if", or relating two ideas — not pure verbatim recall. The wrong options should be plausible but distinguishable by a student who genuinely understands the material. Avoid both word-for-word recall and obscure trick questions.`
    : `\n\nDIFFICULTY — MEDIUM (this is the single most important constraint). Cards should go beyond definitions to how and why — relationships, causes and effects, comparisons, or short applications. The student should need to understand the concept, not just recognise a term.`;
}

// How many items to produce (flashcards / quiz questions).
function countDirective(task, n) {
  const c = Math.max(3, Math.min(40, parseInt(n, 10) || 0));
  if (!c) return "";
  if (task === "quiz") return `\n\nCOUNT: Create exactly ${c} questions — no more, no fewer.`;
  return `\n\nCOUNT: Create exactly ${c} flashcards — no more, no fewer.`;
}

// Roughly how long the spoken podcast should run (in minutes).
function podcastLengthDirective(minutes) {
  const m = Math.max(1, Math.min(15, parseInt(minutes, 10) || 0));
  if (!m) return "";
  const turns = Math.max(6, Math.min(48, Math.round(m * 4.5)));
  return `\n\nTARGET LENGTH: Aim for roughly ${m} minute${m === 1 ? "" : "s"} of spoken audio — about ${turns} turns in total. Match the depth to the time: for a longer target go further with examples, analogies, and back-and-forth; for a short one keep it tight and cover only the essentials.`;
}

function buildBody(task, payload, cfg) {
  const generationConfig = { maxOutputTokens: cfg.max_tokens, temperature: 0.7 };
  if (cfg.json) generationConfig.responseMimeType = "application/json";

  if (task === "video") {
    // Gemini watches the YouTube video directly (audio + visuals).
    return {
      system_instruction: { parts: [{ text: cfg.system }] },
      contents: [{ role: "user", parts: [
        { file_data: { file_uri: canonicalYouTube(payload?.videoUrl) } },
        { text: "Turn this video into a structured lesson, following the system instructions exactly." },
      ] }],
      generationConfig,
    };
  }

  if (task === "translate") {
    const lang = String(payload?.lang || "English");
    const source = String(payload?.source || "").slice(0, MAX_SOURCE);
    const sys = `You are an expert translator. Translate the user's study notes into ${lang}. Preserve ALL Markdown formatting exactly (the same headings, bold, bullet/numbered lists, blockquotes, code blocks). Translate only the human-readable text; leave numbers, formulas, code, and URLs unchanged. Do not add any commentary or notes of your own. Output only the translated Markdown.`;
    return { system_instruction: { parts: [{ text: sys }] }, contents: [{ role: "user", parts: [{ text: source }] }], generationConfig };
  }

  if (task === "image") {
    // Gemini reads photos/scans of study material (textbook pages, slides, handwriting, diagrams).
    const images = Array.isArray(payload?.images) ? payload.images : [];
    const parts = images.slice(0, 10).map((img) => ({ inline_data: { mime_type: img.mime || "image/jpeg", data: img.data } }));
    parts.push({ text: "These images are photos or scans of study material — textbook pages, slides, handwritten notes, or diagrams. Read ALL of them carefully: transcribe the text accurately, describe any important diagrams or figures, and turn everything into clean, organised study notes following the system instructions." });
    return { system_instruction: { parts: [{ text: cfg.system }] }, contents: [{ role: "user", parts }], generationConfig };
  }

  if (task === "feynman") {
    const context = String(payload?.context || "").slice(0, MAX_SOURCE);
    const explanation = String(payload?.explanation || "").trim();
    return {
      system_instruction: { parts: [{ text: `${cfg.system}\n\nREFERENCE NOTES:\n\n${context}` }] },
      contents: [{ role: "user", parts: [{ text: `MY EXPLANATION:\n\n${explanation}` }] }],
      generationConfig,
    };
  }

  if (task === "chat") {
    const context = String(payload?.context || "").slice(0, MAX_SOURCE);
    const history = Array.isArray(payload?.history) ? payload.history : [];
    const question = String(payload?.question || "").trim();
    return {
      system_instruction: { parts: [{ text: `${cfg.system}\n\nSTUDY NOTES:\n\n${context}` }] },
      contents: [
        ...history
          .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
          .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content) }] })),
        { role: "user", parts: [{ text: question }] },
      ],
      generationConfig,
    };
  }

  const source = String(payload?.source || "").slice(0, MAX_SOURCE);
  const label = task === "lesson" ? "VIDEO TRANSCRIPT" : "SOURCE MATERIAL";
  let sys = cfg.system;
  if (task === "flashcards" || task === "quiz") {
    if (payload?.difficulty) sys += difficultyDirective(task, payload.difficulty);
    if (payload?.count) sys += countDirective(task, payload.count);
  }
  if (task === "podcast" && payload?.minutes) sys += podcastLengthDirective(payload.minutes);
  return {
    system_instruction: { parts: [{ text: sys }] },
    contents: [{ role: "user", parts: [{ text: `${label}:\n\n${source}` }] }],
    generationConfig,
  };
}

function mapError(status, msg) {
  if (/API key not valid|API_KEY_INVALID|invalid.*key/i.test(msg)) return "Your Gemini API key is invalid — add a valid one.";
  if (status === 429) return "Gemini's free tier is busy right now — wait a minute and try again.";
  if (status === 403) return "Gemini denied the request — the key may be restricted, or the API isn't enabled for it.";
  if (status === 503 || /overloaded|unavailable/i.test(msg)) return "Gemini is overloaded right now (free tier). Give it a moment and try again.";
  if (status >= 500) return "Gemini had a server error — please try again.";
  return msg || `Request failed (${status}).`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Transient statuses worth retrying (overload, rate-limit, gateway, timeout, network=0).
const RETRYABLE = new Set([0, 408, 429, 500, 502, 503, 504]);

// Per-task call tuning. Text tasks should fail fast (45s) so a stalled request
// doesn't freeze the app. But "video" means Gemini actually WATCHES a YouTube
// video, which legitimately takes much longer — a short timeout there would
// abort valid work and retry forever, so it gets a long timeout and few retries.
function tuneCall(task) {
  if (task === "video") {
    return { timeoutMs: 180_000, attemptsPrimary: 1, attemptsFallback: 1, maxModels: 3 };
  }
  return { timeoutMs: 45_000, attemptsPrimary: 4, attemptsFallback: 2, maxModels: MODEL_CHAIN.length };
}

// Optional progress hook so the UI can say "still working, Gemini's busy" instead
// of looking frozen while we ride out an overload.
let aiStatusCb = null;
export function onAiStatus(cb) { aiStatusCb = typeof cb === "function" ? cb : null; }
function status(msg) { try { aiStatusCb && aiStatusCb(msg); } catch {} }

// A model the current key can't use (retired/renamed) — skip to the next one
// rather than failing the whole request.
function isModelUnavailable(status, msg) {
  return status === 404 || /not found|not available|does not exist|is not supported|unsupported/i.test(msg || "");
}

// A single request to one model, with a hard timeout.
async function callOnce(model, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(endpoint(model), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    const timedOut = err && err.name === "AbortError";
    const e = new Error(timedOut
      ? "Gemini is slow right now — retrying…"
      : "Couldn't reach Google — check your internet connection.");
    e.status = 0;
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => null);
  if (res.ok) return data;
  const raw = data?.error?.message || "";
  const e = new Error(mapError(res.status, raw));
  e.status = res.status;
  e.raw = raw;
  // A per-DAY free-tier quota won't recover in seconds, so flag it to skip the
  // model immediately (each model has its own daily bucket) rather than retrying.
  const viol = (data?.error?.details || []).flatMap((d) => d.violations || []);
  e.perDay = viol.some((v) => /PerDay/i.test(v.quotaId || "")) || /per day|daily limit/i.test(raw);
  throw e;
}

// One model, retrying transient failures with exponential backoff + jitter.
// Overload on the free tier is usually brief, so riding it out beats failing.
async function tryModel(model, body, maxAttempts, timeoutMs) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await callOnce(model, body, timeoutMs);
    } catch (e) {
      lastErr = e;
      if (e.perDay) throw e;                 // daily cap on this model — retrying won't help
      if (!RETRYABLE.has(e.status)) throw e; // model-unavailable / bad key / safety — caller decides
      if (attempt < maxAttempts - 1) {
        status("Gemini's busy — hang tight, I'm retrying…");
        const backoff = Math.min(6000, 700 * 2 ** attempt) + Math.random() * 400;
        await sleep(backoff);
      }
    }
  }
  throw lastErr;
}

// Call Gemini: hammer the fast, most-available model first (it's the quickest
// path), then fall back through the chain only when it's truly unavailable or
// stays overloaded. Normal requests see zero added delay — backoff only on failure.
async function callGemini(body, tuning) {
  const t = tuning || tuneCall();
  const nModels = Math.min(t.maxModels, MODEL_CHAIN.length);
  let lastErr, anyPerDay = false, anyTimeout = false;
  for (let i = 0; i < nModels; i++) {
    const model = MODEL_CHAIN[i];
    const attempts = i === 0 ? t.attemptsPrimary : t.attemptsFallback;
    try {
      return await tryModel(model, body, attempts, t.timeoutMs);
    } catch (e) {
      lastErr = e;
      if (e.status === 0 && /slow/i.test(e.message)) anyTimeout = true;
      if (e.perDay) { anyPerDay = true; status("That model's daily limit is used up — trying another…"); continue; }
      if (isModelUnavailable(e.status, e.raw)) continue; // try the next model
      if (RETRYABLE.has(e.status)) continue;             // overload exhausted — fall back
      throw e;                                           // real error (bad key, 400, safety)
    }
  }
  if (anyPerDay) {
    const e = new Error("You've hit today's free Gemini limit on every model (the free tier caps requests per day). It resets within a day — or add your own API key, or turn on billing in Google AI Studio for much higher limits.");
    e.status = 429;
    throw e;
  }
  if (anyTimeout) {
    const e = new Error("That took too long to process. If it's a long YouTube video, paste its transcript instead (the box under the link) — it's much faster and handles long videos.");
    e.status = 0;
    throw e;
  }
  throw lastErr;
}

function textFrom(data) {
  const c = data?.candidates?.[0];
  if (!c) {
    const blocked = data?.promptFeedback?.blockReason;
    throw new Error(blocked ? `Gemini blocked this content (${blocked}).` : "Gemini returned no output — try again.");
  }
  if (c.finishReason === "SAFETY") throw new Error("Gemini blocked this response for safety.");
  return (c.content?.parts || []).map((p) => p.text || "").join("").trim();
}

// Public: run an AI task. Returns Markdown text (notes/lesson/chat) or a parsed
// array (flashcards/quiz). Throws Error with a friendly .message on failure.
export async function generate(task, payload) {
  if (!hasGeminiKey()) {
    const e = new Error("No Gemini API key set.");
    e.code = "NO_KEY";
    throw e;
  }
  const cfg = TASKS[task];
  if (!cfg) throw new Error(`Unknown task: ${task}`);

  const body = buildBody(task, payload, cfg);
  if (task !== "translate") applyLanguage(body); // translate carries its own target language
  const data = await callGemini(body, tuneCall(task));
  const text = textFrom(data);

  if (cfg.json) {
    try { return extractJson(text); }
    catch { throw new Error("The model didn't return valid data — try again."); }
  }
  return text;
}
