// Moteur IA — deux modes :
//  · mode local : appels directs à l'API Anthropic depuis le navigateur
//    (la clé est saisie dans les réglages et reste sur l'appareil) ;
//  · mode classe (Supabase configuré) : les appels passent par la fonction
//    Edge « charlemos-ia », qui détient la clé côté serveur et vérifie le
//    compte élève. Rien à saisir sur les postes.

import Anthropic from "@anthropic-ai/sdk";
import type { AgentDef, ChatMessage, LevelChoice, Settings } from "./types";
import { buildSystemPrompt } from "./agents";
import { parseAssistantContent } from "./markers";
import { demoStream, demoSuggestions, demoTranslation, demoVocab } from "./demo";
import { getFunctionAuth, supabaseEnabled } from "./supabase";

export interface ModelOption {
  id: string;
  label: string;
  hint: string;
  /** Le paramètre output_config.effort est-il accepté par ce modèle ? */
  effort: boolean;
}

export const MODELS: ModelOption[] = [
  {
    id: "claude-opus-5",
    label: "Claude Opus 5",
    hint: "Qualité maximale (réglage par défaut)",
    effort: true,
  },
  {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    hint: "Excellent équilibre qualité / coût",
    effort: true,
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    hint: "Le plus rapide et le plus économique",
    effort: false,
  },
];

function modelOption(id: string): ModelOption {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

export class RefusalError extends Error {
  constructor() {
    super("Réponse bloquée par les filtres de sécurité.");
    this.name = "RefusalError";
  }
}

/** Erreur renvoyée par la fonction Edge (mode classe) */
export class ProxyError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProxyError";
  }
}

function getClient(settings: Settings): Anthropic {
  return new Anthropic({
    apiKey: settings.apiKey,
    // Mode local uniquement : la clé appartient à l'utilisateur et reste
    // sur sa machine. C'est le mode prévu par le SDK pour ce cas d'usage.
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
  });
}

function toApiMessages(history: ChatMessage[]): Anthropic.MessageParam[] {
  const clean = history.filter((m) => !m.error && m.content.trim().length > 0);
  const windowed = clean.slice(-20); // fenêtre glissante pour limiter les coûts
  const msgs: Anthropic.MessageParam[] = windowed.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  // L'API exige que le premier message soit de rôle "user" ; or nos
  // conversations commencent par le message d'accueil de l'agent.
  if (msgs.length === 0 || msgs[0].role === "assistant") {
    msgs.unshift({ role: "user", content: "¡Hola!" });
  }
  return msgs;
}

export interface StreamOptions {
  settings: Settings;
  agent: AgentDef;
  level: LevelChoice;
  history: ChatMessage[];
  onDelta: (fullText: string) => void;
  /** Reçoit une fonction qui interrompt le streaming en cours */
  registerAbort?: (abort: () => void) => void;
}

/**
 * Génère la réponse de l'agent en streaming et renvoie le texte complet.
 */
