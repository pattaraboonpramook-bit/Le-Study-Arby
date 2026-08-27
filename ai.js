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
Make 8–15 cards covering the most important, testable ideas. Fronts should be answerable from the material; backs should be short and precise.`;

const QUIZ_SYSTEM = `You create a multiple-choice quiz from the student's material.
Return ONLY a JSON array of objects shaped exactly:
{"question": "string", "options": ["a","b","c","d"], "answer": 0, "explanation": "why the correct option is right"}
Rules: exactly 4 options per question; "answer" is the 0-based index of the correct option; make 5–10 questions that test understanding rather than trivia; base everything on the provided material.`;

const CHAT_SYSTEM = `You are a friendly, sharp study tutor. Answer the student's questions using their study notes below as your primary source. Be clear and concise, use short examples where they help, and format with Markdown when useful. If the notes don't cover something, say so briefly and then give your best general explanation. Don't make up specifics that would appear in their course if they aren't in the notes.`;

const FEYNMAN_SYSTEM = `You are a supportive but rigorous tutor using the Feynman technique. A student has tried to explain a topic in their own words. Compare their explanation to the REFERENCE NOTES and judge how well they actually understand it.
Return ONLY a JSON object (no prose, no code fences):
{"score": <integer 0-100, overall understanding>, "nailed": [<up to 5 short strings: things they explained correctly>], "gaps": [<up to 5 short strings: important points they missed or were too vague on>], "misconceptions": [<up to 3 short strings: things they stated incorrectly; empty array if none>], "tip": "<one specific, encouraging sentence on what to review or do next>"}
Be fair: reward correct understanding even when worded differently or informally, and don't penalize missing minor trivia. Judge only against the reference notes.`;

const TASKS = {
  notes:      { system: NOTES_SYSTEM,      max_tokens: 8000, json: false },
  lesson:     { system: LESSON_SYSTEM,     max_tokens: 8000, json: false },
  video:      { system: LESSON_SYSTEM,     max_tokens: 8000, json: false },
  flashcards: { system: FLASHCARDS_SYSTEM, max_tokens: 4000, json: true },
  quiz:       { system: QUIZ_SYSTEM,       max_tokens: 4000, json: true },
  chat:       { system: CHAT_SYSTEM,       max_tokens: 4000, json: false },
  feynman:    { system: FEYNMAN_SYSTEM,    max_tokens: 2000, json: true },
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

function endpoint() {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(getGeminiKey())}`;
}

function buildBody(task, payload, cfg) {
  const generationConfig = { maxOutputTokens: cfg.max_tokens, temperature: 0.7 };
  if (cfg.json) generationConfig.responseMimeType = "application/json";

  if (task === "video") {
    // Gemini watches the YouTube video directly (audio + visuals).
    return {
      system_instruction: { parts: [{ text: cfg.system }] },
      contents: [{ role: "user", parts: [
        { file_data: { file_uri: String(payload?.videoUrl || "") } },
        { text: "Turn this video into a structured lesson, following the system instructions exactly." },
      ] }],
      generationConfig,
    };
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
  return {
    system_instruction: { parts: [{ text: cfg.system }] },
    contents: [{ role: "user", parts: [{ text: `${label}:\n\n${source}` }] }],
    generationConfig,
  };
}

function mapError(status, msg) {
  if (/API key not valid|API_KEY_INVALID|invalid.*key/i.test(msg)) return "Your Gemini API key is invalid — check ai-config.js.";
  if (status === 429) return "Hit Gemini's free-tier rate limit — wait a minute and try again.";
  if (status === 403) return "Gemini denied the request — the key may be restricted, or the API isn't enabled for it.";
  if (status >= 500) return "Gemini had a server error — please retry.";
  return msg || `Request failed (${status}).`;
}

async function callGemini(body) {
  let res;
  try {
    res = await fetch(endpoint(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach Google — check your internet connection.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = new Error(mapError(res.status, data?.error?.message || ""));
    e.status = res.status;
    throw e;
  }
  return data;
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

  const data = await callGemini(buildBody(task, payload, cfg));
  const text = textFrom(data);

  if (cfg.json) {
    try { return extractJson(text); }
    catch { throw new Error("The model didn't return valid data — try again."); }
  }
  return text;
}
