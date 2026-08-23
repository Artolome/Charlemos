// Mode démo : réponses préenregistrées diffusées mot à mot, sans appel API.
// Permet de découvrir l'interface en classe ou avant d'avoir configuré une clé.
//
// Le mode démo est RÉACTIF pour les défis à bonne réponse (mission du Capitán,
// mini-reto du Profesor Chispa) : bonne réponse → on avance ; mauvaise →
// indice et « inténtalo otra vez » ; deuxième échec → la réponse est donnée
// et on continue (comme le vrai protocole IA). Le score final reflète les
// réussites réelles de l'élève.
//
// Limite connue : les conversations démo enregistrées AVANT cette version
// (où tout avançait sans vérification) peuvent se rejouer différemment ;
// il suffit de réinitialiser la conversation (bouton corbeille).

import type { AgentDef, ChatMessage } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------
// Analyse tolérante des réponses de l'élève
// ---------------------------------------------------------------

/** "¡NARANJA!" → "naranja" ; "está" → "esta" ; la ponctuation devient espace */
function normalize(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFD").toLowerCase()) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x0300 && cp <= 0x036f) continue; // accents décomposés
    if ((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9")) out += ch;
    else out += " ";
  }
  return out.replace(/\s+/g, " ").trim();
}

/** La réponse contient-elle l'un de ces mots entiers ? (accents/majuscules ignorés) */
function hasWord(answer: string, ...words: string[]): boolean {
  const n = ` ${normalize(answer)} `;
  return words.some((w) => n.includes(` ${normalize(w)} `));
}

/** « ?? », « no sé », « je ne sais pas quoi dire »... : l'élève est bloqué */
function isHelpless(raw: string): boolean {
  const n = normalize(raw);
  if (n.length < 2) return true;
  if (n.startsWith("je ne sais") || n.startsWith("no se que") || n.startsWith("nose que")) {
    return true;
  }
  return /^(no s?e|no lo s?e|nose|jsp|idk|no entiendo|no comprendo|euh+|heu+|help|ayuda|aide)$/.test(
    n,
  );
}

/** « ok », « merci », « 👍 »... : acquiescement poli, pas une réponse au défi */
function isSmallTalk(raw: string): boolean {
  const n = normalize(raw);
  return /^(ok(ay|i)?|d ?accord|merci( beaucoup)?|super|genial|cool|vale|gracias|si|oui|yes|jaja(ja)*|lol|mdr|bien|muy bien|bravo|top|guay|chevere|perfecto|entendido|vamos)$/.test(
    n,
  );
}

// ---------------------------------------------------------------
// Moteur de « quête » : suite d'étapes avec vérification des réponses
// ---------------------------------------------------------------

interface QuestStep {
  /** Message qui pose le défi (contient le marqueur [[etapa]] si mission) */
  ask: string;
  /** La réponse de l'élève est-elle acceptée ? */
  check: (answer: string) => boolean;
  /** Relance bienveillante à la 1re mauvaise réponse (ne fait pas avancer) */
  hint: string;
  /** Au 2e échec : la bonne réponse est donnée, puis on continue */
  reveal: string;
  /** Réaction à une bonne réponse, suivie du défi suivant */
  success: string;
  /** Autres options proposées : si la réponse les contient AUSSI, on demande de choisir */
  distractors?: string[];
  /** false = étape d'introduction, non comptée dans le score */
  scored?: boolean;
}

interface Quest {
  steps: QuestStep[];
  /** Message final ; results = score par étape comptée (2, 1 ou 0 points) */
  final: (results: number[]) => string;
}

/** Texte de la question sans les marqueurs, pour détecter un copier-coller */
function stripForEcho(s: string): string {
  return normalize(s.replace(/\[\[[^\]]*\]\]/g, " "));
}

/**
 * Rejoue de façon déterministe tous les messages de l'élève pour retrouver
 * l'état de la quête, et renvoie la réponse au dernier message.
 */
