import { AnimatePresence, motion } from "framer-motion";
import type { Toast } from "../lib/context";

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 24, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.95 }}
            className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-slate-900/95 px-4 py-3 text-white shadow-xl ring-1 ring-white/10 dark:bg-white/95 dark:text-slate-900"
          >
            <span className="text-2xl">{t.emoji}</span>
            <div className="leading-tight">
              <div className="text-sm font-extrabold">{t.title}</div>
              {t.sub && (
                <div className="text-xs text-slate-300 dark:text-slate-600">{t.sub}</div>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
