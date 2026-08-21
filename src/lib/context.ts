import { createContext, useContext } from "react";
import type { MissionInforme, Progress, Settings, VocabEntry } from "./types";

export interface Toast {
  id: string;
  emoji: string;
  title: string;
  sub?: string;
}

export type Route =
  | { name: "hub" }
  | { name: "chat"; agentId: string }
  | { name: "progress" }
  | { name: "teacher" };

export interface AppContextValue {
  settings: Settings;
  updateSettings(patch: Partial<Settings>): void;
  progress: Progress;
  vocab: VocabEntry[];
  notes: string;
  setNotes(n: string): void;
  /** Ajoute des mots au carnet (dédoublonnés) et renvoie le nombre ajouté */
  addVocab(items: { es: string; fr: string }[], agentId?: string): number;
  removeVocab(es: string): void;
  awardMessageXp(agentId: string): void;
  completeMission(informe: MissionInforme): void;
  pushToast(t: Omit<Toast, "id">): void;
  openSettings(): void;
  navigate(route: Route): void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppContext manquant");
  return ctx;
}
