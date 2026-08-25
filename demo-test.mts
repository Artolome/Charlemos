// Test temporaire du moteur démo réactif (exécuté avec tsx, non commité)
import { demoReplyFor } from "./src/lib/demo";
import { agentById } from "./src/lib/agents";
import type { ChatMessage } from "./src/lib/types";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log("OK   " + label);
  else {
    failures++;
    console.log("FAIL " + label + (detail ? "\n     → " + detail : ""));
  }
}

function play(agentId: string, userMsgs: string[]): string[] {
  const agent = agentById(agentId);
  const history: ChatMessage[] = [
    { id: "s", role: "assistant", content: agent.starter, ts: 0 },
  ];
  const replies: string[] = [];
  for (const u of userMsgs) {
    history.push({ id: "u" + replies.length, role: "user", content: u, ts: 0 });
    const r = demoReplyFor(agent, history);
    replies.push(r);
    history.push({ id: "a" + replies.length, role: "assistant", content: r, ts: 0 });
  }
  return replies;
}

// ---- 1) Mission sans faute ----
{
  const r = play("capitan", [
    "1",
    "Me llamo Léo y tengo 12 años",
    "naranja",
    "Yo tengo 12 años",
    "¡Es el Guernica!",
    "Me gusta jugar al fútbol",
    "la mochila",
  ]);
  check("mission parfaite : étape 1 posée", r[0].includes("[[etapa: 1/6]]"));
  check("mission parfaite : étape 2 après présentation", r[1].includes("[[etapa: 2/6]]"));
  check("mission parfaite : étape 6 atteinte", r[5].includes("[[etapa: 6/6]]"));
  check("mission parfaite : informe total=12/12", r[6].includes("total=12/12"), r[6]);
  check("mission parfaite : insignia Agente Estrella", r[6].includes("Agente Estrella"));
  check(
    "mission parfaite : sous-scores 4/4",
    r[6].includes("comprension=4/4") && r[6].includes("expresion=4/4") && r[6].includes("lexico=4/4"),
    r[6],
  );
}

// ---- 2) Mission avec erreurs, indices et réponses données ----
{
  const r = play("capitan", [
    "sorpresa", //                     → étape 1
    "je m'appelle Léo", //             mauvais → indice (pas d'etapa)
    "Me llamo Léo y tengo 12 años", // bon (2e essai → 1 pt) → étape 2
    "azul", //                         mauvais → indice
    "NARANJA!", //                     bon (1 pt) → étape 3
    "yo tengo doce años", //           bon (2 pts) → étape 4
    "no sé", //                        mauvais → indice
    "dalí", //                         2e échec → réponse donnée (0 pt) → étape 5
    "Me gusta leer", //                bon (2 pts) → étape 6
    "manzana", //                      mauvais → indice
    "la mochila", //                   bon (1 pt) → informe : total 7/12
    "otra misión", //                  relance → étape 1
  ]);
  check("mission erreurs : indice présentation sans [[etapa]]", r[1].includes("no te entiende") && !r[1].includes("[[etapa"));
  check("mission erreurs : avance après 2e essai", r[2].includes("[[etapa: 2/6]]"));
  check("mission erreurs : indice couleur (mandarinas)", r[3].includes("mandarinas"));
  check("mission erreurs : réponse donnée au 2e échec (GUERNICA)", r[7].includes("GUERNICA") && r[7].includes("[[etapa: 5/6]]"), r[7]);
  check("mission erreurs : informe total=7/12", r[10].includes("total=7/12"), r[10]);
  check("mission erreurs : insignia Detective", r[10].includes("Detective en Formación"), r[10]);
  check("mission erreurs : consejo « Revois »", r[10].includes("Revois les réponses"));
  check("mission erreurs : relance → étape 1", r[11].includes("[[etapa: 1/6]]"));
}

// ---- 3) Mini-reto de Chispa ----
{
  const r = play("chispa", [
    "c'est quoi ser et estar ?", // → explication + proposition
    "sí", //                        → question 1
    "es", //                        mauvais → indice
    "soy", //                       bon (2e essai) → question 2
    "estoy", //                     bon → question 3
    "es", //                        mauvais → indice
    "no sé", //                     2e échec → réponse donnée + score
  ]);
  check("chispa : explication ser/estar d'abord", r[0].includes("carte d'identité"));
  check("chispa : question 1 posée", r[1].includes("Pregunta 1 de 3"));
  check("chispa : indice Q1 (pas d'avance)", r[2].includes("Indice") && !r[2].includes("Pregunta 2"));
  check("chispa : avance vers Q2", r[3].includes("Pregunta 2 de 3"));
  check("chispa : avance vers Q3", r[4].includes("Última pregunta"));
  check("chispa : score final 1,5 sobre 3", r[6].includes("1,5 sobre 3"), r[6]);
  check("chispa : étoiles ✨⚡·", r[6].includes("✨⚡·"), r[6]);
}