function runQuest(quest: Quest, userMessages: string[]): string {
  let pos = -1; // -1 = en attente du premier message (le briefing est le message d'accueil)
  let attempts = 0;
  let results: number[] = [];
  let reply = quest.steps[0]?.ask ?? "";

  for (const raw of userMessages) {
    if (pos === -1 || pos >= quest.steps.length) {
      // Lancement de la quête (ou relance après la fin)
      pos = 0;
      attempts = 0;
      results = [];
      reply = quest.steps[0].ask;
      continue;
    }
    const step = quest.steps[pos];
    const na = normalize(raw);

    // Copier-coller de la question : on ne le compte pas comme une réponse
    if (na.length >= 20 && stripForEcho(step.ask).includes(na)) {
      reply = `Jeje, ¡esa es MI pregunta! 😄 Ahora te toca responder a ti:\n\n${step.ask}`;
      continue;
    }
    const passes = step.check(raw);
    // « ok », « merci »... après un succès : on repose le défi sans pénalité
    if (!passes && isSmallTalk(raw)) {
      reply = `¡Vale! 😊 Seguimos:\n\n${step.ask}`;
      continue;
    }
    // L'élève hésite entre les options (« ¿azul o naranja? ») : il doit choisir !
    const nSpaced = ` ${na} `;
    const hesitates =
      passes &&
      step.distractors !== undefined &&
      hasWord(raw, ...step.distractors) &&
      (raw.includes("?") || nSpaced.includes(" o ") || nSpaced.includes(" ou "));
    if (hesitates) {
      reply = `¡Las dos opciones no, elige una sola! 😄\n\n${step.ask}`;
      continue;
    }

    if (passes) {
      if (step.scored !== false) results.push(attempts === 0 ? 2 : 1);
      pos++;
      attempts = 0;
      const next = pos < quest.steps.length ? quest.steps[pos].ask : quest.final(results);
      reply = [step.success, next].filter(Boolean).join("\n\n");
    } else if (attempts === 0) {
      attempts = 1;
      reply = step.hint;
    } else {
      if (step.scored !== false) results.push(0);
      pos++;
      attempts = 0;
      const next = pos < quest.steps.length ? quest.steps[pos].ask : quest.final(results);
      reply = [step.reveal, next].filter(Boolean).join("\n\n");
    }
  }
  return reply;
}

// ---------------------------------------------------------------
// Mission de démonstration du Capitán (6 étapes vérifiées)
// ---------------------------------------------------------------

// Mots espagnols acceptés comme « vraie phrase » à l'étape du fantasma
const PALABRAS_ACTIVIDADES = [
  "gusta",
  "encanta",
  "juego",
  "jugar",
  "leer",
  "leo",
  "ver",
  "veo",
  "escuchar",
  "escucho",
  "musica",
  "futbol",
  "baloncesto",
  "natacion",
  "nadar",
  "deporte",
  "videojuegos",
  "juegos",
  "amigos",
  "amigas",
  "familia",
  "bailar",
  "bailo",
  "cantar",
  "canto",
  "dibujar",
  "dibujo",
  "dormir",
  "duermo",
  "como",
  "cocino",
  "cocinar",
  "paseo",
  "pasear",
  "monto",
  "bici",
  "tele",
  "television",
  "series",
  "parque",
  "playa",
];

