import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { BookMarked, Compass, Flame, Lock } from "lucide-react";
import { AGENTS } from "../lib/agents";
import { useApp } from "../lib/context";
import { BADGES, levelInfo } from "../lib/gamification";
import { useSession } from "../lib/supabase";

export function Dashboard() {
  const { progress, vocab, settings } = useApp();
  const { profile } = useSession();
  const lvl = levelInfo(progress.xp);
  const unlocked = progress.badges.length;
  const name = (profile?.display_name ?? settings.studentName).trim();

  const maxPerAgent = Math.max(10, ...AGENTS.map((a) => progress.perAgent[a.id] ?? 0));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 pb-16 pt-8">
        <h1 className="font-display text-3xl font-extrabold">
          {name ? `Les progrès de ${name}` : "Mes progrès"} 📊
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Chaque message envoyé en espagnol rapporte 10 XP — les missions du Capitán
          jusqu'à 140 XP.
        </p>

        {/* Cartes de statistiques */}
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard delay={0}>
            <LevelRing pct={lvl.pct} level={lvl.level} />
            <div>
              <div className="font-display text-lg font-extrabold">Niveau {lvl.level}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {progress.xp} XP · encore {lvl.span - lvl.current} XP
              </div>
            </div>
          </StatCard>
          <StatCard delay={0.05}>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 dark:bg-orange-950/60">
              <Flame className="h-6 w-6 text-orange-500" />
            </span>
            <div>
              <div className="font-display text-lg font-extrabold">
                {progress.streakCount} jour{progress.streakCount > 1 ? "s" : ""}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                d'affilée — reviens demain !
              </div>
            </div>
          </StatCard>
          <StatCard delay={0.1}>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-100 dark:bg-indigo-950/60">
              <Compass className="h-6 w-6 text-indigo-500" />
            </span>
            <div>
              <div className="font-display text-lg font-extrabold">
                {progress.missionsCompleted} mission
                {progress.missionsCompleted > 1 ? "s" : ""}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {progress.bestMission > 0
                  ? `record : ${progress.bestMission}/12`
                  : "tente le Capitán !"}
              </div>
            </div>
          </StatCard>
          <StatCard delay={0.15}>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-950/60">
              <BookMarked className="h-6 w-6 text-emerald-500" />
            </span>
            <div>
              <div className="font-display text-lg font-extrabold">{vocab.length} mots</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                dans ton carnet
              </div>
            </div>
          </StatCard>
        </div>

        {/* Badges */}
        <h2 className="mt-10 font-display text-xl font-extrabold">
          Mes badges{" "}
          <span className="text-sm font-bold text-slate-400">
            ({unlocked}/{BADGES.length})
          </span>
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {BADGES.map((b, i) => {
            const has = progress.badges.includes(b.id);
            return (
              <motion.div
                key={b.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.02 * i }}
                className={`relative rounded-2xl p-3 text-center ring-1 ${
                  has
                    ? "bg-white shadow-sm ring-orange-100 dark:bg-slate-900 dark:ring-slate-700"
                    : "bg-white/40 opacity-55 ring-orange-100 grayscale dark:bg-slate-900/40 dark:ring-slate-800"
                }`}
                title={b.desc}
              >
                {!has && (
                  <Lock className="absolute right-2 top-2 h-3.5 w-3.5 text-slate-400" />
                )}
                <div className="text-3xl">{b.emoji}</div>
                <div className="mt-1 text-xs font-extrabold leading-tight">{b.nombre}</div>
                <div className="mt-0.5 text-[10px] leading-tight text-slate-500 dark:text-slate-400">
                  {b.desc}
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Activité par personnage */}
        <h2 className="mt-10 font-display text-xl font-extrabold">Par personnage</h2>
        <div className="mt-3 space-y-2.5">
          {AGENTS.map((a) => {
            const count = progress.perAgent[a.id] ?? 0;
            const pct = Math.round((count / maxPerAgent) * 100);
            return (
              <div
                key={a.id}
                className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-orange-100 dark:bg-slate-900 dark:ring-slate-800"
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-xl ${a.color.grad}`}
                >
                  {a.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-extrabold">{a.nombre}</span>
                    <span className="shrink-0 text-xs font-bold text-slate-400">
                      {count} message{count > 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.6 }}
                      className={`h-full rounded-full bg-gradient-to-r ${a.color.grad}`}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatCard({ children, delay }: { children: ReactNode; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-orange-100 dark:bg-slate-900 dark:ring-slate-800"
    >
      {children}
    </motion.div>
  );
}

function LevelRing({ pct, level }: { pct: number; level: number }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-12 w-12 shrink-0">
      <svg viewBox="0 0 48 48" className="h-12 w-12 -rotate-90">
        <circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          strokeWidth="5"
          className="stroke-violet-100 dark:stroke-violet-950"
        />
        <circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (c * pct) / 100}
          className="stroke-violet-500 transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-display text-sm font-extrabold text-violet-600 dark:text-violet-300">
        {level}
      </span>
    </div>
  );
}
