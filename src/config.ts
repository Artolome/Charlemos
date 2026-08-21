// ============================================================
// Configuration Supabase (mode « classe » avec comptes élèves)
// ============================================================
// Laisser vide = l'application fonctionne en mode local (clé API
// saisie dans les réglages, données uniquement sur l'appareil).
//
// Pour activer les comptes élèves et le tableau de bord professeur,
// suivre INSTALLATION-SUPABASE.md puis renseigner ces deux valeurs
// (visibles dans Supabase → Project Settings → API). Elles sont
// publiques par conception : la sécurité repose sur les règles RLS
// et la clé API Anthropic reste secrète, côté serveur.

export const SUPABASE_URL = ""; // ex. "https://abcdefghijkl.supabase.co"
export const SUPABASE_ANON_KEY = ""; // clé « anon public »
