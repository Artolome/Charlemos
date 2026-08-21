import { motion } from "framer-motion";
import { Compass, X } from "lucide-react";
import type { MissionInforme } from "../lib/types";

export function MissionBar({
  etapa,
  done,
}: {
  etapa: { n: number; total: number } | null;
  done: boolean;
}) {
  const pct = done ? 100 : etapa ? Math.round((etapa.n / etapa.total) * 100) : 0;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-sm">
      <Compass className="h-4 w-4 shrink-0 text-indigo-500" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[11px] font-extrabold text-indigo-700 dark:text-indigo-300">
            {done
              ? "¡Misión cumplida! 🎉"
              : etapa
                ? `Misión en curso — étape ${etapa.n}/${etapa.total}`
                : "Briefing — choisis ta mission"}
          </span>
        </div>
        <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-indigo-100 dark:bg-indigo-950/60">
          <motion.div
            animate={{ width: `${pct}%` }}
            transition={{ type: "spring", stiffness: 120, damping: 20 }}
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
          />
        </div>
      </div>
    </div>
  );
}

const CONFETTI = ["🎉", "⭐", "🎊", "✨", "🏆", "🎈"];

export function MissionReport({
  informe,
  onClose,
}: {
  informe: MissionInforme;
  onClose: () => void;
}) {
  const xp = 20 + informe.total * 10;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      {CONFETTI.map((c, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 60, x: 0 }}
          animate={{ opacity: [0, 1, 1, 0], y: -160, x: (i - 2.5) * 70 }}
          transition={{ duration: 2.2, delay: 0.15 + i * 0.12, repeat: Infinity, repeatDelay: 1.2 }}
          className="pointer-events-none absolute text-3xl"
          style={{ left: "50%", top: "55%" }}
        >
          {c}
        </motion.span>
      ))}

      <motion.div
        initial={{ scale: 0.8, y: 24 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900"
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 hover:bg-orange-100 dark:hover:bg-slate-800"
          title="Fermer"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 12, delay: 0.1 }}
            className="text-6xl"
          >
            🎖️
          </motion.div>
          <h2 className="mt-2 font-display text-2xl font-extrabold">¡Misión cumplida!</h2>
          <p className="mt-1 text-sm font-bold text-indigo-600 dark:text-indigo-300">
            Insigne obtenu : « {informe.insignia} »
          </p>
          <div className="mt-3 inline-flex items-baseline gap-1 rounded-2xl bg-indigo-50 px-5 py-2 dark:bg-indigo-950/50">
            <span className="font-display text-4xl font-extrabold text-indigo-600 dark:text-indigo-300">
              {informe.total}
            </span>
            <span className="text-lg font-bold text-slate-400">/ {informe.max}</span>
          </div>
          <span className="ml-2 inline-block rounded-full bg-violet-100 px-3 py-1 text-xs font-extrabold text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
            +{xp} XP ✨
          </span>
        </div>

        <div className="mt-5 space-y-2.5">
          <ScoreRow label="Compréhension" value={informe.comprension} max={informe.subMax} color="bg-sky-500" />
          <ScoreRow label="Expression" value={informe.expresion} max={informe.subMax} color="bg-rose-500" />
          <ScoreRow label="Lexique" value={informe.lexico} max={informe.subMax} color="bg-emerald-500" />
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900">
          <span className="text-lg">💡</span>
          <p>
            <b>Conseil du Capitán :</b> {informe.consejo}
          </p>
        </div>

        <button
          onClick={onClose}
          className="mt-5 w-full rounded-xl bg-indigo-600 py-2.5 font-display text-sm font-extrabold text-white shadow hover:bg-indigo-700"
        >
          ¡Genial! Continuer →
        </button>
      </motion.div>
    </motion.div>
  );
}

function ScoreRow({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-xs font-bold">
        <span>{label}</span>
        <span className="text-slate-400">
          {value}/{max}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.7, delay: 0.3 }}
          className={`h-full rounded-full ${color}`}
        />
      </div>
    </div>
  );
}