export async function streamAgentReply(opts: StreamOptions): Promise<string> {
  const { settings, agent, level, history, onDelta, registerAbort } = opts;

  if (settings.demoMode) {
    let aborted = false;
    registerAbort?.(() => {
      aborted = true;
    });
    return demoStream(agent, history, onDelta, () => aborted);
  }

  if (supabaseEnabled) return proxyChat(opts);

  const client = getClient(settings);
  const model = modelOption(settings.model);
  const base = {
    model: model.id,
    max_tokens: agent.maxTokens,
    system: [
      {
        type: "text" as const,
        text: buildSystemPrompt(agent, level, settings.studentName),
        // Le system prompt est stable pendant toute la conversation :
        // le mettre en cache réduit fortement le coût des tours suivants.
        cache_control: { type: "ephemeral" as const },
      },
    ],
    messages: toApiMessages(history),
    ...(model.effort ? { output_config: { effort: "low" } } : {}),
  };

  const run = async (withFallbacks: boolean): Promise<string> => {
    let acc = "";
    const onText = (_delta: string, snapshot: string) => {
      acc = snapshot;
      onDelta(snapshot);
    };
    try {
      let final: { stop_reason: string | null };
      if (withFallbacks) {
        // Sur Claude Opus 5, on active les fallbacks serveur : si la réponse
        // est refusée par un filtre, l'API relance automatiquement la même
        // requête sur un modèle de repli dans le même appel.
        const stream = client.beta.messages.stream({
          ...base,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        registerAbort?.(() => stream.abort());
        stream.on("text", onText);
        final = await stream.finalMessage();
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stream = client.messages.stream(base as any);
        registerAbort?.(() => stream.abort());
        stream.on("text", onText);
        final = await stream.finalMessage();
      }
      if (final.stop_reason === "refusal") throw new RefusalError();
      if (final.stop_reason === "max_tokens") acc += " …";
      return acc;
    } catch (e) {
      if (e instanceof Anthropic.APIUserAbortError) return acc; // arrêt volontaire
      throw e;
    }
  };

  const useFallbacks = model.id === "claude-opus-5";
  try {
    return await run(useFallbacks);
  } catch (e) {
    // Si le paramètre beta de fallback n'est pas accepté (évolution d'API),
    // on retente une fois la même requête sans lui.
    if (useFallbacks && e instanceof Anthropic.BadRequestError) {
      return run(false);
    }
    throw e;
  }
}

// ---------- Mode classe : appels via la fonction Edge ----------

async function proxyErrorFrom(res: Response): Promise<ProxyError> {
  let message = "";
  try {
    const data = (await res.json()) as { error?: string };
    if (typeof data.error === "string") message = data.error;
  } catch {
    /* corps non JSON */
  }
  return new ProxyError(res.status, message);
}

async function proxyChat(opts: StreamOptions): Promise<string> {
  const auth = await getFunctionAuth();
  if (!auth) throw new ProxyError(401, "");

  const controller = new AbortController();
  opts.registerAbort?.(() => controller.abort());

  let res: Response;
  try {
    res = await fetch(auth.url, {
      method: "POST",
      headers: auth.headers,
      signal: controller.signal,
      body: JSON.stringify({
        op: "chat",
        agentId: opts.agent.id,
        level: opts.level,
        model: opts.settings.model,
        messages: toApiMessages(opts.history),
      }),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return "";
    throw new Anthropic.APIConnectionError({ message: "réseau indisponible" });
  }
  if (!res.ok) throw await proxyErrorFrom(res);
  if (!res.body) throw new ProxyError(500, "");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let acc = "";
  let refusal = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let evt: {
          type?: string;
          delta?: { type?: string; text?: string; stop_reason?: string };
          error?: { message?: string };
        };
        try {
          evt = JSON.parse(payload);
        } catch {
          continue;
        }
        if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
          acc += evt.delta.text ?? "";
          opts.onDelta(acc);
        } else if (evt.type === "message_delta" && evt.delta?.stop_reason === "refusal") {
          refusal = true;
        } else if (evt.type === "error") {
          throw new ProxyError(500, evt.error?.message ?? "");
        }
      }
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return acc; // arrêt volontaire
    throw e;
  }
  if (refusal) throw new RefusalError();
  return acc;
}

async function proxyQuick(payload: Record<string, unknown>): Promise<string> {
  const auth = await getFunctionAuth();
  if (!auth) throw new ProxyError(401, "");
  const res = await fetch(auth.url, {
    method: "POST",
    headers: auth.headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await proxyErrorFrom(res);
  const data = (await res.json()) as { text?: string };
  return String(data.text ?? "").trim();
}

/** Transforme une erreur d'API en message clair pour l'élève / le professeur */
export function friendlyError(e: unknown): string {
  if (e instanceof RefusalError) {
    return "La réponse a été bloquée par un filtre de sécurité. Reprenons la conversation sur un autre sujet ! 🙂";
  }
  if (e instanceof ProxyError) {
    if (e.message) return e.message;
    if (e.status === 401) return "Session expirée : reconnecte-toi à ton compte.";
    if (e.status === 429) {
      return "Doucement ! ⏳ Attends quelques secondes avant de renvoyer un message.";
    }
    return `Le serveur de la classe a renvoyé une erreur (${e.status}). Réessaie.`;
  }
  if (e instanceof Anthropic.AuthenticationError) {
    return "Clé API invalide ou manquante. Ouvre les réglages ⚙️ pour vérifier la clé.";
  }
  if (e instanceof Anthropic.RateLimitError) {
    return "Trop de demandes en même temps. Attends quelques secondes puis réessaie.";
  }
  if (e instanceof Anthropic.BadRequestError) {
    if (/credit|billing/i.test(e.message)) {
      return "Le crédit du compte API est épuisé. Le professeur doit recharger le compte sur console.anthropic.com.";
    }
    return "La demande n'a pas pu être traitée. Réessaie, ou réinitialise la conversation.";
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return "Pas de connexion à l'API. Vérifie la connexion Internet puis réessaie.";
  }
  if (e instanceof Anthropic.APIError) {
    if (e.status === 529) {
      return "Le service est momentanément saturé. Réessaie dans quelques secondes.";
    }
    return `Erreur du service (${e.status ?? "?"}). Réessaie dans un instant.`;
  }
  return "Une erreur inattendue s'est produite. Réessaie.";
}

// ---------- Aides intégrées (traduction, vocabulaire, suggestions) ----------

async function quickCompletion(
  settings: Settings,
  system: string,
  user: string,
  maxTokens = 800,
): Promise<string> {
  const client = getClient(settings);
  const response = await client.messages.create({
    model: settings.model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  if (response.stop_reason === "refusal") throw new RefusalError();
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

function parseJsonArray<T>(raw: string): T[] {
  let text = raw.replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  text = text.slice(start, end + 1);
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export async function translateMessage(
  settings: Settings,
  text: string,
): Promise<string> {
  if (settings.demoMode) return demoTranslation();
  const clean = parseAssistantContent(text).text;
  if (supabaseEnabled) {
    return proxyQuick({ op: "translate", text: clean, model: settings.model });
  }
  return quickCompletion(
    settings,
    "Tu traduis en français, pour un collégien, des messages issus d'un chat d'apprentissage de l'espagnol. Réponds UNIQUEMENT par la traduction française, naturelle et fidèle, sans commentaire.",
    clean,
  );
}

export async function extractVocab(
  settings: Settings,
  agent: AgentDef,
  text: string,
  level: LevelChoice,
): Promise<{ es: string; fr: string }[]> {
  if (settings.demoMode) return demoVocab(agent.id);
  const clean = parseAssistantContent(text).text;
  const raw = supabaseEnabled
    ? await proxyQuick({ op: "vocab", text: clean, level, model: settings.model })
    : await quickCompletion(
        settings,
        `Tu extrais le vocabulaire clé d'un message en espagnol pour un élève de collège (niveau ${level === "auto" ? "A1-A2" : level}). Choisis 4 à 6 mots ou expressions UTILES et réutilisables du message (avec l'article pour les noms). Réponds UNIQUEMENT avec un tableau JSON valide, sans texte autour, au format : [{"es":"la mochila","fr":"le sac à dos"}]`,
        clean,
        600,
      );
  return parseJsonArray<{ es: string; fr: string }>(raw).filter(
    (v) => typeof v?.es === "string" && typeof v?.fr === "string",
  );
}

export async function suggestReplies(
  settings: Settings,
  agent: AgentDef,
  history: ChatMessage[],
  level: LevelChoice,
): Promise<string[]> {
  if (settings.demoMode) return demoSuggestions(agent.id);
  const recent = history
    .filter((m) => !m.error)
    .slice(-6)
    .map(
      (m) =>
        `${m.role === "assistant" ? agent.nombre : "Élève"}: ${parseAssistantContent(m.content).text}`,
    )
    .join("\n");
  const raw = supabaseEnabled
    ? await proxyQuick({
        op: "suggest",
        text: recent,
        level,
        agentId: agent.id,
        model: settings.model,
      })
    : await quickCompletion(
        settings,
        `Un élève de collège (niveau ${level === "auto" ? "A1-A2" : level}) est bloqué dans une conversation en espagnol avec ${agent.nombre}. Propose exactement 3 réponses courtes (12 mots maximum chacune) que l'élève pourrait envoyer maintenant : une réponse simple à la question posée, une variante avec une petite question en retour, une variante avec une opinion ou un détail. Niveau de langue strictement adapté. Réponds UNIQUEMENT avec un tableau JSON de 3 chaînes, sans texte autour : ["...","...","..."]`,
        `Conversation récente :\n${recent}`,
        500,
      );
  return parseJsonArray<string>(raw)
    .filter((s) => typeof s === "string" && s.trim().length > 0)
    .slice(0, 3);
}
