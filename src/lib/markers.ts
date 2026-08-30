// Analyse des marqueurs pédagogiques insérés par les agents dans leurs réponses :
//   [[astuce: ...]]                → badge de correction bienveillante
//   [[etapa: 3/6]]                 → progression de mission (Capitán Misión)
//   [[informe: total=9/12 | ...]]  → rapport final de mission

import type { MissionInforme } from "./types";

const TIP_RE = /\[\[\s*astuce\s*:\s*([^\]]+?)\s*\]\]/gi;
const ETAPA_RE = /\[\[\s*etapa\s*:\s*(\d+)\s*\/\s*(\d+)\s*\]\]/gi;
const INFORME_RE = /\[\[\s*informe\s*:\s*([^\]]+?)\s*\]\]/i;
// Marqueur incomplet en fin de texte pendant le streaming, ex. "[[astu"
const PARTIAL_RE = /\[\[[^\]]*$/;

export interface ParsedMessage {
  text: string;
  tip?: string;
  etapa?: { n: number; total: number };
  informe?: MissionInforme;
}

function parseScore(value: string | undefined, fallbackMax: number): [number, number] {
  if (!value) return [0, fallbackMax];
  const m = value.match(/(\d+)\s*\/\s*(\d+)/);
  if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
  const n = parseInt(value, 10);
  return [Number.isFinite(n) ? n : 0, fallbackMax];
}

export function parseInforme(raw: string): MissionInforme {
  const fields: Record<string, string> = {};
  for (const part of raw.split("|")) {
    const idx = part.indexOf("=");
    if (idx > 0) {
      fields[part.slice(0, idx).trim().toLowerCase()] = part.slice(idx + 1).trim();
    }
  }
  const [total, max] = parseScore(fields["total"], 12);
  const [comprension, subMax] = parseScore(fields["comprension"], 4);
  const [expresion] = parseScore(fields["expresion"], 4);
  const [lexico] = parseScore(fields["lexico"], 4);
  return {
    total,
    max: max || 12,
    comprension,
    expresion,
    lexico,
    subMax: subMax || 4,
    insignia: fields["insignia"] || "Agente en formación",
    consejo: fields["consejo"] || "Continue à t'entraîner régulièrement !",
  };
}

export function parseAssistantContent(raw: string, streaming = false): ParsedMessage {
  const result: ParsedMessage = { text: raw };

  let tip: string | undefined;
  let etapa: { n: number; total: number } | undefined;
  let informe: MissionInforme | undefined;

  // En cas d'astuces multiples (ex. astuce corrective du mode démo ajoutée
  // en fin de message + astuce intégrée au défi suivant), on garde la
  // DERNIÈRE : c'est celle qui porte sur la réponse de l'élève.
  let text = raw.replace(TIP_RE, (_m, captured: string) => {
    tip = captured.trim();
    return "";
  });

  text = text.replace(ETAPA_RE, (_m, n: string, total: string) => {
    etapa = { n: parseInt(n, 10), total: parseInt(total, 10) };
    return "";
  });

  const informeMatch = text.match(INFORME_RE);
  if (informeMatch) {
    informe = parseInforme(informeMatch[1]);
    text = text.replace(INFORME_RE, "");
  }

  // Un « [[... » jamais fermé en fin de texte n'est jamais un contenu
  // légitime : on le retire aussi hors streaming (cas du bouton Stop
  // cliqué au milieu d'un marqueur, le fragment est ensuite persisté).
  void streaming;
  text = text.replace(PARTIAL_RE, "");

  // Nettoie les lignes vides laissées par les marqueurs
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  result.text = text;
  result.tip = tip;
  result.etapa = etapa;
  result.informe = informe;
  return result;
}
