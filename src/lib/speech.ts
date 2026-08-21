// Synthèse vocale (TTS) et reconnaissance vocale (STT) via la Web Speech API.
// TTS : lecture des messages et du vocabulaire avec une voix espagnole.
// STT : dicter sa réponse en espagnol (Chrome/Edge principalement).

let voicesWarmed = false;

function warmVoices() {
  if (voicesWarmed || typeof speechSynthesis === "undefined") return;
  voicesWarmed = true;
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener?.("voiceschanged", () => {
    speechSynthesis.getVoices();
  });
}

export function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices();
  const spanish = voices.filter((v) => v.lang.toLowerCase().startsWith("es"));
  if (spanish.length === 0) return undefined;
  const score = (v: SpeechSynthesisVoice) => {
    let s = 0;
    if (v.lang.toLowerCase() === lang.toLowerCase()) s += 4;
    if (v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase())) s += 1;
    if (/google|natural|neural/i.test(v.name)) s += 2;
    if (v.localService) s += 1;
    return s;
  };
  return [...spanish].sort((a, b) => score(b) - score(a))[0];
}

/** Nettoie un texte avant lecture : marqueurs, emojis, ponctuation décorative */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/\[\[[^\]]*\]\]?/g, " ")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[*_#`~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function speak(
  text: string,
  lang = "es-ES",
  onEnd?: () => void,
): SpeechSynthesisUtterance | null {
  if (!ttsSupported()) return null;
  warmVoices();
  speechSynthesis.cancel();
  const cleaned = cleanForSpeech(text);
  if (!cleaned) {
    onEnd?.();
    return null;
  }
  const utter = new SpeechSynthesisUtterance(cleaned);
  const voice = pickVoice(lang);
  if (voice) {
    utter.voice = voice;
    utter.lang = voice.lang;
  } else {
    utter.lang = lang;
  }
  utter.rate = 0.92; // légèrement ralenti pour les apprenants
  utter.pitch = 1.02;
  if (onEnd) {
    utter.onend = onEnd;
    utter.onerror = onEnd;
  }
  speechSynthesis.speak(utter);
  return utter;
}

export function stopSpeaking() {
  if (ttsSupported()) speechSynthesis.cancel();
}

// ---------- Reconnaissance vocale ----------

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

type RecognitionCtor = new () => RecognitionLike;

function getRecognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function sttSupported(): boolean {
  return getRecognitionCtor() !== undefined;
}

export interface Recognizer {
  start(): void;
  stop(): void;
}

/**
 * Crée un recognizer espagnol. onText reçoit le texte transcrit
 * (final=false pour l'aperçu en direct, final=true à la fin d'un segment).
 */
export function createRecognizer(
  onText: (text: string, final: boolean) => void,
  onEnd: () => void,
  onError: (message: string) => void,
): Recognizer | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = "es-ES";
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  rec.onresult = (event) => {
    let interim = "";
    let finalText = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (finalText) onText(finalText.trim(), true);
    else if (interim) onText(interim.trim(), false);
  };
  rec.onend = onEnd;
  rec.onerror = (e) => {
    const err = e.error ?? "inconnu";
    if (err === "not-allowed" || err === "service-not-allowed") {
      onError("Micro non autorisé : vérifie les permissions du navigateur.");
    } else if (err === "no-speech") {
      onError("Je n'ai rien entendu, réessaie en parlant plus fort. 🎤");
    } else if (err !== "aborted") {
      onError("La dictée n'a pas fonctionné, réessaie.");
    }
    onEnd();
  };
  return {
    start: () => {
      try {
        rec.start();
      } catch {
        /* déjà démarré */
      }
    },
    stop: () => {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    },
  };
}
