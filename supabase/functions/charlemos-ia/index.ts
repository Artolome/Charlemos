// Fonction Edge « charlemos-ia » : proxy IA de la classe + inscription élève.
// - crée les comptes élèves (déjà confirmés) après vérification du code de classe ;
// - vérifie que les appels IA viennent d'un compte connecté ;
// - reconstruit les prompts pédagogiques côté serveur (non modifiables) ;
// - applique une limite de débit par compte ;
// - appelle l'API Anthropic avec la clé secrète ANTHROPIC_API_KEY
//   (à définir dans : Edge Functions → Secrets) et renvoie le flux.
//
// Déploiement : Supabase → Edge Functions → charlemos-ia → éditeur →
// coller index.ts et prompts.ts → Deploy.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  AGENT_MAX_TOKENS,
  AGENT_NAMES,
  ALLOWED_MODELS,
  buildSystemPrompt,
  EFFORT_MODELS,
  EVAL_MODEL,
  evaluationSystem,
  helperSystem,
} from "./prompts.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RATE_LIMIT = 60; // appels IA max par compte par fenêtre de 10 minutes

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

function mapUpstream(status: number): string {
  if (status === 401) {
    return "La clé API du serveur est invalide : le professeur doit vérifier le secret ANTHROPIC_API_KEY.";
  }
  if (status === 429) {
    return "Le service IA est très demandé en ce moment, réessaie dans quelques secondes.";
  }
  if (status === 529) {
    return "Le service IA est momentanément saturé, réessaie dans un instant.";
  }
  if (status === 400) {
    return "La demande n'a pas pu être traitée (crédit épuisé ? Le professeur peut vérifier sur console.anthropic.com).";
  }
  return "Le service IA a renvoyé une erreur, réessaie.";
}

/** "Léa Dupont" → "leadupont" — doit rester identique à slugName() de l'application */
function slugName(name: string): string {
  let out = "";
  for (const ch of name.normalize("NFD").toLowerCase()) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x0300 && cp <= 0x036f) continue;
    if ((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9")) out += ch;
  }
  return out.slice(0, 24);
}

function studentEmail(prenom: string, joinCode: string): string {
  return `${slugName(prenom)}.${joinCode.trim().toLowerCase()}@charlemos.local`;
}

interface IncomingMessage {
  role?: string;
  content?: string;
}

