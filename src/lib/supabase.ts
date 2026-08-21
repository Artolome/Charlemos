// Client Supabase + contexte de session (mode « classe »).
// Si SUPABASE_URL / SUPABASE_ANON_KEY sont vides dans src/config.ts,
// l'application reste en mode local et tout ceci est inactif.

import { createContext, useContext } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../config";

export const supabaseEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!supabaseEnabled) return null;
  client ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}

export interface Profile {
  id: string;
  display_name: string;
  role: "student" | "teacher";
  class_id: string | null;
}

export interface SessionInfo {
  /** null en mode local ou hors connexion */
  profile: Profile | null;
  signOut: () => void;
}

export const SessionContext = createContext<SessionInfo>({
  profile: null,
  signOut: () => {},
});

export function useSession(): SessionInfo {
  return useContext(SessionContext);
}

/** "Léa Dupont" → "leadupont" (identifiant stable pour l'e-mail technique) */
export function slugName(name: string): string {
  let out = "";
  for (const ch of name.normalize("NFD").toLowerCase()) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x0300 && cp <= 0x036f) continue; // accents décomposés (é → e + ́)
    if ((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9")) out += ch;
  }
  return out.slice(0, 24);
}

/**
 * Les élèves n'ont pas d'adresse e-mail : on fabrique un identifiant
 * technique déterministe prénom+code de classe, jamais affiché.
 */
export function studentEmail(prenom: string, joinCode: string): string {
  return `${slugName(prenom)}.${joinCode.trim().toLowerCase()}@charlemos.local`;
}

/** En-têtes d'appel de la fonction Edge (proxy IA), avec le jeton de session */
export async function getFunctionAuth(): Promise<{
  url: string;
  headers: Record<string, string>;
} | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return {
    url: `${SUPABASE_URL}/functions/v1/charlemos-ia`,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
    },
  };
}
