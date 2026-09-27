// gamify.js — XP, levels, and achievements (stored per-device in localStorage).
// Pure, side-effect-free logic; the app decides when to celebrate.
const XP_KEY = "recall_xp";
const ACH_KEY = "recall_achievements";

function read(key, def) { try { const v = localStorage.getItem(key); return v == null ? def : JSON.parse(v); } catch { return def; } }
function write(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

export function getXP() { return read(XP_KEY, 0); }

// Cumulative XP required to be AT level L (L1 = 0). Curve grows each level.
export function cumForLevel(L) { const n = Math.max(0, L - 1); return 50 * n + 25 * n * (n - 1) / 2; }

export function levelInfo(xp = getXP()) {
  let L = 1;
  while (cumForLevel(L + 1) <= xp) L++;
  const base = cumForLevel(L), next = cumForLevel(L + 1);
  return { level: L, xp, into: xp - base, need: next - base, pct: Math.min(100, Math.round(((xp - base) / (next - base)) * 100)) };
}

// Award XP; returns { xp, level, leveledUp, from, to }.
export function addXP(amount) {
  const before = levelInfo();
  const xp = getXP() + Math.max(0, amount | 0);
  write(XP_KEY, xp);
  const after = levelInfo(xp);
  return { xp, level: after.level, leveledUp: after.level > before.level, from: before.level, to: after.level };
}

export const ACHIEVEMENTS = [
  { id: "first-note",  icon: "🌱", name: "First Steps",    desc: "Create your first note" },
  { id: "ten-notes",   icon: "📚", name: "Note Collector", desc: "Rack up 10 notes" },
  { id: "advanced",    icon: "🧠", name: "Deep Thinker",   desc: "Generate an Advanced breakdown" },
  { id: "quiz-ace",    icon: "🎯", name: "Perfect Score",  desc: "Ace a quiz — 100%" },
  { id: "teach-master",icon: "🧑‍🏫", name: "The Explainer",  desc: "Score 90%+ on Teach-back" },
  { id: "podcast",     icon: "🎧", name: "In Your Ears",   desc: "Turn a note into a podcast" },
  { id: "polymath",    icon: "🌟", name: "Polymath",       desc: "Use every study tool on one note" },
  { id: "streak-3",    icon: "🔥", name: "On a Roll",      desc: "Reach a 3-day streak" },
  { id: "streak-7",    icon: "⚡", name: "Unstoppable",     desc: "Reach a 7-day streak" },
  { id: "level-5",     icon: "⭐", name: "Rising Star",     desc: "Reach Level 5" },
];

export function getEarned() { return read(ACH_KEY, {}); }
export function isEarned(id) { return !!getEarned()[id]; }
export function earnedCount() { return Object.keys(getEarned()).length; }

// Unlock an achievement; returns the achievement object if newly earned, else null.
export function unlock(id) {
  const earned = getEarned();
  if (earned[id]) return null;
  const ach = ACHIEVEMENTS.find((a) => a.id === id);
  if (!ach) return null;
  earned[id] = Date.now();
  write(ACH_KEY, earned);
  return ach;
}
