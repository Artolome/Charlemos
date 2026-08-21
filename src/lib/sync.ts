// Synchronisation localStorage ↔ Supabase (mode « classe »).
// Les données restent d'abord locales (l'appli marche hors connexion) ;
// chaque sauvegarde locale déclenche, avec un léger délai, un envoi
// vers la base — que le professeur consulte dans son tableau de bord.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MissionInforme } from "./types";
import {
  loadConversation,
  loadNotes,
  loadProgress,
  loadVocab,
  setOnScopedSave,
} from "./storage";

let sb: SupabaseClient | null = null;
let uid: string | null = null;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** À appeler après connexion (et après le premier chargement des données) */
export function initSync(client: SupabaseClient, userId: string) {
  sb = client;
  uid = userId;
  setOnScopedSave((kind, agentId) => schedule(kind, agentId));
}

export function stopSync() {
  sb = null;
  uid = null;
  setOnScopedSave(null);
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
}

function schedule(kind: string, agentId?: string) {
  const key = kind + (agentId ?? "");
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      void push(kind, agentId);
    }, 1200),
  );
}

async function push(kind: string, agentId?: string) {
  if (!sb || !uid) return;
  try {
    if (kind === "conv" && agentId) {
      const conv = loadConversation(agentId);
      await sb.from("conversations").upsert({
        user_id: uid,
        agent_id: agentId,
        level: conv?.level ?? "auto",
        // On borne l'historique stocké côté serveur
        messages: conv?.messages.slice(-60) ?? [],
        updated_at: new Date().toISOString(),
      });
    } else {
      const p = loadProgress();
      await sb.from("progress").upsert({
        user_id: uid,
        xp: p.xp,
        streak: p.streakCount,
        badges: p.badges,
        msg_count: p.msgCount,
        per_agent: p.perAgent,
        missions_completed: p.missionsCompleted,
        best_mission: p.bestMission,
        vocab: loadVocab(),
        notes: loadNotes(),
        updated_at: new Date().toISOString(),
      });
    }
  } catch {
    // hors connexion : la copie locale fait foi, on réessaiera au prochain enregistrement
  }
}

/** Historise chaque rapport de mission (pour le suivi professeur) */
export function pushMissionReport(informe: MissionInforme) {
  if (!sb || !uid) return;
  void sb
    .from("mission_reports")
    .insert({
      user_id: uid,
      total: informe.total,
      comprension: informe.comprension,
      expresion: informe.expresion,
      lexico: informe.lexico,
      insignia: informe.insignia,
      consejo: informe.consejo,
    })
    .then(undefined, () => {});
}

interface ProgressRow {
  xp: number;
  streak: number;
  badges: unknown;
  msg_count: number;
  per_agent: unknown;
  missions_completed: number;
  best_mission: number;
  vocab: unknown;
  notes: string;
}

/**
 * Au moment de la connexion : rapatrie les données du compte dans le
 * localStorage (espace de noms de l'utilisateur). À appeler APRÈS
 * setStorageNamespace(userId) et AVANT initSync (pour éviter tout écho).
 */
export async function pullAll(client: SupabaseClient, userId: string) {
  const [{ data: prog }, { data: convs }] = await Promise.all([
    client.from("progress").select("*").eq("user_id", userId).maybeSingle(),
    client.from("conversations").select("agent_id, level, messages").eq("user_id", userId),
  ]);

  if (prog) {
    const row = prog as ProgressRow;
    localStorage.setItem(
      scopedKey(userId, "progress"),
      JSON.stringify({
        xp: row.xp ?? 0,
        streakCount: row.streak ?? 0,
        streakLast: "",
        badges: Array.isArray(row.badges) ? row.badges : [],
        msgCount: row.msg_count ?? 0,
        perAgent: row.per_agent && typeof row.per_agent === "object" ? row.per_agent : {},
        missionsCompleted: row.missions_completed ?? 0,
        bestMission: row.best_mission ?? 0,
      }),
    );
    localStorage.setItem(
      scopedKey(userId, "vocab"),
      JSON.stringify(Array.isArray(row.vocab) ? row.vocab : []),
    );
    localStorage.setItem(scopedKey(userId, "notes"), JSON.stringify(row.notes ?? ""));
  }

  for (const c of convs ?? []) {
    localStorage.setItem(
      scopedKey(userId, `conv.${c.agent_id}`),
      JSON.stringify({ messages: c.messages ?? [], level: c.level ?? "auto" }),
    );
  }
}

function scopedKey(userId: string, k: string): string {
  return `charlemos.u.${userId}.${k}`;
}