const MISSION_QUEST: Quest = {
  steps: [
    {
      ask: "¡Excelente elección, agente! 🧭 Misión « Operación Calavera »: la ofrenda del Día de Muertos ha desaparecido y debes recuperarla.\n[[etapa: 1/6]]\nPrimera prueba, en el aeropuerto de México: preséntate al guardia. Escribe tu nombre y tu edad EN ESPAÑOL para pasar el control.",
      check: (a) => hasWord(a, "llamo", "tengo", "soy", "años"),
      hint: "El guardia no te entiende... 😅 Pista: en español se dice « Me llamo ... y tengo ... años ». ¡Inténtalo otra vez!",
      reveal:
        "El guardia te ayuda con una sonrisa: se dice « Me llamo Léo y tengo 12 años ». Te deja pasar por esta vez. 🛂",
      success: "¡Perfecto, agente! El guardia te deja pasar. 🛂",
    },
    {
      ask: "[[etapa: 2/6]]\nEn el mercado, la abuela Rosa te da una llave si respondes: ¿de qué color es la flor del Día de Muertos, el cempasúchil? ¿Azul, naranja o negro?",
      check: (a) => hasWord(a, "naranja"),
      distractors: ["azul", "negro"],
      hint: "Mmm, no exactamente... 🌼 Pista: es el color del sol y de las mandarinas. ¡Inténtalo otra vez!",
      reveal:
        "Te ayudo, agente: el cempasúchil es NARANJA, como el sol. 🌼 La abuela te da la llave de todos modos.",
      success: "¡Correcto! ¡Naranja como el sol! 🌼 La abuela sonríe y te da una llave.",
    },
    {
      ask: "[[etapa: 3/6]]\nCon la llave de la abuela llegas a la puerta del museo, pero hay también un código: corrige esta frase para abrir → « Yo soy 12 años ».",
      check: (a) => hasWord(a, "tengo"),
      distractors: ["soy"],
      hint: "¡Casi! 🚪 Pista: en espagnol, pour dire l'âge on utilise le verbe AVOIR (tener), pas être. ¡Inténtalo otra vez!",
      reveal:
        "La puerta te lo susurra: « Yo TENGO 12 años » — tener, ¡el verbo de la edad! Se abre lentamente... 🚪",
      success: "¡Eso es! « Yo TENGO 12 años » — la puerta se abre... 🚪",
    },
    {
      ask: "[[etapa: 4/6]]\nDentro del museo ves una copia gigante de un cuadro en blanco y negro que representa la guerra, pintado por Picasso. ¿Cómo se llama? Pista: empieza por G...",
      check: (a) => hasWord(a, "guernica", "guernika"),
      hint: "El cuadro espera... 🖼️ Pista: empieza por « Guer- » y es el nombre de un pueblo del País Vasco. ¡Inténtalo otra vez!",
      reveal:
        "Es el GUERNICA, de Picasso (1937) — el original está en el Museo Reina Sofía, en Madrid. El cuadro te deja pasar de todos modos. 🖼️",
      success:
        "¡Exacto, el Guernica! (El original está en el Museo Reina Sofía, en Madrid.) El cuadro te deja pasar. 🖼️",
    },
    {
      ask: "[[etapa: 5/6]]\nEl fantasma del museo habla contigo: « ¿Qué te gusta hacer el fin de semana? » Responde con una frase completa en español.",
      check: (a) => !isHelpless(a) && hasWord(a, ...PALABRAS_ACTIVIDADES),
      hint: "El fantasma espera una frase completa EN ESPAÑOL... 👻 Pista: empieza por « Me gusta... ». ¡Inténtalo!",
      reveal:
        "El fantasma te sopla una respuesta: « Me gusta jugar con mis amigos ». 👻 ¡La próxima vez te toca a ti!",
      success: "¡Muy bien, agente! Al fantasma le encanta tu respuesta. 👻",
    },
    {
      ask: "[[etapa: 6/6]]\nÚltima prueba: encuentra el intruso → manzana, plátano, naranja, mochila. ¿Cuál no es una fruta?",
      check: (a) => hasWord(a, "mochila"),
      distractors: ["manzana", "platano", "naranja"],
      hint: "Piensa, agente... 🍎 Pista: tres se comen, una se lleva a la escuela. ¡Inténtalo otra vez!",
      reveal: "¡Era la MOCHILA! No es una fruta: es el « sac à dos ». 🎒 ¡Misión terminada!",
      success:
        "¡MISIÓN CUMPLIDA, agente! 🎉 La mochila no es una fruta, ¡y la ofrenda está a salvo!",
    },
  ],
  final: (results) => {
    const total = results.reduce((s, r) => s + r, 0);
    const comprension = Math.min(4, Math.ceil(total / 3));
    const expresion = Math.min(4, Math.round(total / 3));
    const lexico = Math.max(0, Math.min(4, total - comprension - expresion));
    const insignia =
      total >= 11
        ? "Agente Estrella"
        : total >= 8
          ? "Agente Valiente"
          : total >= 5
            ? "Detective en Formación"
            : "Joven Promesa";
    const consejo = results.includes(0)
      ? "Revois les réponses données pendant la mission, puis retente-la pour battre ton score !"
      : results.includes(1)
        ? "Bravo ! Avec un petit indice tu trouves tout — vise le sans-faute à la prochaine mission."
        : "Sans-faute du premier coup — tu es prêt·e pour une vraie mission générée par l'IA !";
    return `¡Has viajado, has hablado y has demostrado tu español, agente!\n[[informe: total=${total}/12 | comprension=${comprension}/4 | expresion=${expresion}/4 | lexico=${lexico}/4 | insignia=${insignia} | consejo=${consejo}]]\n¿Quieres intentarlo otra vez? Escríbeme y la misión recomienza. (Mission de démonstration — en mode classe ou avec une clé API, les missions sont générées par l'IA.)`;
  },
};

