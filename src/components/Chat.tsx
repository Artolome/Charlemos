import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Lightbulb,
  Loader2,
  Mic,
  NotebookPen,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { agentById, LEVEL_CHOICES } from "../lib/agents";
import { friendlyError, streamAgentReply, suggestReplies } from "../lib/api";
import { useApp } from "../lib/context";
import { parseAssistantContent } from "../lib/markers";
import { createRecognizer, sttSupported, stopSpeaking, type Recognizer } from "../lib/speech";
import { supabaseEnabled } from "../lib/supabase";
import {
  clearConversation,
  loadConversation,
  saveConversation,
  uid,
} from "../lib/storage";
import type {
  ChatMessage,
  Conversation,
  LevelChoice,
  MessageHelper,
  MissionInforme,
} from "../lib/types";
import { MessageBubble } from "./MessageBubble";
import { MissionBar, MissionReport } from "./Mission";
import { SidePanel } from "./SidePanel";

function starterMessage(content: string): ChatMessage {
  return { id: uid(), role: "assistant", content, ts: Date.now() };
}

export function Chat({ agentId }: { agentId: string }) {
  const agent = agentById(agentId);
  const { settings, awardMessageXp, completeMission, pushToast, openSettings } = useApp();

  const [conv, setConv] = useState<Conversation>(() => {
    const saved = loadConversation(agentId);
    if (!saved) {
      return { messages: [starterMessage(agent.starter)], level: agent.defaultLevel };
    }
    // Retire les bulles assistant vides laissées par un arrêt au mauvais moment
    const messages = saved.messages.filter(
      (m) => m.role === "user" || m.error || m.content.trim().length > 0,
    );
    return {
      ...saved,
      messages: messages.length > 0 ? messages : [starterMessage(agent.starter)],
    };
  });
  const [input, setInput] = useState("");
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [missionReport, setMissionReport] = useState<MissionInforme | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const recognizerRef = useRef<Recognizer | null>(null);
  const dictationBaseRef = useRef("");

  // Persistance de la conversation
  useEffect(() => {
    saveConversation(agentId, conv);
  }, [agentId, conv]);

  // Défilement automatique vers le bas
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conv.messages]);

  // Nettoyage à la fermeture du chat
  useEffect(() => {
    return () => {
      abortRef.current?.();
      recognizerRef.current?.stop();
      stopSpeaking();
    };
  }, []);

  const updateMessage = useCallback((id: string, patch: Partial<ChatMessage>) => {
    setConv((c) => ({
      ...c,
      messages: c.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));
  }, []);

  const saveHelper = useCallback(
    (id: string, patch: Partial<MessageHelper>) => {
      setConv((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === id ? { ...m, helper: { ...m.helper, ...patch } } : m,
        ),
      }));
    },
    [],
  );

  const runAssistant = useCallback(
    async (history: ChatMessage[], level: LevelChoice) => {
      const asstId = uid();
      setConv((c) => ({
        ...c,
        messages: [
          ...history,
          { id: asstId, role: "assistant", content: "", ts: Date.now() },
        ],
      }));
      setStreamingId(asstId);
      try {
        const full = await streamAgentReply({
          settings,
          agent,
          level,
          history,
          onDelta: (text) => updateMessage(asstId, { content: text }),
          registerAbort: (abort) => {
            abortRef.current = abort;
          },
        });
        if (!full.trim()) {
          // Rien reçu (arrêt immédiat) : on retire la bulle vide ET on rend
          // son message à l'élève, pour que rien ne soit consommé en silence
          // (sinon le rejeu du mode démo avancerait sur une question jamais vue).
          const lastUser = history[history.length - 1];
          const restoreUser = lastUser?.role === "user";
          setConv((c) => ({
            ...c,
            messages: c.messages.filter(
              (m) => m.id !== asstId && !(restoreUser && m.id === lastUser.id),
            ),
          }));
          if (restoreUser) setInput(lastUser.content);
        } else {
          updateMessage(asstId, { content: full });
          const parsed = parseAssistantContent(full);
          if (parsed.informe) {
            completeMission(parsed.informe);
            setMissionReport(parsed.informe);
          }
        }
      } catch (e) {
        updateMessage(asstId, { content: friendlyError(e), error: true });
      } finally {
        setStreamingId(null);
        abortRef.current = null;
      }
    },
    [agent, settings, updateMessage, completeMission],
  );

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || streamingId) return;
    // En mode classe (Supabase), la clé est côté serveur : rien à exiger ici
    if (!supabaseEnabled && !settings.apiKey && !settings.demoMode) {
      openSettings();
      return;
    }
    if (recording) {
      recognizerRef.current?.stop();
      setRecording(false);
    }
    const userMsg: ChatMessage = { id: uid(), role: "user", content: text, ts: Date.now() };
    const history = [...conv.messages, userMsg];
    setInput("");
    setSuggestions(null);
    if (inputRef.current) inputRef.current.style.height = "auto";
    awardMessageXp(agent.id);
    void runAssistant(history, conv.level);
  }, [
    input,
    streamingId,
    settings,
    recording,
    conv,
    agent.id,
    awardMessageXp,
    runAssistant,
    openSettings,
  ]);

  const retry = useCallback(
    (errorId: string) => {
      const idx = conv.messages.findIndex((m) => m.id === errorId);
      if (idx === -1 || streamingId) return;
      const history = conv.messages.slice(0, idx);
      void runAssistant(history, conv.level);
    },
    [conv, streamingId, runAssistant],
  );

  const requestSuggestions = useCallback(async () => {
    if (suggestionsLoading || streamingId) return;
    setSuggestionsLoading(true);
    try {
      const list = await suggestReplies(settings, agent, conv.messages, conv.level);
      if (list.length === 0) {
        pushToast({ emoji: "🤔", title: "Pas de suggestion cette fois, réessaie !" });
      } else {
        setSuggestions(list);
      }
    } catch (e) {
      pushToast({ emoji: "⚠️", title: friendlyError(e) });
    } finally {
      setSuggestionsLoading(false);
    }
  }, [suggestionsLoading, streamingId, settings, agent, conv, pushToast]);

  const toggleMic = useCallback(() => {
    if (recording) {
      recognizerRef.current?.stop();
      setRecording(false);
      return;
    }
    dictationBaseRef.current = input;
    const rec = createRecognizer(
      (text, final) => {
        const base = dictationBaseRef.current;
        const combined = (base ? base + " " : "") + text;
        setInput(combined);
        if (final) dictationBaseRef.current = combined;
      },
      () => setRecording(false),
      (message) => pushToast({ emoji: "🎤", title: message }),
    );
    if (!rec) {
      pushToast({
        emoji: "🎤",
        title: "Dictée non disponible",
        sub: "Utilise Chrome ou Edge pour dicter en espagnol.",
      });
      return;
    }
    recognizerRef.current = rec;
    setRecording(true);
    rec.start();
  }, [recording, input, pushToast]);

  const resetConversation = useCallback(() => {
    if (
      !window.confirm(
        `Recommencer la conversation avec ${agent.nombre} ? L'historique sera effacé (ton carnet et tes XP sont conservés).`,
      )
    )
      return;
    abortRef.current?.();
    clearConversation(agentId);
    setConv({ messages: [starterMessage(agent.starter)], level: agent.defaultLevel });
    setSuggestions(null);
  }, [agent, agentId]);

  // État de mission (Capitán) dérivé des messages
  const mission = useMemo(() => {
    if (!agent.isMission) return null;
    let etapa: { n: number; total: number } | null = null;
    let etapaIdx = -1;
    let informeIdx = -1;
    conv.messages.forEach((m, i) => {
      if (m.role !== "assistant" || m.error) return;
      const p = parseAssistantContent(m.content, m.id === streamingId);
      if (p.etapa) {
        etapa = p.etapa;
        etapaIdx = i;
      }
      if (p.informe) informeIdx = i;
    });
    return { etapa, done: informeIdx >= 0 && informeIdx >= etapaIdx };
  }, [agent.isMission, conv.messages, streamingId]);

  const lastAssistantId = useMemo(() => {
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      const m = conv.messages[i];
      if (m.role === "assistant" && !m.error) return m.id;
    }
    return null;
  }, [conv.messages]);

  return (
    <div className="mx-auto flex h-full max-w-6xl">
      {/* Colonne principale */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barre d'outils du chat */}
        <div className="flex items-center gap-2 border-b border-orange-100 px-3 py-2 dark:border-slate-800">
          {mission ? (
            <MissionBar etapa={mission.etapa} done={mission.done} />
          ) : (
            <p className={`truncate text-xs font-semibold ${agent.color.text}`}>
              {agent.theme} · niveau conseillé : {agent.levelLabel}
            </p>
          )}
          <div className="flex-1" />
          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400">
            Niveau
            <select
              value={conv.level}
              onChange={(e) =>
                setConv((c) => ({ ...c, level: e.target.value as LevelChoice }))
              }
              className="rounded-lg border border-orange-200 bg-white px-2 py-1 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              title="Niveau CECRL de la conversation"
            >
              {LEVEL_CHOICES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={resetConversation}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"
            title="Recommencer la conversation"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => setPanelOpen(true)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-orange-100 hover:text-orange-600 lg:hidden dark:hover:bg-slate-800"
            title="Carnet de mots & notes"
          >
            <NotebookPen className="h-4 w-4" />
          </button>
        </div>

        {/* Messages */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5">
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            {conv.messages.map((m) => (
              <MessageBubble
                key={m.id}
                msg={m}
                agent={agent}
                level={conv.level}
                isStreaming={m.id === streamingId}
                isLastAssistant={m.id === lastAssistantId}
                onRetry={retry}
                onSaveHelper={saveHelper}
              />
            ))}
          </div>
        </div>

        {/* Suggestions de réponses */}
        <AnimatePresence>
          {suggestions && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="border-t border-orange-100 px-3 py-2 dark:border-slate-800"
            >
              <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-400">💬 Idées :</span>
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setInput(s);
                      setSuggestions(null);
                      inputRef.current?.focus();
                    }}
                    className="rounded-full border border-orange-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-orange-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    {s}
                  </button>
                ))}
                <button
                  onClick={() => setSuggestions(null)}
                  className="rounded-full p-1 text-slate-400 hover:text-slate-600"
                  title="Fermer les suggestions"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Zone de saisie */}
        <div className="border-t border-orange-100 bg-white/60 px-3 py-3 dark:border-slate-800 dark:bg-slate-950/60">
          <div className="mx-auto flex max-w-2xl items-end gap-2">
            <button
              onClick={requestSuggestions}
              disabled={suggestionsLoading || !!streamingId}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 hover:bg-amber-200 disabled:opacity-50 dark:bg-amber-950/50 dark:text-amber-400"
              title="Je suis bloqué·e : propose-moi 3 réponses"
            >
              {suggestionsLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Lightbulb className="h-5 w-5" />
              )}
            </button>
            {sttSupported() && (
              <button
                onClick={toggleMic}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
                  recording
                    ? "animate-pulse-soft bg-red-500 text-white"
                    : "bg-orange-100 text-orange-600 hover:bg-orange-200 dark:bg-orange-950/50 dark:text-orange-400"
                }`}
                title={recording ? "Arrêter la dictée" : "Dicter ma réponse en espagnol"}
              >
                <Mic className="h-5 w-5" />
              </button>
            )}
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={
                recording ? "🎤 Parle en espagnol..." : `Escribe a ${agent.nombre}...`
              }
              rows={1}
              className="max-h-[120px] min-h-10 flex-1 resize-none rounded-xl border border-orange-200 bg-white px-3.5 py-2.5 text-sm leading-snug focus:outline-none focus:ring-2 focus:ring-orange-300 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-orange-700"
            />
            {streamingId ? (
              <button
                onClick={() => abortRef.current?.()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-200 text-slate-600 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-300"
                title="Arrêter la réponse"
              >
                <Square className="h-4 w-4 fill-current" />
              </button>
            ) : (
              <button
                onClick={send}
                disabled={!input.trim()}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm disabled:opacity-40 ${agent.color.button}`}
                title="Envoyer (Entrée)"
              >
                <Send className="h-5 w-5" />
              </button>
            )}
          </div>
          <p className="mx-auto mt-1.5 hidden max-w-2xl text-[11px] text-slate-400 sm:block dark:text-slate-500">
            Entrée pour envoyer · Maj+Entrée pour aller à la ligne · +10 XP par message ✨
          </p>
        </div>
      </div>

      {/* Volet latéral : carnet + notes */}
      <SidePanel agent={agent} open={panelOpen} onClose={() => setPanelOpen(false)} />

      {/* Rapport de fin de mission */}
      <AnimatePresence>
        {missionReport && (
          <MissionReport informe={missionReport} onClose={() => setMissionReport(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
