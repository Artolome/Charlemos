// Tableau de bord professeur (mode « classe ») : création de la classe,
// code d'inscription, suivi des élèves, lecture des conversations et
// des rapports de mission, export CSV.

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ClipboardList,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  School,
  Users,
} from "lucide-react";
import { AGENTS, agentById } from "../lib/agents";
import { useApp } from "../lib/context";
import { parseAssistantContent } from "../lib/markers";
import { getSupabase, useSession } from "../lib/supabase";
import type { ChatMessage, VocabEntry } from "../lib/types";

interface ClassRow {
  id: string;
  name: string;
  join_code: string;
}

interface StudentRow {
  id: string;
  display_name: string;
}

interface ProgressRow {
  user_id: string;
  xp: number;
  streak: number;
  msg_count: number;
  per_agent: Record<string, number>;
  missions_completed: number;
  best_mission: number;
  vocab: VocabEntry[];
  updated_at: string;
}

interface ReportRow {
  user_id: string;
  total: number;
  comprension: number;
  expresion: number;
  lexico: number;
  insignia: string;
  consejo: string;
  created_at: string;
}

interface ConvRow {
  agent_id: string;
  level: string;
  messages: ChatMessage[];
  updated_at: string;
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function makeJoinCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function TeacherView() {
  const { profile } = useSession();
  const { pushToast } = useApp();
  const [loading, setLoading] = useState(true);
  const [klass, setKlass] = useState<ClassRow | null>(null);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [progressRows, setProgressRows] = useState<Map<string, ProgressRow>>(new Map());
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [className, setClassName] = useState("");
  const [selected, setSelected] = useState<StudentRow | null>(null);

  const refresh = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !profile) return;
    setLoading(true);
    try {
      const { data: classes } = await sb
        .from("classes")
        .select("id, name, join_code")
        .eq("teacher_id", profile.id)
        .order("created_at")
        .limit(1);
      const k = classes?.[0] ?? null;
      setKlass(k);
      if (!k) return;

      const { data: profs } = await sb
        .from("profiles")
        .select("id, display_name")
        .eq("class_id", k.id)
        .eq("role", "student")
        .order("display_name");
      const studs = (profs ?? []) as StudentRow[];
      setStudents(studs);

      const ids = studs.map((s) => s.id);
      if (ids.length > 0) {
        const [{ data: prog }, { data: reps }] = await Promise.all([
          sb.from("progress").select("*").in("user_id", ids),
          sb
            .from("mission_reports")
            .select("*")
            .in("user_id", ids)
            .order("created_at", { ascending: false })
            .limit(200),
        ]);
        setProgressRows(
          new Map(((prog ?? []) as ProgressRow[]).map((p) => [p.user_id, p])),
        );
        setReports((reps ?? []) as ReportRow[]);
      } else {
        setProgressRows(new Map());
        setReports([]);
      }
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createClass = async () => {
    const sb = getSupabase();
    if (!sb || !profile || !className.trim()) return;
    const code = makeJoinCode();
    const { error } = await sb.from("classes").insert({
      name: className.trim(),
      join_code: code,
      teacher_id: profile.id,
    });
    if (error) {
      pushToast({ emoji: "⚠️", title: `Création impossible : ${error.message}` });
      return;
    }
    setClassName("");
    void refresh();
  };

  const copyCode = async () => {
    if (!klass) return;
    try {
      await navigator.clipboard.writeText(klass.join_code);
      pushToast({ emoji: "📋", title: "Code de classe copié !" });
    } catch {
      /* ignore */
    }
  };

  const exportCsv = () => {
    if (!klass) return;
    const sep = ";";
    const lines = [
      ["Prénom", "XP", "Messages", "Missions", "Meilleur score /12", "Mots au carnet", "Dernière activité"].join(sep),
      ...students.map((s) => {
        const p = progressRows.get(s.id);
        return [
          s.display_name,
          p?.xp ?? 0,
          p?.msg_count ?? 0,
          p?.missions_completed ?? 0,
          p?.best_mission ?? 0,
          Array.isArray(p?.vocab) ? p.vocab.length : 0,
          p?.updated_at ? new Date(p.updated_at).toLocaleString("fr-FR") : "—",
        ].join(sep);
      }),
    ];
    const blob = new Blob(["﻿" + lines.join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `charlemos-${klass.join_code}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!profile || profile.role !== "teacher") {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-500">
        Cette page est réservée au compte professeur.
      </div>
    );
  }

  if (loading && !klass) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-orange-400" />
      </div>
    );
  }

  if (!klass) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-xl ring-1 ring-orange-100 dark:bg-slate-900 dark:ring-slate-800">
          <School className="mx-auto h-10 w-10 text-orange-400" />
          <h2 className="mt-2 font-display text-xl font-extrabold">Crée ta classe</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Un code d'inscription sera généré : les élèves l'utiliseront pour créer
            leur compte.
          </p>
          <input
            value={className}
            onChange={(e) => setClassName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void createClass()}
            placeholder="Ex. : 5e B — Espagnol"
            className="mt-4 w-full rounded-xl border border-orange-200 bg-white px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 dark:border-slate-700 dark:bg-slate-950"
          />
          <button
            onClick={() => void createClass()}
            disabled={!className.trim()}
            className="mt-3 w-full rounded-xl bg-orange-500 py-2.5 font-display text-sm font-extrabold text-white hover:bg-orange-600 disabled:opacity-50"
          >
            Créer la classe
          </button>
        </div>
      </div>
    );
  }

  if (selected) {
    return (
      <StudentDetail
        student={selected}
        progress={progressRows.get(selected.id)}
        reports={reports.filter((r) => r.user_id === selected.id)}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 pb-16 pt-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-extrabold">
            {klass.name} <span className="text-slate-400">·</span>{" "}
            <Users className="inline h-6 w-6" /> {students.length}
          </h1>
          <div className="flex-1" />
          <button
            onClick={() => void refresh()}
            className="flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-600 ring-1 ring-orange-200 hover:bg-orange-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Actualiser
          </button>
          <button
            onClick={exportCsv}
            className="flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-600 ring-1 ring-orange-200 hover:bg-orange-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-indigo-50 p-4 ring-1 ring-indigo-200 dark:bg-indigo-950/40 dark:ring-indigo-900">
          <ClipboardList className="h-5 w-5 text-indigo-500" />
          <p className="text-sm font-semibold text-indigo-800 dark:text-indigo-200">
            Code d'inscription des élèves :
          </p>
          <span className="rounded-xl bg-white px-4 py-1.5 font-mono text-xl font-extrabold tracking-[0.3em] text-indigo-700 shadow-sm dark:bg-slate-900 dark:text-indigo-300">
            {klass.join_code}
          </span>
          <button
            onClick={() => void copyCode()}
            className="rounded-lg p-1.5 text-indigo-400 hover:bg-white dark:hover:bg-slate-800"
            title="Copier le code"
          >
            <Copy className="h-4 w-4" />
          </button>
          <p className="w-full text-xs text-indigo-600/80 dark:text-indigo-300/80">
            L'élève choisit « Élève → Crée ton compte », entre son prénom, ce code et
            un mot de passe.
          </p>
        </div>

        {students.length === 0 ? (
          <p className="mt-8 rounded-2xl bg-white/70 p-6 text-center text-sm text-slate-500 dark:bg-slate-900/70 dark:text-slate-400">
            Aucun élève inscrit pour l'instant — partage le code ci-dessus. 🙂
          </p>
        ) : (
          <div className="mt-6 space-y-2">
            {students.map((s, i) => {
              const p = progressRows.get(s.id);
              const nbReports = reports.filter((r) => r.user_id === s.id).length;
              return (
                <motion.button
                  key={s.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.03 * i }}
                  onClick={() => setSelected(s)}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl bg-white p-3.5 text-left ring-1 ring-orange-100 transition-shadow hover:shadow-md dark:bg-slate-900 dark:ring-slate-800"
                >
                  <span className="font-display text-base font-extrabold">
                    {s.display_name}
                  </span>
                  <span className="text-xs font-bold text-violet-600 dark:text-violet-300">
                    ✨ {p?.xp ?? 0} XP
                  </span>
                  <span className="text-xs text-slate-500">
                    💬 {p?.msg_count ?? 0} messages
                  </span>
                  <span className="text-xs text-slate-500">
                    🧭 {p?.missions_completed ?? 0} mission
                    {(p?.missions_completed ?? 0) > 1 ? "s" : ""}
                    {p?.best_mission ? ` (max ${p.best_mission}/12)` : ""}
                  </span>
                  <span className="text-xs text-slate-500">
                    📚 {Array.isArray(p?.vocab) ? p.vocab.length : 0} mots
                  </span>
                  <span className="ml-auto text-xs text-slate-400">
                    {nbReports > 0 && `${nbReports} rapport${nbReports > 1 ? "s" : ""} · `}
                    {p?.updated_at
                      ? new Date(p.updated_at).toLocaleDateString("fr-FR")
                      : "jamais actif"}
                  </span>
                </motion.button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------

function StudentDetail({
  student,
  progress,
  reports,
  onBack,
}: {
  student: StudentRow;
  progress?: ProgressRow;
  reports: ReportRow[];
  onBack: () => void;
}) {
  const [convs, setConvs] = useState<ConvRow[] | null>(null);
  const [openAgent, setOpenAgent] = useState<string | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    void sb
      .from("conversations")
      .select("agent_id, level, messages, updated_at")
      .eq("user_id", student.id)
      .then(({ data }) => setConvs((data ?? []) as ConvRow[]));
  }, [student.id]);

  const openConv = useMemo(
    () => convs?.find((c) => c.agent_id === openAgent) ?? null,
    [convs, openAgent],
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 pb-16 pt-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-sm font-bold text-slate-600 hover:bg-orange-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4" /> Retour à la classe
        </button>

        <h1 className="mt-2 font-display text-3xl font-extrabold">{student.display_name}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          ✨ {progress?.xp ?? 0} XP · 💬 {progress?.msg_count ?? 0} messages · 🧭{" "}
          {progress?.missions_completed ?? 0} missions · 📚{" "}
          {Array.isArray(progress?.vocab) ? progress.vocab.length : 0} mots au carnet
        </p>

        {/* Rapports de mission */}
        {reports.length > 0 && (
          <>
            <h2 className="mt-6 font-display text-lg font-extrabold">
              Rapports de mission
            </h2>
            <div className="mt-2 space-y-2">
              {reports.map((r, i) => (
                <div
                  key={i}
                  className="rounded-2xl bg-white p-3.5 text-sm ring-1 ring-orange-100 dark:bg-slate-900 dark:ring-slate-800"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-extrabold text-indigo-600 dark:text-indigo-300">
                      {r.total}/12
                    </span>
                    <span className="text-xs">
                      Compréhension {r.comprension}/4 · Expression {r.expresion}/4 ·
                      Lexique {r.lexico}/4
                    </span>
                    <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                      🎖️ {r.insignia}
                    </span>
                    <span className="ml-auto text-xs text-slate-400">
                      {new Date(r.created_at).toLocaleDateString("fr-FR")}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    💡 {r.consejo}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Conversations */}
        <h2 className="mt-6 font-display text-lg font-extrabold">Conversations</h2>
        {convs === null ? (
          <Loader2 className="mt-3 h-5 w-5 animate-spin text-orange-400" />
        ) : convs.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Aucune conversation enregistrée pour l'instant.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {convs.map((c) => {
              const agent = agentById(c.agent_id);
              const active = openAgent === c.agent_id;
              return (
                <button
                  key={c.agent_id}
                  onClick={() => setOpenAgent(active ? null : c.agent_id)}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold ring-1 transition-colors ${
                    active
                      ? "bg-slate-900 text-white ring-slate-900 dark:bg-white dark:text-slate-900"
                      : "bg-white text-slate-600 ring-orange-200 hover:bg-orange-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700"
                  }`}
                >
                  <span>{agent.emoji}</span> {agent.nombre}
                  <span className="opacity-60">
                    ({Array.isArray(c.messages) ? c.messages.length : 0})
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {openConv && (
          <div className="mt-4 space-y-2 rounded-2xl bg-white/70 p-4 ring-1 ring-orange-100 dark:bg-slate-900/60 dark:ring-slate-800">
            {(openConv.messages ?? []).map((m, i) => {
              const agent = agentById(openConv.agent_id);
              const text =
                m.role === "assistant" ? parseAssistantContent(m.content).text : m.content;
              if (!text) return null;
              return (
                <div
                  key={m.id ?? i}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap break-words rounded-xl px-3 py-1.5 text-xs leading-relaxed ${
                      m.role === "user"
                        ? "bg-violet-600 text-white"
                        : `${agent.color.bubble}`
                    }`}
                  >
                    {m.role === "assistant" && (
                      <span className="mr-1">{agent.emoji}</span>
                    )}
                    {text}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Carnet */}
        {Array.isArray(progress?.vocab) && progress.vocab.length > 0 && (
          <>
            <h2 className="mt-6 font-display text-lg font-extrabold">Carnet de mots</h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {progress.vocab.map((v, i) => (
                <span
                  key={i}
                  className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
                  title={v.fr}
                >
                  {v.es}
                </span>
              ))}
            </div>
          </>
        )}

        {/* Activité par personnage */}
        {progress?.per_agent && (
          <>
            <h2 className="mt-6 font-display text-lg font-extrabold">Par personnage</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {AGENTS.map((a) => (
                <span
                  key={a.id}
                  className={`rounded-xl px-3 py-1.5 text-xs font-bold ${a.color.chipBg}`}
                >
                  {a.emoji} {a.nombre} : {progress.per_agent[a.id] ?? 0}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