// ---------------------------------------------------------------
// Mini-reto de démonstration du Profesor Chispa (ser / estar)
// ---------------------------------------------------------------

const CHISPA_QUEST: Quest = {
  steps: [
    {
      // Introduction : explication + proposition de reto (aucune vérification)
      ask: "¡Excelente pregunta! ⚡ SER = la carte d'identité (ce qu'on est toujours) : « Soy francés / francesa ». ESTAR = la météo du moment : « Estoy cansado(a) » (là, maintenant). Ejemplo: « Soy alto » vs « Estoy triste ». ¿Quieres un mini-reto para practicar?",
      check: () => true,
      hint: "",
      reveal: "",
      success: "¡Genial, vamos allá!",
      scored: false,
    },
    {
      ask: "¡Mini-reto! ⚡ Pregunta 1 de 3: complète avec ser ou estar → « Yo ___ estudiante ». À toi !",
      check: (a) => hasWord(a, "soy"),
      distractors: ["estoy"],
      hint: "¡Casi! ⚡ Indice : être étudiant, c'est ton identité (carte d'identité → SER). Conjugue ser avec « yo »... Réessaie !",
      reveal: "La réponse était « SOY » : « Yo soy estudiante » (identité → ser).",
      success: "¡Muy bien! « Soy estudiante » ✔ (c'est ce que tu es : carte d'identité).",
    },
    {
      ask: "Pregunta 2 de 3: « Hoy yo ___ contento (o contenta) » (aujourd'hui = état du moment). À toi !",
      check: (a) => hasWord(a, "estoy"),
      distractors: ["soy"],
      hint: "¡Uy! Indice : « aujourd'hui » = la météo du moment → ESTAR. Conjugue estar avec « yo »... Réessaie !",
      reveal: "C'était « ESTOY » : « Hoy estoy contento (o contenta) » (état du moment → estar).",
      success: "¡Perfecto! « Estoy contento » ✔.",
    },
    {
      ask: "Última pregunta: « Madrid ___ en España ». Attention, piège célèbre ! 😉",
      check: (a) => hasWord(a, "esta", "está"),
      distractors: ["es"],
      hint: "¡Es el piège! 😄 Indice : pour situer un lieu, on utilise toujours ESTAR — même si Madrid ne bouge jamais. Réessaie !",
      reveal:
        "La réponse était « ESTÁ » : « Madrid está en España » — pour la localisation, toujours estar.",
      success: "¡Impresionante! « Madrid ESTÁ en España » ✔ — tu as évité le piège célèbre !",
    },
  ],
  final: (results) => {
    const stars = results.map((r) => (r === 2 ? "⚡" : r === 1 ? "✨" : "·")).join("");
    const points = results.reduce((s, r) => s + (r === 2 ? 1 : r === 1 ? 0.5 : 0), 0);
    const pts = String(points).replace(".", ",");
    const bravo =
      points >= 2.5 ? "¡Genial!" : points >= 1.5 ? "¡Muy bien!" : "¡Buen comienzo, sigue así!";
    return `Puntuación: ${stars} — ${pts} sobre 3. ${bravo}\n\n¿Otro reto? Escríbeme y recomenzamos. (En mode démo je repose les mêmes questions — en mode classe, les défis sont générés par l'IA et changent à chaque fois !)`;
  },
};

// ---------------------------------------------------------------
// Conversations libres (Mateo, Valeria, Diego, Lucía)
// ---------------------------------------------------------------

