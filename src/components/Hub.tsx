import { motion } from "framer-motion";
import { KeyRound, Play, Settings } from "lucide-react";
import { AGENTS } from "../lib/agents";
import { useApp } from "../lib/context";
import { supabaseEnabled, useSession } from "../lib/supabase";
import { AgentCard } from "./AgentCard";

export function Hub() {
  const { settings, updateSettings, progress, openSettings } = useApp();
  const { profile } = useSession();
  // En mode classe, la clé API est côté serveur : rien à configurer ici
  const needsSetup = !supabaseEnabled && !settings.apiKey && !settings.demoMode;
  const name = (profile?.display_name ?? settings.studentName).trim();

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:pt-10">
        <div className="text-center">
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl"
          >
            {name ? (
              <>
                ¡Hola, <span className="text-orange-500">{name}</span>! 👋
              </>
            ) : (
              <>
                ¡Hola! <span className="text-orange-500">¿Hablamos español?</span>
              </>
            )}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="mx-auto mt-3 max-w-xl text-slate-600 dark:text-slate-300"
          >
            Ton club de conversation en espagnol : choisis un personnage, discute avec lui
            à l'écrit ou au micro, gagne des XP et débloque des badges. ¡Vamos!
          </motion.p>
        </div>

        {needsSetup && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mx-auto mt-6 max-w-2xl rounded-3xl border-2 border-dashed border-amber-300 bg-amber-50 p-5 text-center dark:border-amber-700 dark:bg-amber-950/40"
          >
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              🔑 Pour discuter avec les personnages, il faut configurer une clé API
              Anthropic (côté professeur) — ou découvre d'abord l'application en mode
              démo, sans clé.
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button
                onClick={openSettings}
                className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white shadow hover:bg-amber-600"
              >
                <KeyRound className="h-4 w-4" /> Configurer la clé
              </button>
              <button
                onClick={() => updateSettings({ demoMode: true })}
                className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-bold text-amber-700 shadow ring-1 ring-amber-300 hover:bg-amber-100 dark:bg-slate-900 dark:text-amber-300 dark:ring-amber-700"
              >
                <Play className="h-4 w-4" /> Essayer le mode démo
              </button>
            </div>
          </motion.div>
        )}

        {settings.demoMode && (
          <div className="mx-auto mt-6 flex max-w-2xl items-center justify-center gap-2 rounded-2xl bg-violet-100 px-4 py-2.5 text-sm font-semibold text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
            🎭 Mode démo actif : les personnages répondent avec des messages
            préenregistrés.
            <button
              onClick={openSettings}
              className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-violet-900 dark:hover:text-violet-100"
            >
              <Settings className="h-3.5 w-3.5" /> Réglages
            </button>
          </div>
        )}

        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {AGENTS.map((agent, i) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              index={i}
              msgCount={progress.perAgent[agent.id] ?? 0}
            />
          ))}
        </div>

        <p className="mt-10 text-center text-xs text-slate-400 dark:text-slate-500">
          🦜 ¡Charlemos! — pratique de l'espagnol par la conversation · CECRL A1 → B1 ·
          Cycle 4
        </p>
      </div>
    </div>
  );
}