/** Valide et nettoie le bilan renvoyé par le modèle avant stockage/affichage */
function sanitizeEvaluation(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const strArr = (v: unknown, n: number, max: number) =>
    Array.isArray(v)
      ? v
          .filter((x) => typeof x === "string")
          .slice(0, n)
          .map((s) => (s as string).slice(0, max))
      : [];
  const comps = Array.isArray(r.competences) ? r.competences : [];
  const competences = comps
    .filter((c) => typeof c === "object" && c !== null)
    .slice(0, 8)
    .map((c) => {
      const o = c as Record<string, unknown>;
      const m = Math.round(Number(o.maitrise));
      return {
        code: str(o.code, 40),
        niveau: str(o.niveau, 20),
        maitrise: Number.isFinite(m) ? Math.min(4, Math.max(1, m)) : 1,
        constat: str(o.constat, 500),
        preuves: strArr(o.preuves, 4, 200),
      };
    })
    .filter((c) => c.code.length > 0);
  if (competences.length === 0) return null;
  return {
    niveau_global: str(r.niveau_global, 20) || "A1",
    fiabilite: str(r.fiabilite, 80) || "à confirmer",
    competences,
    points_forts: strArr(r.points_forts, 6, 200),
    axes_progres: strArr(r.axes_progres, 6, 200),
    conseil_eleve: str(r.conseil_eleve, 700),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Méthode non autorisée." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  const admin = createClient(supabaseUrl, serviceKey);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Requête illisible." });
  }
  const op = String(body.op ?? "");

  // 0. Inscription d'un élève (sans session) : le serveur vérifie le code de
  //    classe et crée le compte déjà confirmé — les élèves n'ont pas d'e-mail.
  //    Les professeurs, eux, s'inscrivent normalement et confirment par e-mail.
  if (op === "signup_student") {
    const prenom = String(body.prenom ?? "").trim();
    const code = String(body.code ?? "").trim().toUpperCase();
    const password = String(body.password ?? "");
    if (slugName(prenom).length < 2) {
      return json(400, { error: "Écris ton prénom (lettres uniquement)." });
    }
    if (!code) {
      return json(400, { error: "Il faut le code de classe donné par ton professeur." });
    }
    if (password.length < 6) {
      return json(400, { error: "Le mot de passe doit faire au moins 6 caractères." });
    }
    const { data: cls } = await admin
      .from("classes")
      .select("id")
      .eq("join_code", code)
      .maybeSingle();
    if (!cls) {
      return json(400, { error: "Code de classe inconnu. Vérifie-le avec ton professeur." });
    }
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: studentEmail(prenom, code),
      password,
      email_confirm: true,
      user_metadata: { display_name: prenom, role: "student" },
    });
    if (createErr || !created?.user) {
      const msg = createErr?.message ?? "";
      return json(409, {
        error: /already|exist|registered/i.test(msg)
          ? "Ce prénom est déjà pris dans cette classe : ajoute l'initiale de ton nom (ex. « Léa B »)."
          : `Création impossible : ${msg}`,
      });
    }
    const { error: profErr } = await admin.from("profiles").insert({
      id: created.user.id,
      display_name: prenom,
      role: "student",
      class_id: cls.id,
    });
    if (profErr) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json(500, { error: `Profil non créé : ${profErr.message}` });
    }
    return json(200, { ok: true });
  }

  if (!apiKey) {
    return json(500, {
      error:
        "Le serveur n'a pas de clé API : le professeur doit ajouter le secret ANTHROPIC_API_KEY (Edge Functions → Secrets).",
    });
  }

  // 1. Authentification du compte
  const authHeader = req.headers.get("authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await userClient.auth.getUser();
  const user = userData?.user;
  if (!user) return json(401, { error: "Session expirée : reconnecte-toi à ton compte." });

  const { data: profile } = await admin
    .from("profiles")
    .select("display_name, role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return json(403, { error: "Profil introuvable : recrée ton compte." });

  // 2. Limite de débit par compte
  const windowStart = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("usage_log")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", windowStart);
  if ((count ?? 0) >= RATE_LIMIT) {
    return json(429, {
      error: "Doucement ! ⏳ Tu as fait beaucoup de demandes : attends quelques minutes.",
    });
  }
  await admin.from("usage_log").insert({ user_id: user.id });

  // Déclaré ici car utilisé par evaluate_student ET par les appels IA plus bas
  const anthropicHeaders = (withFallbacks: boolean): Record<string, string> => ({
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    ...(withFallbacks ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {}),
  });

  // 3a. Suppression d'une classe par son professeur : retire la classe ET
  //     les comptes de ses élèves (leurs données suivent, par cascade).
  if (op === "delete_class") {
    if (profile.role !== "teacher") {
      return json(403, { error: "Action réservée au professeur." });
    }
    const classId = String(body.classId ?? "");
    const { data: cls } = await admin
      .from("classes")
      .select("id")
      .eq("id", classId)
      .eq("teacher_id", user.id)
      .maybeSingle();
    if (!cls) return json(404, { error: "Classe introuvable." });
    const { data: studs } = await admin
      .from("profiles")
      .select("id")
      .eq("class_id", classId)
      .eq("role", "student");
    let removed = 0;
    for (const s of studs ?? []) {
      const { error } = await admin.auth.admin.deleteUser(s.id);
      if (!error) removed++;
    }
    await admin.from("classes").delete().eq("id", classId);
    return json(200, { ok: true, removed });
  }

  // 3b. Bilan de compétences d'un élève (CECRL / cycle 4), généré par l'IA
  //     à la demande du professeur, à partir des écrits réels de l'élève.
  if (op === "evaluate_student") {
    if (profile.role !== "teacher") {
      return json(403, { error: "Action réservée au professeur." });
    }
    const studentId = String(body.studentId ?? "");
    const { data: stud } = await admin
      .from("profiles")
      .select("id, display_name, class_id")
      .eq("id", studentId)
      .eq("role", "student")
      .maybeSingle();
    if (!stud?.class_id) return json(404, { error: "Élève introuvable." });
    const { data: ownCls } = await admin
      .from("classes")
      .select("id")
      .eq("id", stud.class_id)
      .eq("teacher_id", user.id)
      .maybeSingle();
    if (!ownCls) return json(403, { error: "Cet élève n'est pas dans une de tes classes." });

    const [{ data: convs }, { data: reps }, { data: prog }] = await Promise.all([
      admin
        .from("conversations")
        .select("agent_id, level, messages")
        .eq("user_id", studentId),
      admin
        .from("mission_reports")
        .select("total, comprension, expresion, lexico, insignia, consejo, created_at")
        .eq("user_id", studentId)
        .order("created_at", { ascending: false })
        .limit(10),
      admin.from("progress").select("msg_count, vocab").eq("user_id", studentId).maybeSingle(),
    ]);

    const stripMarkers = (s: string) => s.replace(/\[\[[^\]]*\]\]/g, " ").trim();
    let studentMsgCount = 0;
    const convBlocks: string[] = [];
    for (const c of convs ?? []) {
      const name = AGENT_NAMES[c.agent_id] ?? c.agent_id;
      const msgs = (Array.isArray(c.messages) ? c.messages : []) as {
        role?: string;
        content?: string;
        error?: boolean;
      }[];
      const lines = msgs
        .filter((m) => !m.error && typeof m.content === "string" && m.content.trim())
        .slice(-40)
        .map((m) => {
          if (m.role === "user") {
            studentMsgCount++;
            return `ÉLÈVE : ${String(m.content).slice(0, 500)}`;
          }
          return `${name} : ${stripMarkers(String(m.content)).slice(0, 300)}`;
        });
      if (lines.some((l) => l.startsWith("ÉLÈVE"))) {
        convBlocks.push(`## Conversation avec ${name} (niveau réglé : ${c.level})\n${lines.join("\n")}`);
      }
    }
    if (studentMsgCount === 0) {
      return json(400, {
        error: "Cet élève n'a pas encore écrit de messages : rien à évaluer pour l'instant.",
      });
    }

    const missionLines = (reps ?? [])
      .map(
        (r) =>
          `- ${new Date(r.created_at).toLocaleDateString("fr-FR")} : total ${r.total}/12 (compréhension ${r.comprension}/4, expression ${r.expresion}/4, lexique ${r.lexico}/4) — conseil donné : ${r.consejo ?? "—"}`,
      )
      .join("\n");
    const vocabCount = Array.isArray(prog?.vocab) ? prog.vocab.length : 0;

    const userContent = [
      `Élève : ${stud.display_name} (5ème, espagnol LV2, 1re année). ${prog?.msg_count ?? studentMsgCount} messages envoyés au total, ${vocabCount} mots dans son carnet personnel.`,
      (reps ?? []).length > 0
        ? `# Rapports de mission (évaluations ludiques passées)\n${missionLines}`
        : "# Rapports de mission\nAucune mission terminée.",
      ...convBlocks,
    ]
      .join("\n\n")
      .slice(0, 90000);

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: anthropicHeaders(false),
      body: JSON.stringify({
        model: EVAL_MODEL,
        max_tokens: 2500,
        system: evaluationSystem(),
        messages: [{ role: "user", content: userContent }],
      }),
    });
    if (!upstream.ok) {
      console.error("anthropic evaluate", upstream.status, await upstream.text());
      return json(502, { error: mapUpstream(upstream.status) });
    }
    const resp = (await upstream.json()) as {
      stop_reason?: string;
      content?: { type: string; text?: string }[];
    };
    const raw = (resp.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) {
      return json(502, { error: "Le bilan n'a pas pu être généré, réessaie." });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return json(502, { error: "Le bilan n'a pas pu être généré, réessaie." });
    }
    const evaluation = sanitizeEvaluation(parsed);
    if (!evaluation) {
      return json(502, { error: "Le bilan n'a pas pu être généré, réessaie." });
    }
    await admin.from("evaluations").insert({
      user_id: studentId,
      model: EVAL_MODEL,
      data: evaluation,
    });
    return json(200, { ok: true, evaluation });
  }

  // 3c. Validation de la demande IA
  const model = ALLOWED_MODELS.includes(String(body.model))
    ? String(body.model)
    : ALLOWED_MODELS[0];
  const level = ["A1", "A1+", "A2", "B1", "auto"].includes(String(body.level))
    ? String(body.level)
    : "auto";

  // 4a. Conversation avec un personnage (flux SSE renvoyé tel quel)
  if (op === "chat") {
    const agentId = String(body.agentId ?? "");
    if (!(agentId in AGENT_MAX_TOKENS)) return json(400, { error: "Personnage inconnu." });

    const rawMsgs = Array.isArray(body.messages) ? (body.messages as IncomingMessage[]) : [];
    const messages = rawMsgs
      .slice(-24)
      .filter(
        (m) =>
          (m?.role === "user" || m?.role === "assistant") &&
          typeof m?.content === "string" &&
          m.content.trim().length > 0,
      )
      .map((m) => ({ role: m.role as string, content: String(m.content).slice(0, 4000) }));
    if (messages.length === 0 || messages[0].role !== "user") {
      messages.unshift({ role: "user", content: "¡Hola!" });
    }

    const payload = {
      model,
      max_tokens: AGENT_MAX_TOKENS[agentId],
      stream: true,
      system: [
        {
          type: "text",
          text: buildSystemPrompt(agentId, level, profile.display_name),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages,
      ...(EFFORT_MODELS.has(model) ? { output_config: { effort: "low" } } : {}),
    };

    const call = (withFallbacks: boolean) =>
      fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: anthropicHeaders(withFallbacks),
        body: JSON.stringify(withFallbacks ? { ...payload, fallbacks: "default" } : payload),
      });

    let upstream = await call(model === "claude-opus-5");
    if (!upstream.ok && upstream.status === 400 && model === "claude-opus-5") {
      // Paramètre beta de fallback non reconnu (évolution d'API) : on retente sans
      upstream = await call(false);
    }
    if (!upstream.ok || !upstream.body) {
      console.error("anthropic /messages", upstream.status, await upstream.text());
      return json(502, { error: mapUpstream(upstream.status) });
    }
    return new Response(upstream.body, {
      headers: {
        ...CORS,
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      },
    });
  }

  // 4b. Aides intégrées : traduction, vocabulaire, suggestions (réponse JSON)
  if (op === "translate" || op === "vocab" || op === "suggest") {
    const text = String(body.text ?? "").slice(0, 6000);
    if (!text.trim()) return json(400, { error: "Texte manquant." });
    const agentName = AGENT_NAMES[String(body.agentId ?? "")] ?? "le personnage";

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: anthropicHeaders(false),
      body: JSON.stringify({
        model,
        max_tokens: 800,
        system: helperSystem(op, level, agentName),
        messages: [{ role: "user", content: text }],
      }),
    });
    if (!upstream.ok) {
      console.error("anthropic helper", upstream.status, await upstream.text());
      return json(502, { error: mapUpstream(upstream.status) });
    }
    const data = (await upstream.json()) as {
      stop_reason?: string;
      content?: { type: string; text?: string }[];
    };
    if (data.stop_reason === "refusal") {
      return json(502, { error: "Réponse bloquée par un filtre de sécurité." });
    }
    const out = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();
    return json(200, { text: out });
  }

  return json(400, { error: "Opération inconnue." });
});