const DEMO_REPLIES: Record<string, string[]> = {
  mateo: [
    "¡Genial! 😃 Yo estoy en 2º de ESO. Mi asignatura favorita es Educación Física. ¿Cuál es tu asignatura favorita?",
    "¡Qué guay! A mí no me gustan las Matemáticas... En el recreo como un bocadillo de tortilla. ¿Qué comes tú en el recreo?\n[[astuce: On dit « me gusta el fútbol », pas « me gusta fútbol ».]]",
    "¡Qué rico! En España comemos a las dos y media. ¿A qué hora comes tú?",
    "¿En serio? ¡Es muy pronto! 😄 Yo tengo una perra, se llama Canela. ¿Tienes una mascota (un animal de compagnie)?",
  ],
  valeria: [
    "¡Órale (waouh)! ¿Sabes qué es el Día de Muertos? El 1 y el 2 de noviembre, en México, hacemos altares con flores naranjas, el cempasúchil. ¿En Francia hay una fiesta parecida?",
    "¡Qué interesante! 🦋 Yo he visitado las montañas donde duermen las mariposas monarca. Son millones y vuelan desde Canadá. ¿Te gustan los animales?\n[[astuce: « He visitado » = j'ai visité (pretérito perfecto).]]",
    "La neta (la vérité), mi comida favorita es el mole, una salsa con chocolate y chile. ¿Cuál es tu comida favorita?",
    "¡Padrísimo! Un día quiero ver el Machu Picchu, en Perú. ¿Qué país quieres visitar tú?",
  ],
  diego: [
    "Se cuenta que en el museo del Prado hay un cuadro muy misterioso: Las Meninas de Velázquez. El pintor está DENTRO de su propio cuadro, mirándote a ti... 👀 ¿Te parece bonito o extraño?",
    "¡A mí también! ¿Sabes qué pasó entonces? Picasso miró Las Meninas y pintó ¡58 versiones! Los artistas se inspiran unos a otros. ¿Te gusta dibujar o pintar?\n[[astuce: « Me gusta dibujar » : gustar + infinitif pour dire ce qu'on aime faire.]]",
    "Entonces te va a encantar esta historia: en España, el Ratoncito Pérez toma los dientes de los niños, ¡como la petite souris! ¿Qué sientes: sorpresa o alegría?",
    "El flamenco es alegría y tristeza al mismo tiempo. Mi tía Carmen baila con un vestido rojo precioso. ¿Qué música escuchas tú?",
  ],
  lucia: [
    "¡Qué chévere! 😍 A mí me encanta la música, canto en un coro. En verano, en Bogotá, escucho vallenato con mis primos. ¿Qué música escuchas tú?",
    "¡No te creo! ¡A mí también! 😄 En Colombia decimos « ¡qué chévere! », en España dicen « ¡qué guay! ». ¿Prefieres los videojuegos o las series?\n[[astuce: « Prefiero » = je préfère (verbe preferir, e→ie).]]",
    "Yo tengo un loro que se llama Kiwi 🦜 y repite « ¡hola, hola! » todo el día. ¿Tienes una mascota o quieres una?",
    "¡Jajaja! Cuéntame: ¿qué vas a hacer este fin de semana? Yo voy a jugar al vóley con mis amigas.",
  ],
};

// Si l'élève est bloqué (« ?? », « no sé »...), on encourage au lieu d'avancer
const ENCOURAGEMENTS: Record<string, string> = {
  mateo:
    "¡No pasa nada! 😊 Responde con una frase corta, por ejemplo « Me gusta... » o « Mi asignatura favorita es... ». Astuce : le bouton 💡 en bas te propose des idées de réponse. ¿Lo intentas?",
  valeria:
    "Tranquilo, tranquila. 🦋 Puedes responder con pocas palabras, por ejemplo « No conozco México » o « Me gusta la playa ». Astuce : le bouton 💡 en bas te donne des idées. ¿Lo intentas?",
  diego:
    "No pasa nada. 🎨 Puedes responder simplemente « sí », « no » o « me gusta ». Astuce : le bouton 💡 en bas te souffle des réponses. ¿Lo intentas?",
  lucia:
    "¡Tranqui! 💌 Responde con una palabra si quieres: « música », « deporte », « videojuegos »... Astuce : le bouton 💡 en bas te donne des idées. ¿Qué eliges?",
};
const ENCOURAGEMENT_LIST = Object.values(ENCOURAGEMENTS);

/** Vrai pour un encouragement complet OU interrompu en cours de diffusion */
function isEncouragementContent(content: string): boolean {
  return content.length > 0 && ENCOURAGEMENT_LIST.some((e) => e.startsWith(content));
}

// ---------------------------------------------------------------
// Point d'entrée du moteur démo
// ---------------------------------------------------------------

/** Calcule la réponse démo (exposé séparément pour les tests) */
export function demoReplyFor(agent: AgentDef, history: ChatMessage[]): string {
  const userMessages = history.filter((m) => m.role === "user").map((m) => m.content);

  if (agent.id === "capitan") return runQuest(MISSION_QUEST, userMessages);
  if (agent.id === "chispa") return runQuest(CHISPA_QUEST, userMessages);

  const last = userMessages[userMessages.length - 1] ?? "";
  if (isHelpless(last)) return ENCOURAGEMENTS[agent.id] ?? ENCOURAGEMENTS.mateo;

  const replies = DEMO_REPLIES[agent.id] ?? DEMO_REPLIES.mateo;
  // On ne compte ni les encouragements, ni les bulles d'erreur, ni les bulles
  // vides : ils ne font pas avancer le fil de la conversation préenregistrée.
  const count = history.filter(
    (m) =>
      m.role === "assistant" &&
      !m.error &&
      m.content.trim().length > 0 &&
      !isEncouragementContent(m.content),
  ).length;
  return replies[Math.max(0, count - 1) % replies.length];
}

