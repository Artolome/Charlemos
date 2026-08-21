// Volet latéral du chat : carnet de vocabulaire personnel + bloc-notes.

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BookMarked, Copy, NotebookPen, Plus, Volume2, X } from "lucide-react";
import { useApp } from "../lib/context";
import { speak, ttsSupported } from "../lib/speech";
import type { AgentDef } from "../lib/types";

export function SidePanel({
  agent,
  open,
  onClose,
}: {
  agent: AgentDef;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <>
      {/* Colonne fixe sur grand écran */}
      <aside className="hidden w-72 shrink-0 border-l border-orange-100 lg:block dark:border-slate-800">
        <PanelContent agent={agent} />
      </aside>

      {/* Tiroir sur mobile / tablette */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 z-40 bg-black/40 lg:hidden"
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "tween", duration: 0.22 }}
              className="fixed inset-y-0 right-0 z-50 w-80 max-w-[90vw] bg-orange-50 shadow-2xl lg:hidden dark:bg-slate-950"
            >
              <button
                onClick={onClose}
                className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-slate-400 hover:bg-white dark:hover:bg-slate-800"
                title="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
              <PanelContent agent={agent} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function PanelContent({ agent }: { agent: AgentDef }) {
  const { vocab, addVocab, removeVocab, notes, setNotes, pushToast } = useApp();
  const [tab, setTab] = useState<"vocab" | "notes">("vocab");
  const [newEs, setNewEs] = useState("");
  const [newFr, setNewFr] = useState("");

  // Copie le carnet dans le presse-papiers de l'élève (pour le coller
  // dans son cahier numérique ou un document de révision).
  const copyAll = async () => {
    const lines = vocab.map((v) => `${v.es} — ${v.fr}`).join("\n");
    try {
      await navigator.clipboard.writeText(lines);
      pushToast({ emoji: "📋", title: "Carnet copié !" });
    } catch {
      pushToast({ emoji: "⚠️", title: "Copie impossible dans ce navigateur." });
    }
  };

  const addManual = () => {
    if (!newEs.trim() || !newFr.trim()) return;
    addVocab([{ es: newEs, fr: newFr }]);
    setNewEs("");
    setNewFr("");
  };

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-2 flex gap-1 rounded-xl bg-orange-100/70 p-1 dark:bg-slate-900">
        <TabButton
          active={tab === "vocab"}
          onClick={() => setTab("vocab")}
          icon={<BookMarked className="h-3.5 w-3.5" />}
          label={`Carnet (${vocab.length})`}
        />
        <TabButton
          active={tab === "notes"}
          onClick={() => setTab("notes")}
          icon={<NotebookPen className="h-3.5 w-3.5" />}
          label="Bloc-notes"
        />
      </div>

      {tab === "vocab" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-display text-sm font-extrabold">Mon carnet de mots</h3>
            {vocab.length > 0 && (
              <button
                onClick={copyAll}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-500 hover:bg-white dark:hover:bg-slate-800"
                title="Copier tout le carnet"
              >
                <Copy className="h-3 w-3" /> Copier
              </button>
            )}
          </div>

          <div className="mb-2 flex gap-1.5">
            <input
              value={newEs}
              onChange={(e) => setNewEs(e.target.value)}
              placeholder="español"
              className="w-0 flex-1 rounded-lg border border-orange-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-300 dark:border-slate-700 dark:bg-slate-900"
            />
            <input
              value={newFr}
              onChange={(e) => setNewFr(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addManual()}
              placeholder="français"
              className="w-0 flex-1 rounded-lg border border-orange-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-300 dark:border-slate-700 dark:bg-slate-900"
            />
            <button
              onClick={addManual}
              disabled={!newEs.trim() || !newFr.trim()}
              className="rounded-lg bg-emerald-500 px-2 text-white hover:bg-emerald-600 disabled:opacity-40"
              title="Ajouter au carnet"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {vocab.length === 0 ? (
              <p className="mt-4 rounded-xl bg-white/60 p-3 text-center text-xs leading-relaxed text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
                Ton carnet est vide. Clique sur 📖 sous un message de {agent.nombre} pour
                récolter du vocabulaire !
              </p>
            ) : (
              <ul className="space-y-1">
                {[...vocab].reverse().map((v) => (
                  <li
                    key={v.es + v.ts}
                    className="group flex items-center gap-1.5 rounded-lg bg-white/70 px-2 py-1.5 text-xs dark:bg-slate-900/70"
                  >
                    {ttsSupported() && (
                      <button
                        onClick={() => speak(v.es, agent.ttsLang)}
                        className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                        title="Écouter"
                      >
                        <Volume2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <span className="font-bold">{v.es}</span>
                    <span className="truncate text-slate-500 dark:text-slate-400">
                      — {v.fr}
                    </span>
                    <button
                      onClick={() => removeVocab(v.es)}
                      className="ml-auto text-slate-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100 dark:text-slate-600"
                      title="Retirer du carnet"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <h3 className="mb-2 font-display text-sm font-extrabold">Mon bloc-notes</h3>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={
              "Écris ici ce que tu veux retenir :\nconjugaisons, phrases utiles, idées..."
            }
            className="min-h-0 flex-1 resize-none rounded-xl border border-orange-200 bg-white/80 p-3 text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-orange-300 dark:border-slate-700 dark:bg-slate-900/80"
          />
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold transition-colors ${
        active
          ? "bg-white text-slate-800 shadow-sm dark:bg-slate-800 dark:text-white"
          : "text-slate-500 hover:text-slate-700 dark:text-slate-400"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
