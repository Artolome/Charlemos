import { motion } from "framer-motion";
import { MessageCircle } from "lucide-react";
import type { AgentDef } from "../lib/types";
import { useApp } from "../lib/context";

export function AgentCard({
  agent,
  index,
  msgCount,
}: {
  agent: AgentDef;
  index: number;
  msgCount: number;
}) {
  const { navigate } = useApp();

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.06 * index }}
      whileHover={{ y: -4 }}
      className="group flex flex-col overflow-hidden rounded-3xl bg-white shadow-md shadow-orange-100 ring-1 ring-orange-100 transition-shadow hover:shadow-xl dark:bg-slate-900 dark:shadow-none dark:ring-slate-800"
    >
      <div
        className={`relative flex h-28 items-center justify-center bg-gradient-to-br ${agent.color.grad}`}
      >
        <span className="animate-float text-6xl drop-shadow-lg">{agent.emoji}</span>
        <span className="absolute left-3 top-3 rounded-full bg-white/25 px-2.5 py-0.5 text-xs font-extrabold text-white backdrop-blur-sm">
          {agent.levelLabel}
        </span>
        <span className="absolute right-3 top-3 text-xl drop-shadow">{agent.flag}</span>
        {msgCount > 0 && (
          <span className="absolute bottom-2 right-3 flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[11px] font-bold text-white backdrop-blur-sm">
            <MessageCircle className="h-3 w-3" /> {msgCount}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-display text-xl font-extrabold">{agent.nombre}</h3>
        </div>
        <p className={`text-sm font-semibold italic ${agent.color.text}`}>
          {agent.titulo} · {agent.ciudad}
        </p>
        <span
          className={`mt-2 w-fit rounded-full px-2.5 py-0.5 text-xs font-bold ${agent.color.chipBg}`}
        >
          {agent.theme}
        </span>
        <p className="mt-2.5 flex-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {agent.descripcion}
        </p>
        <button
          onClick={() => navigate({ name: "chat", agentId: agent.id })}
          className={`mt-4 w-full rounded-xl px-4 py-2.5 text-sm font-extrabold text-white shadow-sm transition-transform group-hover:scale-[1.02] ${agent.color.button}`}
        >
          {agent.isMission ? "Accepter une mission 🧭" : `Hablar con ${agent.nombre} →`}
        </button>
      </div>
    </motion.div>
  );
}
