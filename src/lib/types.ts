// Types partagés de l'application ¡Charlemos!

export type CefrLevel = "A1" | "A1+" | "A2" | "B1";
export type LevelChoice = CefrLevel | "auto";

export interface VocabEntry {
  es: string;
  fr: string;
  agentId?: string;
  ts: number;
}

export interface MessageHelper {
  translation?: string;
  vocab?: { es: string; fr: string }[];
  suggestions?: string[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  /** Texte brut, marqueurs [[astuce]] / [[etapa]] / [[informe]] inclus */
  content: string;
  ts: number;
  /** Message d'erreur local (jamais renvoyé à l'API) */
  error?: boolean;
  /** Résultats des aides (traduction, vocabulaire, suggestions) mis en cache */
  helper?: MessageHelper;
}

export interface Conversation {
  messages: ChatMessage[];
  level: LevelChoice;
}

export interface Settings {
  apiKey: string;
  model: string;
  studentName: string;
  demoMode: boolean;
  theme: "light" | "dark";
}

export interface Progress {
  xp: number;
  streakCount: number;
  /** Dernier jour actif, format AAAA-MM-JJ (heure locale) */
  streakLast: string;
  badges: string[];
  msgCount: number;
  perAgent: Record<string, number>;
  missionsCompleted: number;
  /** Meilleur score de mission, sur 12 */
  bestMission: number;
}

export interface MissionInforme {
  total: number;
  max: number;
  comprension: number;
  expresion: number;
  lexico: number;
  subMax: number;
  insignia: string;
  consejo: string;
}

export interface AgentPalette {
  /** Dégradé d'avatar / d'en-tête, ex. "from-sky-400 to-blue-600" */
  grad: string;
  softBg: string;
  chipBg: string;
  text: string;
  bubble: string;
  button: string;
}

export interface AgentDef {
  id: string;
  nombre: string;
  titulo: string;
  ciudad: string;
  flag: string;
  emoji: string;
  /** Pastille thématique affichée sur la carte (en français) */
  theme: string;
  levelLabel: string;
  defaultLevel: LevelChoice;
  /** Description de la mission pédagogique (en français, pour la carte) */
  descripcion: string;
  color: AgentPalette;
  ttsLang: string;
  maxTokens: number;
  isMission?: boolean;
  /** Premier message affiché à l'ouverture du chat (sans appel API) */
  starter: string;
  /** Bloc d'identité du system prompt */
  persona: string;
}
