// ai.js — client-side AI calls via Google Gemini (free tier).
// Calls the Gemini API directly from the browser using the key in ai-config.js.
// Tasks: notes | lesson | flashcards | quiz | chat | quizchat | ask | merge | specialist | document | image
// Field specialties (lens + signature tool) live in FIELDS, applied via payload.field.
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

const QUIZCHAT_SYSTEM = `You are a sharp, encouraging quiz tutor. The student is reviewing a specific multiple-choice quiz built from their study material. Below you are given their study material, the quiz (each question with its options, the correct answer, and an explanation), and which option the student picked for each question (if any).
Help them actually learn: explain why an answer is right or wrong, clear up misconceptions, and connect ideas back to the material. When they ask for more practice, write ADDITIONAL questions in plain readable text (not JSON) — each with its answer and a one-line explanation. Be concise and use Markdown when it helps. Ground everything in the provided material; if something is outside it, give your best general explanation and note that it's beyond their notes. If the student gave a focus or context, weigh it heavily.`;

const MERGE_SYSTEM = `You merge several of the student's study notes into ONE unified, coherent set of study notes. The sources are provided below, each under a "### SOURCE: <title>" heading.
Produce a single, well-organised set of notes in GitHub-flavoured Markdown that:
- Combines everything important from all sources into one logical structure — a unified document, not a list of the separate notes stacked together.
- Merges overlapping or repeated ideas so each concept appears once, in the most sensible place, and groups related material from different sources together.
- Removes redundancy; if two sources conflict, keep the clearest, most complete version.
- Preserves every distinct fact, definition, example, formula, and detail — never drop information that appears in only one source.
- Opens with a single "# " title that reflects the combined topic, then uses "## "/"### " headings, bullet lists, and **bold** for key terms. Preserve any math in LaTeX ($…$).
Base everything strictly on the provided sources; do not invent new facts. Output only the merged Markdown notes.`;

const ASK_SYSTEM = `You are a study assistant answering a student's question using ONLY their own notes, provided below as numbered SOURCES. Each source is one of the student's notes, written as:

[n] "Note title"
<the note's content>

Rules:
- Answer the question directly, clearly, and concisely, in GitHub-flavoured Markdown.
- Base every claim on the sources. Immediately after a statement drawn from a source, cite it inline with its bracketed number, e.g. [1], or [2][3] when several apply.
- Use ONLY information found in the sources. Never add facts, figures, names, or dates that are not there.
- If the sources do not answer the question, say so in one short sentence (for example, "Your notes don't cover this.") and stop — do not guess, and never cite a source you did not actually use.
- When the answer draws on several notes, synthesise across them and cite each one where it contributes.`;

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
  document:   { system: NOTES_SYSTEM,      max_tokens: 8000, json: false },
  translate:  { system: "",                max_tokens: 8000, json: false },
  merge:      { system: MERGE_SYSTEM,      max_tokens: 8000, json: false },
  advanced:   { system: ADVANCED_SYSTEM,   max_tokens: 6000, json: true },
  lesson:     { system: LESSON_SYSTEM,     max_tokens: 8000, json: false },
  video:      { system: LESSON_SYSTEM,     max_tokens: 8000, json: false },
  flashcards: { system: FLASHCARDS_SYSTEM, max_tokens: 6000, json: true },
  quiz:       { system: QUIZ_SYSTEM,       max_tokens: 8000, json: true },
  chat:       { system: CHAT_SYSTEM,       max_tokens: 4000, json: false },
  quizchat:   { system: QUIZCHAT_SYSTEM,   max_tokens: 4000, json: false },
  ask:        { system: ASK_SYSTEM,        max_tokens: 4000, json: false },
  feynman:    { system: FEYNMAN_SYSTEM,    max_tokens: 2000, json: true },
  podcast:    { system: PODCAST_SYSTEM,    max_tokens: 8000, json: true },
  specialist: { system: "",                max_tokens: 6000, json: false }, // system comes from the field's tool
};

