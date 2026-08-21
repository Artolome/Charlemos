// Mode démo : réponses préenregistrées diffusées mot à mot, sans appel API.
// Permet de découvrir l'interface en classe ou avant d'avoir configuré une clé.

import type { AgentDef, ChatMessage } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  chispa: [
    "¡Excelente pregunta! ⚡ SER = la carte d'identité (ce qu'on est toujours) : « Soy francés ». ESTAR = la météo du moment : « Estoy cansado » (là, maintenant). Ejemplo: « Soy alto » vs « Estoy triste ». ¿Quieres un mini-reto para practicar?",
    "¡Mini-reto! ⚡ Pregunta 1 de 3: complète avec ser ou estar → « Yo ___ estudiante ». À toi !",
    "¡Muy bien! « Soy estudiante » ✔ (c'est ce que tu es, carte d'identité). Pregunta 2 de 3: « Hoy yo ___ contento » (aujourd'hui = moment présent). À toi !",
    "¡Perfecto! « Estoy contento » ✔. Última pregunta: « Madrid ___ en España ». Attention, piège célèbre ! 😉",
    "¡Casi! On dit « Madrid ESTÁ en España » : pour la localisation, toujours estar, même si Madrid ne bouge pas. 😄 Puntuación: ⚡⚡✨ ¡2,5 sobre 3, genial! ¿Otro reto o una pregunta de gramática?",
  ],
};

const DEMO_MISSION: string[] = [
  "¡Excelente elección, agente! 🧭 Misión « Operación Calavera »: la ofrenda del Día de Muertos ha desaparecido y debes recuperarla.\n[[etapa: 1/6]]\nPrimera prueba, en el aeropuerto de México: preséntate al guardia. Escribe tu nombre y tu edad EN ESPAÑOL para pasar el control.",
  "¡Perfecto, agente! El guardia te deja pasar. 🛂\n[[etapa: 2/6]]\nEn el mercado, la abuela Rosa te da una pista si respondes: ¿de qué color es la flor del Día de Muertos, el cempasúchil? ¿Azul, naranja o negro?",
  "¡Correcto! ¡Naranja como el sol! 🌼 La abuela sonríe y te da una llave.\n[[etapa: 3/6]]\nEn la puerta del museo hay un código: corrige esta frase para abrir → « Yo soy 12 años ».",
  "¡Eso es! « Yo TENGO 12 años » — la puerta se abre... 🚪\n[[etapa: 4/6]]\nDentro del museo ves un cuadro gigante en blanco y negro que representa la guerra, pintado por Picasso. ¿Cómo se llama? Pista: empieza por G...",
  "¡Exacto, el Guernica! El cuadro te deja pasar. 🖼️\n[[etapa: 5/6]]\nEl fantasma del museo habla contigo: « ¿Qué te gusta hacer el fin de semana? » Responde con una frase completa en español.",
  "¡Muy bien, agente! Al fantasma le encanta tu respuesta. 👻\n[[etapa: 6/6]]\nÚltima prueba: encuentra el intruso → manzana, plátano, naranja, mochila. ¿Cuál no es una fruta?",
  "¡MISIÓN CUMPLIDA, agente! 🎉 La mochila no es una fruta, ¡y la ofrenda está a salvo! Has viajado, has hablado y has demostrado tu español.\n[[informe: total=10/12 | comprension=4/4 | expresion=3/4 | lexico=3/4 | insignia=Agente Estrella | consejo=Continue à faire des phrases complètes et révise le verbe tener.]]\n¿Quieres otra misión, agente? (Ceci était la mission de démonstration — active une clé API pour des missions générées par l'IA.)",
];

function pickDemoReply(agent: AgentDef, history: ChatMessage[]): string {
  if (agent.id === "capitan") {
    // Compte les étapes déjà envoyées depuis le dernier rapport de mission
    let lastInforme = -1;
    history.forEach((m, i) => {
      if (m.role === "assistant" && m.content.includes("[[informe")) lastInforme = i;
    });
    const etapasDone = history.filter(
      (m, i) => i > lastInforme && m.role === "assistant" && m.content.includes("[[etapa"),
    ).length;
    if (lastInforme >= 0 && etapasDone === 0 && history[history.length - 1]?.role === "user") {
      return DEMO_MISSION[0];
    }
    return DEMO_MISSION[Math.min(etapasDone, DEMO_MISSION.length - 1)];
  }
  const replies = DEMO_REPLIES[agent.id] ?? DEMO_REPLIES.mateo;
  const count = history.filter((m) => m.role === "assistant").length;
  return replies[Math.max(0, count - 1) % replies.length];
}

export async function demoStream(
  agent: AgentDef,
  history: ChatMessage[],
  onDelta: (fullText: string) => void,
  isAborted: () => boolean,
): Promise<string> {
  const full = pickDemoReply(agent, history);
  await sleep(450);
  let acc = "";
  for (const chunk of full.split(/(\s+)/)) {
    if (isAborted()) return acc;
    acc += chunk;
    onDelta(acc);
    if (chunk.trim()) await sleep(38);
  }
  return acc;
}

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
  chispa: ["¡Sí, quiero un mini-reto!", "Soy estudiante.", "¿Puedes explicar otra vez?"],
  capitan: ["¡Sí, estoy listo!", "Elijo la misión número 1.", "¿Puedes darme una pista?"],
};

export function demoSuggestions(agentId: string): string[] {
  return DEMO_SUGGESTIONS[agentId] ?? DEMO_SUGGESTIONS.mateo;
}