// ---- 4) Réponse « está » avec accent acceptée ----
{
  const r = play("chispa", ["hola", "reto", "soy", "estoy", "Madrid está en España"]);
  check("chispa : « está » (accent) accepté au piège", r[4].includes("Impresionante"), r[4]);
}

// ---- 5) Mateo : dialogue guidé, indices et relances ----
{
  const r = play("mateo", [
    "??", //                indice « Me llamo »
    "Léo", //               prénom accepté → asignatura
    "le sport", //          français → indice modèle
    "historia", //          accepté → recreo
    "una manzana", //       accepté → l'heure
    "a las 12", //          accepté → mascota
    "tengo un perro", //    accepté → au revoir
    "hola otra vez", //     relance → question du prénom
  ]);
  check("mateo : « ?? » → indice Me llamo", r[0].includes("Me llamo"), r[0]);
  check("mateo : prénom → question asignatura", r[1].includes("asignatura favorita"), r[1]);
  check("mateo : réponse française → modèle espagnol", r[2].includes("Mi asignatura favorita es"), r[2]);
  check("mateo : puis avance vers le recreo", r[3].includes("bocadillo de tortilla"), r[3]);
  check("mateo : avance vers l'heure", r[4].includes("A qué hora"), r[4]);
  check("mateo : avance vers la mascota", r[5].includes("Canela"), r[5]);
  check("mateo : fin du dialogue", r[6].includes("Hasta luego"), r[6]);
  check("mateo : relance → question du prénom", r[7].includes("Cómo te llamas"), r[7]);
}

// ---- 5bis) Mateo : « ok » n'est pas un prénom ----
{
  const r = play("mateo", ["ok"]);
  check("mateo : « ok » → on repose la question", r[0].includes("Seguimos"), r[0]);
}

// ---- 5ter) Lucía : dialogue guidé complet ----
{
  const r = play("lucia", [
    "me gusta la musica",
    "escucho rap",
    "prefiero las series",
    "quiero un perro",
    "voy a jugar al futbol",
    "hola",
  ]);
  check("lucía : goûts → question musique", r[0].includes("vallenato"), r[0]);
  check("lucía : musique → chévere/guay", r[1].includes("chévere"), r[1]);
  check("lucía : préférence → Kiwi", r[2].includes("Kiwi"), r[2]);
  check("lucía : mascota → fin de semana", r[3].includes("fin de semana"), r[3]);
  check("lucía : week-end → au revoir", r[4].includes("Kiwi dice"), r[4]);
  check("lucía : relance → question des goûts", r[5].includes("Qué te gusta a ti"), r[5]);
}

// ---- 5quater) Diego : hésitation bonito o extraño ----
{
  const r = play("diego", ["sí", "bonito o extraño ?", "me parece bonito"]);
  check("diego : sí → Las Meninas", r[0].includes("Las Meninas"), r[0]);
  check("diego : « bonito o extraño ? » → choisir", r[1].includes("elige una sola"), r[1]);
  check("diego : puis avance (58 versiones)", r[2].includes("58 versiones"), r[2]);
}

// ---- 6) « no » n'est PAS traité comme blocage (réponse légitime) ----
{
  const r = play("valeria", ["no"]);
  check("valeria : « no » suit le fil normal", r[0].includes("Día de Muertos"), r[0]);
}

// ---- 7) Copier-coller de la question : pas de points gratuits ----
{
  const paste =
    "En el mercado, la abuela Rosa te da una llave si respondes: ¿de qué color es la flor del Día de Muertos, el cempasúchil? ¿Azul, naranja o negro?";
  const r = play("capitan", [
    "1",
    "Me llamo Léo y tengo 12 años",
    paste, //                        copier-coller → pas une réponse
    "naranja", //                    vraie réponse → 2 points quand même
    "Yo tengo 12 años",
    "el Guernica",
    "Me gusta jugar al fútbol",
    "la mochila",
  ]);
  check("écho : copier-coller détecté", r[2].includes("MI pregunta"), r[2]);
  check("écho : la vraie réponse garde 2 points (12/12)", r[7].includes("total=12/12"), r[7]);
}

// ---- 8) « ok » / « merci » ne brûlent pas d'essai ----
{
  const r = play("capitan", [
    "1",
    "Me llamo Léo y tengo 12 años",
    "ok", //                         acquiescement → on repose le défi
    "merci !", //                    idem
    "naranja", //                    vraie réponse → 2 points
    "Yo tengo 12 años",
    "el Guernica",
    "Me gusta leer",
    "la mochila",
  ]);
  check("smalltalk : « ok » → on repose la question", r[2].includes("Seguimos") && r[2].includes("[[etapa: 2/6]]"), r[2]);
  check("smalltalk : aucun point perdu (12/12)", r[8].includes("total=12/12"), r[8]);
}

