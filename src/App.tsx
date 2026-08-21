import { useCallback, useEffect, useRef, useState } from "react";
import { AppContext, type AppContextValue, type Route, type Toast } from "./lib/context";
import type { MissionInforme, Progress, Settings, VocabEntry } from "./lib/types";
import {
  loadNotes,
  loadProgress,
  loadSettings,
  loadVocab,
  saveNotes,
  saveProgress,
  saveSettings,
  saveVocab,
  uid,
} from "./lib/storage";
import { checkNewBadges, touchStreak } from "./lib/gamification";
import { pushMissionReport } from "./lib/sync";
import { Header } from "./components/Header";
import { Hub } from "./components/Hub";
import { Chat } from "./components/Chat";
import { Dashboard } from "./components/Dashboard";
import { TeacherView } from "./components/TeacherView";
import { SettingsModal } from "./components/SettingsModal";
import { Toasts } from "./components/Toasts";

export default function App() {
  const [route, setRoute] = useState<Route>({ name: "hub" });
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const [vocab, setVocab] = useState<VocabEntry[]>(() => loadVocab());
  const [notes, setNotesState] = useState<string>(() => loadNotes());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Miroirs en ref pour éviter les fermetures obsolètes dans les callbacks
  const progressRef = useRef(progress);
  const vocabRef = useRef(vocab);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", settings.theme === "dark");
  }, [settings.theme]);

  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const toast: Toast = { ...t, id: uid() };
    setToasts((prev) => [...prev.slice(-3), toast]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== toast.id));
    }, 4200);
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  /** Applique une mutation de progression + vérifie les badges débloqués */
  const applyProgress = useCallback(
    (mutate: (p: Progress) => void, vocabCount?: number) => {
      const next: Progress = structuredClone(progressRef.current);
      mutate(next);
      const newly = checkNewBadges({
        progress: next,
        vocabCount: vocabCount ?? vocabRef.current.length,
      });
      next.badges = [...next.badges, ...newly.map((b) => b.id)];
      progressRef.current = next;
      saveProgress(next);
      setProgress(next);
      newly.forEach((b) =>
        pushToast({ emoji: b.emoji, title: `Badge débloqué : ${b.nombre}`, sub: b.desc }),
      );
    },
    [pushToast],
  );

  const awardMessageXp = useCallback(
    (agentId: string) => {
      applyProgress((p) => {
        p.xp += 10;
        p.msgCount += 1;
        p.perAgent[agentId] = (p.perAgent[agentId] ?? 0) + 1;
        touchStreak(p);
      });
    },
    [applyProgress],
  );

  const completeMission = useCallback(
    (informe: MissionInforme) => {
      const bonus = 20 + informe.total * 10;
      applyProgress((p) => {
        p.xp += bonus;
        p.missionsCompleted += 1;
        p.bestMission = Math.max(p.bestMission, informe.total);
        touchStreak(p);
      });
      pushMissionReport(informe); // historisé pour le suivi professeur (mode classe)
      pushToast({ emoji: "🏆", title: `Mission terminée : +${bonus} XP !` });
    },
    [applyProgress, pushToast],
  );

  const addVocab = useCallback(
    (items: { es: string; fr: string }[], agentId?: string): number => {
      const existing = new Set(vocabRef.current.map((v) => v.es.trim().toLowerCase()));
      const fresh: VocabEntry[] = items
        .filter((i) => i.es.trim() && !existing.has(i.es.trim().toLowerCase()))
        .map((i) => ({ es: i.es.trim(), fr: i.fr.trim(), agentId, ts: Date.now() }));
      if (fresh.length === 0) {
        pushToast({ emoji: "📚", title: "Déjà dans ton carnet !" });
        return 0;
      }
      const next = [...vocabRef.current, ...fresh];
      vocabRef.current = next;
      saveVocab(next);
      setVocab(next);
      pushToast({
        emoji: "📚",
        title:
          fresh.length === 1
            ? `« ${fresh[0].es} » ajouté au carnet`
            : `${fresh.length} mots ajoutés au carnet`,
      });
      // Revérifie les badges liés au carnet avec le nouveau total
      applyProgress(() => {}, next.length);
      return fresh.length;
    },
    [applyProgress, pushToast],
  );

  const removeVocab = useCallback((es: string) => {
    const next = vocabRef.current.filter((v) => v.es !== es);
    vocabRef.current = next;
    saveVocab(next);
    setVocab(next);
  }, []);

  const setNotes = useCallback((n: string) => {
    setNotesState(n);
    saveNotes(n);
  }, []);

  const ctx: AppContextValue = {
    settings,
    updateSettings,
    progress,
    vocab,
    notes,
    setNotes,
    addVocab,
    removeVocab,
    awardMessageXp,
    completeMission,
    pushToast,
    openSettings: () => setSettingsOpen(true),
    navigate: setRoute,
  };

  return (
    <AppContext.Provider value={ctx}>
      <div className="flex h-dvh flex-col">
        <Header route={route} />
        <main className="min-h-0 flex-1">
          {route.name === "hub" && <Hub />}
          {route.name === "chat" && <Chat key={route.agentId} agentId={route.agentId} />}
          {route.name === "progress" && <Dashboard />}
          {route.name === "teacher" && <TeacherView />}
        </main>
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Toasts toasts={toasts} />
    </AppContext.Provider>
  );
}
