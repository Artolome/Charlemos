import { useState } from "react";
import { motion } from "framer-motion";
import {
  BookOpen,
  Languages,
  Lightbulb,
  Loader2,
  Plus,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { extractVocab, friendlyError, translateMessage } from "../lib/api";
import { useApp } from "../lib/context";
import { parseAssistantContent } from "../lib/markers";
import { speak, stopSpeaking, ttsSupported } from "../lib/speech";
import type { AgentDef, ChatMessage, LevelChoice, MessageHelper } from "../lib/types";

export function MessageBubble({
  msg,
  agent,
  level,
  isStreaming,
  isLastAssistant,
  onRetry,
  onSaveHelper,
}: {
  msg: ChatMessage;
  agent: AgentDef;
  level: LevelChoice;
  isStreaming: boolean;
  isLastAssistant: boolean;
  onRetry: (id: string) => void;
  onSaveHelper: (id: string, patch: Partial<MessageHelper>) => void;
}) {
  const { settings, addVocab, pushToast } = useApp();
  const [speaking, setSpeaking] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [showVocab, setShowVocab] = useState(false);
  const [loading, setLoading] = useState<"translate" | "vocab" | null>(null);

  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-violet-600 px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm">
          {msg.content}
        </div>
      </div>
    );
  }

  const parsed = parseAssistantContent(msg.content, isStreaming);

  const toggleSpeak = () => {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    speak(parsed.text, agent.ttsLang, () => setSpeaking(false));
  };

  const doTranslate = async () => {
    if (showTranslation) {
      setShowTranslation(false);
      return;
    }
    if (msg.helper?.translation) {
      setShowTranslation(true);
      return;
    }
    setLoading("translate");
    try {
      const translation = await translateMessage(settings, msg.content);
      onSaveHelper(msg.id, { translation });
      setShowTranslation(true);
    } catch (e) {
      pushToast({ emoji: "⚠️", title: friendlyError(e) });
    } finally {
      setLoading(null);
    }
  };

  const doVocab = async () => {
    if (showVocab) {
      setShowVocab(false);
      return;
    }
    if (msg.helper?.vocab?.length) {
      setShowVocab(true);
      return;
    }
    setLoading("vocab");
    try {
      const vocab = await extractVocab(settings, agent, msg.content, level);
      if (vocab.length === 0) {
        pushToast({ emoji: "🤔", title: "Aucun mot extrait, réessaie !" });
      } else {
        onSaveHelper(msg.id, { vocab });
        setShowVocab(true);
      }
    } catch (e) {
      pushToast({ emoji: "⚠️", title: friendlyError(e) });
    } finally {
      setLoading(null);
    }
  };

  const helperBtn =
    "flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white hover:text-slate-700 hover:shadow-sm dark:hover:bg-slate-800 dark:hover:text-slate-200";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-2.5"
    >
      <span
        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-xl shadow-sm ${agent.color.grad}`}
        title={agent.nombre}
      >
        {agent.emoji}
      </span>

      <div className="min-w-0 max-w-[85%]">
        {parsed.etapa && (
          <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-extrabold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
            🧭 Étape {parsed.etapa.n}/{parsed.etapa.total}
          </span>
        )}

        <div
          className={`rounded-2xl rounded-tl-md px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
            msg.error
              ? "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900"
              : agent.color.bubble
          }`}
        >
          {parsed.text ? (
            <p className="whitespace-pre-wrap break-words">
              {parsed.text}
              {isStreaming && (
                <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse-soft rounded-sm bg-current align-text-bottom" />
              )}
            </p>
          ) : isStreaming ? (
            <span className="flex gap-1 py-1" aria-label={`${agent.nombre} écrit...`}>
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  animate={{ y: [0, -4, 0] }}
                  transition={{ repeat: Infinity, duration: 0.9, delay: i * 0.15 }}
                  className="h-1.5 w-1.5 rounded-full bg-slate-400"
                />
              ))}
            </span>
          ) : null}

          {msg.error && (
            <button
              onClick={() => onRetry(msg.id)}
              className="mt-2 flex items-center gap-1.5 rounded-lg bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-200 dark:bg-red-900/50 dark:text-red-200"
            >
              <RotateCcw className="h-3 w-3" /> Réessayer
            </button>
          )}
        </div>

        {parsed.tip && !isStreaming && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mt-1.5 flex items-start gap-1.5 rounded-xl bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-900"
          >
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <b>Astuce :</b> {parsed.tip}
            </span>
          </motion.div>
        )}

        {!msg.error && !isStreaming && parsed.text && (
          <div className="mt-1 flex items-center gap-0.5">
            {ttsSupported() && (
              <button
                onClick={toggleSpeak}
                className={helperBtn}
                title={speaking ? "Arrêter la lecture" : "Écouter la prononciation 🔊"}
              >
                {speaking ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
            )}
            <button
              onClick={doTranslate}
              className={`${helperBtn} ${showTranslation ? "bg-white text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200" : ""}`}
              title="Traduire en français 🌐"
            >
              {loading === "translate" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Languages className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={doVocab}
              className={`${helperBtn} ${showVocab ? "bg-white text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200" : ""}`}
              title="Vocabulaire clé du message 📖"
            >
              {loading === "vocab" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <BookOpen className="h-4 w-4" />
              )}
            </button>
            {isLastAssistant && (
              <span className="pl-1 text-[10px] font-semibold text-slate-300 dark:text-slate-600">
                💡 = idées de réponse en bas
              </span>
            )}
          </div>
        )}

        {showTranslation && msg.helper?.translation && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-1.5 rounded-xl bg-white/70 px-3 py-2 text-xs italic leading-relaxed text-slate-600 ring-1 ring-orange-100 dark:bg-slate-900/70 dark:text-slate-300 dark:ring-slate-800"
          >
            🇫🇷 {msg.helper.translation}
          </motion.p>
        )}

        {showVocab && msg.helper?.vocab && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-1.5 rounded-xl bg-white/70 px-3 py-2 ring-1 ring-orange-100 dark:bg-slate-900/70 dark:ring-slate-800"
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400">
                Vocabulaire clé
              </span>
              <button
                onClick={() => addVocab(msg.helper?.vocab ?? [], agent.id)}
                className="flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300"
              >
                <Plus className="h-3 w-3" /> Tout ajouter au carnet
              </button>
            </div>
            <ul className="space-y-1">
              {msg.helper.vocab.map((v, i) => (
                <li key={i} className="flex items-center gap-1.5 text-xs">
                  {ttsSupported() && (
                    <button
                      onClick={() => speak(v.es, agent.ttsLang)}
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      title="Écouter"
                    >
                      <Volume2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <span className="font-bold">{v.es}</span>
                  <span className="text-slate-500 dark:text-slate-400">— {v.fr}</span>
                  <button
                    onClick={() => addVocab([v], agent.id)}
                    className="ml-auto text-slate-300 hover:text-emerald-600 dark:text-slate-600 dark:hover:text-emerald-400"
                    title="Ajouter ce mot au carnet"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