// ---- 9) « azul o naranja ? » : il faut choisir ----
{
  const r = play("capitan", [
    "1",
    "Me llamo Léo y tengo 12 años",
    "azul o naranja ?", //           hésitation → choisir, sans pénalité
    "naranja",
  ]);
  check("hésitation : « azul o naranja ? » → choisir", r[2].includes("elige una sola"), r[2]);
  check("hésitation : puis « naranja » → succès", r[3].includes("¡Correcto!"), r[3]);
}

// ---- 10) Étape 5 : le français seul ne passe plus ----
{
  const r = play("capitan", [
    "1",
    "Me llamo Léo y tengo 12 años",
    "naranja",
    "Yo tengo 12 años",
    "el Guernica",
    "lol mdr ptdr xd", //            → indice, pas de félicitations
  ]);
  check("étape 5 : « lol mdr ptdr xd » → indice", r[5].includes("EN ESPAÑOL"), r[5]);
  const r2 = play("capitan", [
    "1",
    "Me llamo Léo y tengo 12 años",
    "naranja",
    "Yo tengo 12 años",
    "el Guernica",
    "je ne sais pas quoi dire", //   élève bloqué → indice, pas 2 points
  ]);
  check("étape 5 : « je ne sais pas quoi dire » → indice", r2[5].includes("EN ESPAÑOL"), r2[5]);
}

// ---- 11) Réponse-correction « tengo, no soy » acceptée (pas d'hésitation) ----
{
  const r = play("capitan", [
    "1",
    "Me llamo Léo y tengo 12 años",
    "naranja",
    "se dice tengo, no soy", //      contient les deux mots mais pas « o »/« ? »
  ]);
  check("étape 3 : « tengo, no soy » accepté", r[3].includes("la puerta se abre"), r[3]);
}

// ---- 12) Chispa : « es o está ? » au piège → choisir ----
{
  const r = play("chispa", ["hola", "sí", "soy", "estoy", "es o está ?", "está"]);
  check("chispa : « es o está ? » → choisir", r[4].includes("elige una sola"), r[4]);
  check("chispa : puis « está » → Impresionante", r[5].includes("Impresionante"), r[5]);
}

// ---- 13) Nouveau texte : gallicisme corrigé et Reina Sofía mentionné ----
{
  const r = play("capitan", [
    "1",
    "Me llamo Léo y tengo 12 años",
    "azul",
    "negro", //                      2e échec → réponse donnée
    "Yo tengo 12 años",
    "no sé",
    "tampoco", //                    2e échec → réponse donnée
  ]);
  check("texte : « de todos modos » (plus de « igualmente »)", r[3].includes("de todos modos") && !r[3].includes("igualmente"), r[3]);
  check("texte : le Reina Sofía cité au reveal du Guernica", r[6].includes("Reina Sofía"), r[6]);
}

// ---- 17) Recopier la phrase-modèle est une BONNE réponse (pas un écho) ----
{
  const r = play("mateo", [
    "Léo",
    "Mi asignatura favorita es Educación Física", // phrase-modèle exacte du personnage
    "Como un bocadillo de tortilla", //             idem
  ]);
  check("modèle : « Mi asignatura favorita es E.F. » accepté", r[1].includes("recreo"), r[1]);
  check("modèle : « Como un bocadillo » accepté", r[2].includes("A qué hora"), r[2]);
  const r2 = play("lucia", [
    "me gusta la musica",
    "escucho rap",
    "prefiero las series",
    "tengo un gato",
    "Voy a jugar al vóley con mis amigas", // phrase de Lucía réutilisée : parfaite !
  ]);
  check("modèle : « Voy a jugar al vóley... » accepté", r2[4].includes("Kiwi dice"), r2[4]);
}

// ---- 18) « ¿y tú? » en retour n'est plus grondé ----
{
  const r = play("lucia", ["me gusta la musica", "escucho rap", "Prefiero las series, ¿y tú?"]);
  check("« Prefiero las series, ¿y tú? » accepté", r[2].includes("Kiwi"), r[2]);
}

// ---- 19) « no entiendo » = détresse, jamais une réponse ----
{
  const r = play("valeria", ["no entiendo"]);
  check("valeria : « no entiendo » → indice, pas d'avance", r[0].includes("Sí o no"), r[0]);
}

// ---- 20) « ¿Cómo? » (pardon ?) n'est plus pris pour « je mange » ----
{
  const r = play("mateo", ["Léo", "historia", "¿Cómo?"]);
  check("mateo : « ¿Cómo? » au goûter → indice", r[2].includes("Como una fruta"), r[2]);
}

// ---- 21) Coller la liste entière de l'intrus → choisir ----
{
  const r = play("capitan", [
    "1",
    "Me llamo Léo y tengo 12 años",
    "naranja",
    "Yo tengo 12 años",
    "el Guernica",
    "Me gusta leer",
    "manzana plátano naranja mochila",
  ]);
  check("intrus : liste collée → choisir", r[6].includes("elige una sola"), r[6]);
}

console.log(failures ? `\n❌ ${failures} échec(s)` : "\n✅ Tous les tests passent");
process.exit(failures ? 1 : 0);
