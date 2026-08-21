import type { Conversation, Progress, Settings, VocabEntry } from "./types";

const PREFIX = "charlemos.";

// Espace de noms par utilisateur (mode « classe » avec comptes) :
// les réglages restent globaux à l'appareil, mais conversations,
// progrès, carnet et notes sont rangés par compte connecté.
let namespace = "";

export function setStorageNamespace(userId: string) {
  namespace = userId;
}

// Hook de synchronisation : appelé après chaque sauvegarde de données
// utilisateur (branché par lib/sync.ts quand un compte est connecté).
type ScopedSaveHook = (kind: "progress" | "conv", agentId?: string) => void;
let onScopedSave: ScopedSaveHook | null = null;

export function setOnScopedSave(fn: ScopedSaveHook | null) {
  onScopedSave = fn;
}

function key(k: string, scoped: boolean): string {
  return scoped && namespace ? `${PREFIX}u.${namespace}.${k}` : PREFIX + k;
}

function load<T>(k: string, fallback: T, scoped: boolean): T {
  try {
    const raw = localStorage.getItem(key(k, scoped));
    if (raw === null) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {
    return fallback;
  }
}

function loadRaw<T>(k: string, fallback: T, scoped: boolean): T {
  try {
    const raw = localStorage.getItem(key(k, scoped));
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function save(k: string, value: unknown, scoped: boolean) {
  try {
    localStorage.setItem(key(k, scoped), JSON.stringify(value));
  } catch {
    // stockage plein ou indisponible : on continue sans persister
  }
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  model: "claude-opus-5",
  studentName: "",
  demoMode: false,
  theme:
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
};

export const DEFAULT_PROGRESS: Progress = {
  xp: 0,
  streakCount: 0,
  streakLast: "",
  badges: [],
  msgCount: 0,
  perAgent: {},
  missionsCompleted: 0,
  bestMission: 0,
};

// Réglages : globaux à l'appareil
export const loadSettings = () => load<Settings>("settings", DEFAULT_SETTINGS, false);
export const saveSettings = (s: Settings) => save("settings", s, false);

// Données utilisateur : rangées par compte quand un espace de noms est actif
export const loadProgress = () => load<Progress>("progress", DEFAULT_PROGRESS, true);
export const saveProgress = (p: Progress) => {
  save("progress", p, true);
  onScopedSave?.("progress");
};

export const loadVocab = () => loadRaw<VocabEntry[]>("vocab", [], true);
export const saveVocab = (v: VocabEntry[]) => {
  save("vocab", v, true);
  onScopedSave?.("progress"); // le carnet est stocké dans la ligne progress
};

export const loadNotes = () => loadRaw<string>("notes", "", true);
export const saveNotes = (n: string) => {
  save("notes", n, true);
  onScopedSave?.("progress");
};

export const loadConversation = (agentId: string): Conversation | null =>
  loadRaw<Conversation | null>(`conv.${agentId}`, null, true);
export const saveConversation = (agentId: string, c: Conversation) => {
  save(`conv.${agentId}`, c, true);
  onScopedSave?.("conv", agentId);
};
export const clearConversation = (agentId: string) => {
  try {
    localStorage.removeItem(key(`conv.${agentId}`, true));
  } catch {
    /* ignore */
  }
  onScopedSave?.("conv", agentId);
};

export function resetAllData() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

export function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Date locale au format AAAA-MM-JJ */
export function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
