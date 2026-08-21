import type { Progress } from "./types";
import { todayStr } from "./storage";

export const XP_PER_MESSAGE = 10;

/** XP nécessaires pour atteindre le niveau n (n ≥ 1) */
function xpNeeded(n: number): number {
  return 75 * (n - 1) * n; // niv. 2 : 150 XP, niv. 3 : 450, niv. 4 : 900...
}

export interface LevelInfo {
  level: number;
  /** XP accumulés dans le niveau en cours */
  current: number;
  /** XP à accumuler pour passer au niveau suivant */
  span: number;
  pct: number;
}

export function levelInfo(xp: number): LevelInfo {
  let level = 1;
  while (xp >= xpNeeded(level + 1)) level++;
  const floor = xpNeeded(level);
  const ceil = xpNeeded(level + 1);
  const span = ceil - floor;
  const current = xp - floor;
  return { level, current, span, pct: Math.min(100, Math.round((current / span) * 100)) };
}

/** Met à jour la série de jours consécutifs (à appeler à chaque activité) */
export function touchStreak(p: Progress) {
  const today = todayStr();
  if (p.streakLast === today) return;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const m = String(yesterday.getMonth() + 1).padStart(2, "0");
  const d = String(yesterday.getDate()).padStart(2, "0");
  const yesterdayStr = `${yesterday.getFullYear()}-${m}-${d}`;
  p.streakCount = p.streakLast === yesterdayStr ? p.streakCount + 1 : 1;
  p.streakLast = today;
}

export interface BadgeDef {
  id: string;
  nombre: string;
  desc: string;
  emoji: string;
  check: (ctx: BadgeCtx) => boolean;
}

export interface BadgeCtx {
  progress: Progress;
  vocabCount: number;
}

const perAgentBadge = (
  agentId: string,
  nombre: string,
  emoji: string,
  desc: string,
): BadgeDef => ({
  id: `amigo-${agentId}`,
  nombre,
  emoji,
  desc,
  check: ({ progress }) => (progress.perAgent[agentId] ?? 0) >= 10,
});

export const BADGES: BadgeDef[] = [
  {
    id: "primer-paso",
    nombre: "¡Primer paso!",
    emoji: "🌱",
    desc: "Envoyer ton premier message en espagnol",
    check: ({ progress }) => progress.msgCount >= 1,
  },
  {
    id: "charlatan",
    nombre: "Charlatán",
    emoji: "💬",
    desc: "Envoyer 50 messages au total",
    check: ({ progress }) => progress.msgCount >= 50,
  },
  {
    id: "maraton",
    nombre: "Maratón de palabras",
    emoji: "🏃",
    desc: "Envoyer 150 messages au total",
    check: ({ progress }) => progress.msgCount >= 150,
  },
  perAgentBadge("mateo", "Colega de Mateo", "⚽", "Échanger 10 messages avec Mateo"),
  perAgentBadge("valeria", "Exploradora honoraria", "🦋", "Échanger 10 messages avec Valeria"),
  perAgentBadge("diego", "Alma de artista", "🎨", "Échanger 10 messages avec Diego"),
  perAgentBadge("lucia", "Pen pal oficial", "💌", "Échanger 10 messages avec Lucía"),
  perAgentBadge("chispa", "Cazachispas", "⚡", "Échanger 10 messages avec Profesor Chispa"),
  {
    id: "sociable",
    nombre: "Políglota social",
    emoji: "🌍",
    desc: "Parler avec les 6 personnages",
    check: ({ progress }) =>
      Object.values(progress.perAgent).filter((n) => n > 0).length >= 6,
  },
  {
    id: "mision-cumplida",
    nombre: "Misión cumplida",
    emoji: "🏆",
    desc: "Terminer ta première mission du Capitán",
    check: ({ progress }) => progress.missionsCompleted >= 1,
  },
  {
    id: "gran-agente",
    nombre: "Gran agente",
    emoji: "🕵️",
    desc: "Réussir une mission avec 10/12 ou plus",
    check: ({ progress }) => progress.bestMission >= 10,
  },
  {
    id: "coleccionista",
    nombre: "Coleccionista",
    emoji: "📚",
    desc: "Avoir 15 mots dans ton carnet",
    check: ({ vocabCount }) => vocabCount >= 15,
  },
  {
    id: "biblioteca",
    nombre: "Biblioteca viviente",
    emoji: "🦉",
    desc: "Avoir 40 mots dans ton carnet",
    check: ({ vocabCount }) => vocabCount >= 40,
  },
  {
    id: "racha-3",
    nombre: "En racha",
    emoji: "🔥",
    desc: "Pratiquer 3 jours de suite",
    check: ({ progress }) => progress.streakCount >= 3,
  },
  {
    id: "racha-7",
    nombre: "Imparable",
    emoji: "🌟",
    desc: "Pratiquer 7 jours de suite",
    check: ({ progress }) => progress.streakCount >= 7,
  },
  {
    id: "nivel-5",
    nombre: "Estrella del español",
    emoji: "🚀",
    desc: "Atteindre le niveau 5",
    check: ({ progress }) => levelInfo(progress.xp).level >= 5,
  },
];

export function badgeById(id: string): BadgeDef | undefined {
  return BADGES.find((b) => b.id === id);
}

/** Renvoie les badges nouvellement débloqués (non présents dans ctx.progress.badges) */
export function checkNewBadges(ctx: BadgeCtx): BadgeDef[] {
  return BADGES.filter((b) => !ctx.progress.badges.includes(b.id) && b.check(ctx));
}