// ── Field specialties ────────────────────────────────────────────────────────
// Each field is a "lens" (a specialist persona prepended to every generation so
// notes/quiz/flashcards/advanced/podcast are re-toned to how that professional
// studies) plus one signature "tool" (its own AI breakdown of the material).
export const FIELDS = {
  none: { id: "none", name: "General", icon: "📚", lens: "", tool: null },
  medicine: {
    id: "medicine", name: "Medicine", icon: "⚕️",
    lens: "Adopt the mindset of a clinician and medical educator. Frame the material around mechanism (pathophysiology) → clinical presentation → diagnosis → management; flag high-yield, testable facts; add memory aids and mnemonics where useful; use correct medical terminology but briefly define it.",
    tool: { key: "case", name: "Clinical case", icon: "🩺",
      system: "You are a clinical educator. From the student's material, write ONE realistic teaching CASE in GitHub-flavoured Markdown: a brief patient vignette (presentation, relevant history/exam/labs), then a short guided work-up — the key questions to ask, the most likely diagnosis with reasoning, important differentials to exclude, and initial management — each tied back to the underlying concept from the material. Do not invent facts beyond standard clinical reasoning. End with 2–3 **high-yield takeaways**." } },
  law: {
    id: "law", name: "Law", icon: "⚖️",
    lens: "Adopt the mindset of a legal scholar. Organise the material as Issue → Rule → Application → Conclusion (IRAC); surface holdings, legal tests, and elements; note exceptions and policy rationale; spot ambiguities and counterarguments.",
    tool: { key: "irac", name: "IRAC brief", icon: "⚖️",
      system: "You are a law tutor. From the student's material, produce a clear IRAC breakdown in GitHub-flavoured Markdown: **Issue(s)** (the legal questions), **Rule(s)** (governing doctrine, tests and elements, naming any authorities that appear in the material), **Application** (how the rules apply, with counterarguments and exceptions), and **Conclusion**. Add a short **Issue-spotting checklist**. Base everything strictly on the material; do not invent cases or statutes." } },
  engineering: {
    id: "engineering", name: "Engineering", icon: "⚙️",
    lens: "Adopt the mindset of an engineer. Reason from first principles; state assumptions and governing equations; track units and orders of magnitude; emphasise derivations, trade-offs, and real-world application.",
    tool: { key: "problems", name: "Worked problems", icon: "📐",
      system: "You are an engineering tutor. From the student's material, create 3–5 worked practice PROBLEMS in GitHub-flavoured Markdown. For each: state the problem, list givens and assumptions, show the governing equation(s), then work through the solution step by step with units, ending in a **bold final answer** and a one-line sanity check. Keep problems grounded in the material's concepts; use LaTeX ($…$) for math." } },
  cs: {
    id: "cs", name: "Computer Science", icon: "⌨️",
    lens: "Adopt the mindset of a computer scientist. Emphasise algorithms, data structures, complexity (time/space, Big-O), correctness, and design trade-offs; use precise terminology and small concrete examples.",
    tool: { key: "walkthrough", name: "Code walkthrough", icon: "💻",
      system: "You are a computer science tutor. From the student's material, produce a focused walkthrough in GitHub-flavoured Markdown: explain the key algorithm/concept, give a short clean code example in a fenced code block, trace how it runs on a small input, and analyse its time and space complexity (Big-O) with reasoning. Note common pitfalls and trade-offs. Stay faithful to the material." } },
  finance: {
    id: "finance", name: "Business & Finance", icon: "📈",
    lens: "Adopt the mindset of a business strategist and financial analyst. Use established frameworks (SWOT, Porter's Five Forces, unit economics); quantify with key metrics and ratios; weigh trade-offs and incentives; ground ideas in concrete examples.",
    tool: { key: "casestudy", name: "Case study", icon: "📊",
      system: "You are a business-school tutor. From the student's material, write a concise CASE STUDY analysis in GitHub-flavoured Markdown: the situation/problem, analysis using a named framework, the key metrics or drivers that matter, options with their trade-offs, and a reasoned recommendation. Add 2–3 **key takeaways**. Base it on the material; do not fabricate figures." } },
  science: {
    id: "science", name: "Natural Sciences", icon: "🔬",
    lens: "Adopt the mindset of a research scientist. Distinguish hypotheses, mechanisms, and evidence; explain cause-and-effect and underlying processes; connect observations to experiments; be precise about conditions and assumptions.",
    tool: { key: "mechanism", name: "Mechanism & experiment", icon: "🧪",
      system: "You are a science tutor. From the student's material, produce in GitHub-flavoured Markdown: (1) a clear step-by-step explanation of the key MECHANISM or process (what causes what, and why), and (2) a simple THOUGHT EXPERIMENT or testable prediction that would probe it, including what you'd expect to observe. Stay faithful to the material." } },
  humanities: {
    id: "humanities", name: "Humanities & History", icon: "📜",
    lens: "Adopt the mindset of a historian/humanities scholar. Foreground context, causation and consequence, competing perspectives, and the use of evidence; build and critique arguments; attend to significance and interpretation over rote facts.",
    tool: { key: "essay", name: "Essay plan", icon: "✍️",
      system: "You are a humanities tutor. From the student's material, produce an ESSAY PLAN in GitHub-flavoured Markdown: a sharp thesis answering an important question about the material, then 3–4 argument sections — each with a claim, supporting evidence/examples from the material, and a counterpoint to address — and a brief conclusion. Keep it analytical, not merely descriptive." } },
  math: {
    id: "math", name: "Mathematics", icon: "∑",
    lens: "Adopt the mindset of a mathematician. Be rigorous and precise; state definitions and theorems exactly; justify claims with proofs or derivations; use correct notation in LaTeX ($…$) and watch edge cases.",
    tool: { key: "proof", name: "Proofs & derivations", icon: "🧮",
      system: "You are a mathematics tutor. From the student's material, pick the central result(s) and give rigorous PROOFS or DERIVATIONS in GitHub-flavoured Markdown: state each definition/theorem precisely, then prove or derive it step by step with justified steps, using LaTeX ($…$) for all math. Note assumptions and edge cases, and finish with a worked example. Base everything on the material." } },
  architecture: {
    id: "architecture", name: "Architecture", icon: "🏛️",
    lens: "Adopt the mindset of an architect. Read the material through form and function, site and context, the program/brief, spatial organisation and circulation, structure and materials, light and human scale, and constraints (budget, codes, sustainability); reason with precedents and design intent (the parti).",
    tool: { key: "concept", name: "Concept & precedent", icon: "🏗️",
      system: "You are an architecture tutor. From the student's material, produce a design breakdown in GitHub-flavoured Markdown: the core design concept / parti and intent; spatial organisation and circulation; structure and materials; how it responds to site, context and constraints (program, budget, codes, sustainability); and one relevant PRECEDENT with what it teaches. Base everything on the material; do not invent projects." } },
  psychology: {
    id: "psychology", name: "Psychology", icon: "🧠",
    lens: "Adopt the mindset of a psychologist. Separate theory, construct, and evidence; consider competing perspectives (cognitive, behavioural, biological, social, developmental); scrutinise study design, operationalisation, validity, bias and ethics; connect findings to real behaviour.",
    tool: { key: "theory", name: "Theory & evidence", icon: "🧩",
      system: "You are a psychology tutor. From the student's material, produce a breakdown in GitHub-flavoured Markdown: the key theory or construct explained clearly; the supporting EVIDENCE (naming any studies in the material, with their method and findings); a balanced EVALUATION (strengths, limitations, biases, ethical issues); and a real-world application. Base everything strictly on the material; do not invent studies." } },
  economics: {
    id: "economics", name: "Economics", icon: "💹",
    lens: "Adopt the mindset of an economist. Reason from incentives, trade-offs and marginal analysis; use supply and demand, equilibrium, elasticity, and cost–benefit thinking; distinguish micro from macro; treat models as assumptions → predictions and note market failures and real-world caveats.",
    tool: { key: "model", name: "Model & diagram", icon: "📉",
      system: "You are an economics tutor. From the student's material, produce a breakdown in GitHub-flavoured Markdown: the key economic MODEL or concept (its assumptions and the mechanism); a described DIAGRAM (axes, the curves, and what shifts them and why); a short worked example or scenario; and the policy implications or real-world limitations. Base everything on the material." } },
  languages: {
    id: "languages", name: "Languages", icon: "🔤",
    lens: "Adopt the mindset of a language teacher. Focus on vocabulary and collocations, grammar patterns and conjugation, pronunciation, and example sentences in real context; flag common mistakes and false friends and note register; favour active recall and usage over rote.",
    tool: { key: "vocabdrills", name: "Vocab & drills", icon: "📖",
      system: "You are a language tutor. From the student's material, produce in GitHub-flavoured Markdown: a KEY VOCABULARY list (term — meaning — a natural example sentence); the main GRAMMAR point(s) with the pattern and examples; COMMON PITFALLS (false friends, typical errors); and 4–6 PRACTICE items (sentences to translate or gaps to fill) with an answer key. Base everything on the material." } },
  nursing: {
    id: "nursing", name: "Nursing", icon: "🧑‍⚕️",
    lens: "Adopt the mindset of a nurse. Centre patient care and safety; work the nursing process (assess → diagnose → plan → implement → evaluate); prioritise with ABCs and Maslow; attend to vital signs and monitoring, medications and dosages, and clear patient education and communication.",
    tool: { key: "careplan", name: "Care plan", icon: "📋",
      system: "You are a nursing tutor. From the student's material, build a nursing CARE PLAN in GitHub-flavoured Markdown: key ASSESSMENT data (subjective/objective); a NURSING DIAGNOSIS (problem, related-to, as-evidenced-by); SMART goals / expected outcomes; nursing INTERVENTIONS each with a brief rationale; and EVALUATION criteria. Add safety and patient-education notes. Base everything on the material; do not invent clinical values." } },
  design: {
    id: "design", name: "Design", icon: "🎨",
    lens: "Adopt the mindset of a designer. Start from the user/audience and the problem; weigh function and usability alongside visual principles (hierarchy, contrast, balance, typography, colour, grid, whitespace); value iteration, feedback and critique; respect constraints, so that form serves purpose.",
    tool: { key: "critique", name: "Design critique", icon: "🖌️",
      system: "You are a design tutor. From the student's material, produce a design CRITIQUE in GitHub-flavoured Markdown: the problem and intended audience; the core concept/approach; how visual and interaction principles are applied (hierarchy, contrast, typography, colour, layout, usability); what works and what doesn't; and concrete, prioritised improvements. Base everything on the material." } },
  journalism: {
    id: "journalism", name: "Journalism", icon: "📰",
    lens: "Adopt the mindset of a journalist. Lead with the 5 Ws and How and the inverted pyramid (most important first); separate verified fact from opinion; attribute sources and weigh newsworthiness, angle, accuracy, balance and clarity.",
    tool: { key: "brief", name: "News brief", icon: "📝",
      system: "You are a journalism tutor. From the student's material, produce a news-style BRIEF in GitHub-flavoured Markdown: a strong one-sentence LEDE; the key facts answering who / what / when / where / why / how; the ANGLE and why it matters; the SOURCES you'd attribute; and the open QUESTIONS a reporter would still chase. Keep it factual and base everything on the material." } },
  education: {
    id: "education", name: "Education", icon: "🎓",
    lens: "Adopt the mindset of an educator. Frame material by learning objectives (Bloom's taxonomy), scaffolding and prior knowledge, likely misconceptions, checks for understanding, differentiation and feedback — always asking how to make ideas learnable and memorable.",
    tool: { key: "lessonplan", name: "Lesson plan", icon: "📒",
      system: "You are an education tutor. From the student's material, build a LESSON PLAN in GitHub-flavoured Markdown: clear learning OBJECTIVES (Bloom-aligned); assumed prior knowledge; a sequenced set of ACTIVITIES / explanations with timings; CHECKS for understanding; likely MISCONCEPTIONS and how to address them; and a short ASSESSMENT. Base everything on the material." } },
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

  if (task === "document") {
    // Gemini reads uploaded documents (PDFs of textbook pages, slides, handouts).
    const docs = Array.isArray(payload?.docs) ? payload.docs : [];
    const parts = docs.slice(0, 5).map((d) => ({ inline_data: { mime_type: d.mime || "application/pdf", data: d.data } }));
    const extra = String(payload?.extraText || "").slice(0, MAX_SOURCE);
    parts.push({ text: `These file(s) are the student's study material — usually a PDF of textbook pages, slides, lecture notes, or a handout. Read ALL of it carefully: extract the text accurately, describe any important figures, tables, or diagrams, and turn everything into clean, organised study notes following the system instructions.${extra ? `\n\nThe student also attached this text, which belongs with the material:\n\n${extra}` : ""}` });
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

  if (task === "chat" || task === "ask" || task === "quizchat") {
    const context = String(payload?.context || "").slice(0, MAX_SOURCE);
    const history = Array.isArray(payload?.history) ? payload.history : [];
    const question = String(payload?.question || "").trim();
    const label = task === "ask" ? "SOURCES" : task === "quizchat" ? "QUIZ & STUDY MATERIAL" : "STUDY NOTES";
    return {
      system_instruction: { parts: [{ text: `${cfg.system}\n\n${label}:\n\n${context}` }] },
      contents: [
        ...history
          .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
          .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content) }] })),
        { role: "user", parts: [{ text: question }] },
      ],
      generationConfig,
    };
  }

  if (task === "specialist") {
    // The system prompt is the selected field's signature tool.
    const f = FIELDS[payload?.field];
    let sys = (f && f.tool && f.tool.system) || "You are an expert tutor. Produce a helpful specialist breakdown of the material in GitHub-flavoured Markdown.";
    if (payload?.context) sys += `\n\nSTUDENT'S FOCUS — weigh this heavily and follow it: ${String(payload.context).slice(0, 2000)}`;
    const source = String(payload?.source || "").slice(0, MAX_SOURCE);
    return { system_instruction: { parts: [{ text: sys }] }, contents: [{ role: "user", parts: [{ text: `SOURCE MATERIAL:\n\n${source}` }] }], generationConfig };
  }

  const source = String(payload?.source || "").slice(0, MAX_SOURCE);
  const label = task === "lesson" ? "VIDEO TRANSCRIPT" : "SOURCE MATERIAL";
  let sys = cfg.system;
  // Field "lens": prepend a specialist persona so generation is re-toned to the field.
  { const f = FIELDS[payload?.field]; if (f && f.lens) sys = `${f.lens}\n\n${sys}`; }
  if (task === "flashcards" || task === "quiz") {
    if (payload?.difficulty) sys += difficultyDirective(task, payload.difficulty);
    if (payload?.count) sys += countDirective(task, payload.count);
  }
  if (task === "podcast" && payload?.minutes) sys += podcastLengthDirective(payload.minutes);
  // Optional per-feature focus the student typed — steer generation toward it.
  if (payload?.context && task !== "merge") {
    sys += `\n\nSTUDENT'S FOCUS — the student explicitly asked you to focus on / handle this; weigh it heavily and follow it: ${String(payload.context).slice(0, 2000)}`;
  }
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
  if (task === "document") {
    // PDFs can run to many pages — give them room, but don't burn quota on many retries.
    return { timeoutMs: 120_000, attemptsPrimary: 2, attemptsFallback: 1, maxModels: 3 };
  }
  if (task === "merge") {
    // Synthesising several notes into one is a larger single generation.
    return { timeoutMs: 90_000, attemptsPrimary: 2, attemptsFallback: 1, maxModels: 3 };
  }
  if (task === "specialist") {
    return { timeoutMs: 75_000, attemptsPrimary: 2, attemptsFallback: 1, maxModels: 3 };
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
