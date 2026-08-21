import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Eye, EyeOff, KeyRound, Trash2, User, X } from "lucide-react";
import { MODELS } from "../lib/api";
import { useApp } from "../lib/context";
import { resetAllData } from "../lib/storage";
import { supabaseEnabled } from "../lib/supabase";

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, updateSettings } = useApp();
  const [showKey, setShowKey] = useState(false);

  const resetEverything = () => {
    if (
      window.confirm(
        "Tout effacer ? Conversations, carnet de mots, XP, badges et réglages seront supprimés de cet appareil.",
      )
    ) {
      resetAllData();
      window.location.reload();
    }
  };

  const selectedModel = MODELS.find((m) => m.id === settings.model);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, y: 16 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-6 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-extrabold">Réglages ⚙️</h2>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-orange-100 dark:hover:bg-slate-800"
                title="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Accès à l'IA */}
            <section className="mt-4">
              <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-700 dark:text-slate-200">
                <KeyRound className="h-4 w-4" /> Accès à l'IA (côté professeur)
              </h3>
              {supabaseEnabled ? (
                <div className="mt-2 space-y-2">
                  <ModeCard
                    selected={!settings.demoMode}
                    onClick={() => updateSettings({ demoMode: false })}
                    emoji="🎓"
                    title="Mode classe — vraie IA"
                    desc="Les personnages répondent grâce à l'IA, via le serveur sécurisé de la classe. Rien à saisir : la clé est gérée côté serveur."
                  />
                  <ModeCard
                    selected={settings.demoMode}
                    onClick={() => updateSettings({ demoMode: true })}
                    emoji="🎭"
                    title="Mode démo — sans IA"
                    desc="Réponses préenregistrées, gratuites : pour découvrir l'interface ou projeter une démonstration."
                  />
                </div>
              ) : (
                <>
                  <label className="mt-2 block text-xs font-bold text-slate-500 dark:text-slate-400">
                    Clé API Anthropic
                    <div className="mt-1 flex gap-1.5">
                      <input
                        type={showKey ? "text" : "password"}
                        value={settings.apiKey}
                        onChange={(e) => updateSettings({ apiKey: e.target.value.trim() })}
                        placeholder="sk-ant-..."
                        autoComplete="off"
                        className="w-0 flex-1 rounded-xl border border-orange-200 bg-white px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-orange-300 dark:border-slate-700 dark:bg-slate-950"
                      />
                      <button
                        onClick={() => setShowKey(!showKey)}
                        className="rounded-xl border border-orange-200 px-2.5 text-slate-500 hover:bg-orange-50 dark:border-slate-700 dark:hover:bg-slate-800"
                        title={showKey ? "Masquer" : "Afficher"}
                      >
                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </label>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                    À créer sur <b>console.anthropic.com</b> → API Keys (compte du
                    professeur). La clé est enregistrée <b>uniquement sur cet appareil</b>.
                    Sur un poste partagé, retire-la après le cours.
                  </p>
                </>
              )}

              <label className="mt-3 block text-xs font-bold text-slate-500 dark:text-slate-400">
                Modèle
                <select
                  value={settings.model}
                  onChange={(e) => updateSettings({ model: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-orange-200 bg-white px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-orange-300 dark:border-slate-700 dark:bg-slate-950"
                >
                  {MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              {selectedModel && (
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {selectedModel.hint}
                </p>
              )}

              {!supabaseEnabled && (
                <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-xl bg-violet-50 p-3 dark:bg-violet-950/40">
                  <input
                    type="checkbox"
                    checked={settings.demoMode}
                    onChange={(e) => updateSettings({ demoMode: e.target.checked })}
                    className="mt-0.5 h-4 w-4 accent-violet-600"
                  />
                  <span className="text-xs leading-relaxed">
                    <b>Mode démo (sans clé)</b> — les personnages répondent avec des
                    messages préenregistrés. Pratique pour découvrir l'interface ou
                    faire une démonstration en classe sans consommer de crédit.
                    {settings.demoMode && (
                      <span className="mt-1 block font-bold text-violet-700 dark:text-violet-300">
                        ⚠️ Tant que cette case est cochée, elle remplace les vraies
                        réponses IA — décoche-la pour parler aux personnages.
                      </span>
                    )}
                  </span>
                </label>
              )}
            </section>

            {/* Élève (mode local uniquement : en mode classe, le prénom vient du compte) */}
            {!supabaseEnabled && (
              <section className="mt-5">
                <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-700 dark:text-slate-200">
                  <User className="h-4 w-4" /> Élève
                </h3>
                <label className="mt-2 block text-xs font-bold text-slate-500 dark:text-slate-400">
                  Prénom (les personnages l'utiliseront pour te saluer)
                  <input
                    type="text"
                    value={settings.studentName}
                    onChange={(e) => updateSettings({ studentName: e.target.value })}
                    placeholder="Ex. : Léa"
                    maxLength={30}
                    className="mt-1 w-full rounded-xl border border-orange-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Prénom uniquement — jamais de nom de famille ni d'informations
                  personnelles.
                </p>
              </section>
            )}

            {/* Données */}
            <section className="mt-5">
              <h3 className="text-sm font-extrabold text-slate-700 dark:text-slate-200">
                Données
              </h3>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                Tout est stocké localement sur cet appareil : conversations, carnet,
                notes, XP et badges. Seuls les messages de la conversation sont envoyés à
                l'API Anthropic pour générer les réponses des personnages.
              </p>
              <button
                onClick={resetEverything}
                className="mt-2.5 flex items-center gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600 ring-1 ring-red-200 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900"
              >
                <Trash2 className="h-3.5 w-3.5" /> Tout effacer et recommencer
              </button>
            </section>

            <button
              onClick={onClose}
              className="mt-6 w-full rounded-xl bg-slate-900 py-2.5 font-display text-sm font-extrabold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
            >
              Fermer
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ModeCard({
  selected,
  onClick,
  emoji,
  title,
  desc,
}: {
  selected: boolean;
  onClick: () => void;
  emoji: string;
  title: string;
  desc: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-start gap-2.5 rounded-xl p-3 text-left transition-all ${
        selected
          ? "bg-emerald-50 ring-2 ring-emerald-500 dark:bg-emerald-950/40"
          : "bg-white ring-1 ring-orange-200 hover:bg-orange-50 dark:bg-slate-950 dark:ring-slate-700 dark:hover:bg-slate-800"
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
          selected ? "border-emerald-500" : "border-slate-300 dark:border-slate-600"
        }`}
      >
        {selected && <span className="h-2 w-2 rounded-full bg-emerald-500" />}
      </span>
      <span className="text-xs leading-relaxed">
        <b>
          {emoji} {title}
        </b>
        {selected && (
          <span className="ml-1.5 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-extrabold text-white">
            ACTIF
          </span>
        )}
        <span className="mt-0.5 block text-slate-500 dark:text-slate-400">{desc}</span>
      </span>
    </button>
  );
}