export async function demoStream(
  agent: AgentDef,
  history: ChatMessage[],
  onDelta: (fullText: string) => void,
  isAborted: () => boolean,
): Promise<string> {
  if (isAborted()) return "";
  const full = demoReplyFor(agent, history);
  await sleep(450);
  if (isAborted()) return "";
  let acc = "";
  for (const chunk of full.split(/(\s+)/)) {
    if (isAborted()) return acc;
    acc += chunk;
    onDelta(acc);
    if (chunk.trim()) await sleep(38);
  }
  return acc;
}

// ---------------------------------------------------------------
// Aides en mode démo
// ---------------------------------------------------------------

export function demoTranslation(): string {
  return "📝 Mode démo : active une clé API dans les réglages pour obtenir la vraie traduction française de ce message.";
}

const DEMO_VOCAB: Record<string, { es: string; fr: string }[]> = {
  mateo: [
    { es: "la asignatura", fr: "la matière (scolaire)" },
    { es: "el recreo", fr: "la récréation" },
    { es: "el bocadillo", fr: "le sandwich" },
    { es: "la mascota", fr: "l'animal de compagnie" },
  ],
  valeria: [
    { es: "el Día de Muertos", fr: "le jour des Morts" },
    { es: "la mariposa", fr: "le papillon" },
    { es: "la ofrenda", fr: "l'autel des morts / l'offrande" },
    { es: "el cempasúchil", fr: "l'œillet d'Inde (fleur orange)" },
  ],
  diego: [
    { es: "el cuadro", fr: "le tableau" },
    { es: "el pintor", fr: "le peintre" },
    { es: "la leyenda", fr: "la légende" },
    { es: "extraño / extraña", fr: "étrange" },
  ],
  lucia: [
    { es: "¡qué chévere!", fr: "trop cool ! (Colombie)" },
    { es: "el coro", fr: "la chorale" },
    { es: "el loro", fr: "le perroquet" },
    { es: "el fin de semana", fr: "le week-end" },
  ],
  chispa: [
    { es: "ser", fr: "être (identité, permanent)" },
    { es: "estar", fr: "être (état, lieu, moment)" },
    { es: "cansado / cansada", fr: "fatigué(e)" },
    { es: "contento / contenta", fr: "content(e)" },
  ],
  capitan: [
    { es: "la prueba", fr: "l'épreuve" },
    { es: "la pista", fr: "l'indice / la piste" },
    { es: "la llave", fr: "la clé" },
    { es: "el intruso", fr: "l'intrus" },
  ],
};

export function demoVocab(agentId: string): { es: string; fr: string }[] {
  return DEMO_VOCAB[agentId] ?? DEMO_VOCAB.mateo;
}

const DEMO_SUGGESTIONS: Record<string, string[]> = {
  mateo: [
    "Mi asignatura favorita es el español.",
    "¿Cuántos años tienes?",
    "Me gusta el fútbol, ¿y a ti?",
  ],
  valeria: [
    "No conozco México, ¡cuéntame!",
    "¿Qué es el Día de Muertos?",
    "En Francia comemos crêpes en febrero.",
  ],
  diego: [
    "Sí, ¡cuéntame la historia!",
    "Me parece muy bonito.",
    "¿Quién es tu artista favorito?",
  ],
  lucia: [
    "Me gusta la música pop.",
    "¿Cómo es Colombia?",
    "Este fin de semana voy a jugar con mis amigos.",
  ],
  chispa: ["¡Sí, quiero un mini-reto!", "Yo soy estudiante.", "¿Puedes explicar otra vez?"],
  capitan: ["¡Sí, estoy listo!", "Elijo la misión número 1.", "¿Puedes darme una pista?"],
};

export function demoSuggestions(agentId: string): string[] {
  return DEMO_SUGGESTIONS[agentId] ?? DEMO_SUGGESTIONS.mateo;
}
