// Tests du moteur démo réactif (exécutés avec : npx tsx demo-test.mts)
import { demoReplyFor, detectForeign } from "./src/lib/demo";
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

// ---- 23) Langue : une réponse en français ne passe JAMAIS ----
{
  // Mot-clé partagé (« sandwich ») dans une phrase française → refusé
  const r = play("mateo", [
    "Léo",
    "historia",
    "Je mange un sandwich", //  français malgré « sandwich » → réorientation
    "Como un sandwich", //      espagnol → avance
    "je mange à 12h30", //      français malgré les chiffres → réorientation
    "a las 12h30", //           espagnol → avance
  ]);
  check("langue : « Je mange un sandwich » refusé", r[2].includes("francés") && r[2].includes("Como una fruta"), r[2]);
  check("langue : pas d'avance sur le français", !r[2].includes("A qué hora"), r[2]);
  check("langue : « Como un sandwich » accepté ensuite", r[3].includes("A qué hora"), r[3]);
  check("langue : « je mange à 12h30 » refusé malgré les chiffres", r[4].includes("francés"), r[4]);
  check("langue : « a las 12h30 » accepté", r[5].includes("Canela"), r[5]);
}

// ---- 24) Langue : prénom en français / en anglais chez Mateo ----
{
  const r = play("mateo", ["je m'appelle Léa", "Me llamo Léa"]);
  check("langue : « je m'appelle Léa » → réorientation + modèle", r[0].includes("francés") && r[0].includes("Me llamo"), r[0]);
  check("langue : « Me llamo Léa » accepté ensuite", r[1].includes("asignatura"), r[1]);
  const r2 = play("mateo", ["My name is Emma"]);
  check("langue : « My name is Emma » → inglés", r2[0].includes("inglés"), r2[0]);
  const r3 = play("mateo", ["1234"]);
  check("langue : « 1234 » n'est pas un prénom → indice", r3[0].includes("Me llamo"), r3[0]);
}

// ---- 25) Langue : « J'écoute du rap » refusé malgré « rap » ----
{
  const r = play("lucia", ["Me gusta la música", "J'écoute du rap", "escucho rap"]);
  check("langue : « J'écoute du rap » refusé", r[1].includes("francés") && r[1].includes("Escucho pop"), r[1]);
  check("langue : « escucho rap » accepté ensuite", r[2].includes("chévere"), r[2]);
}

// ---- 26) Langue : « il y a Halloween » refusé chez Valeria ----
{
  const r = play("valeria", [
    "No, no conozco México",
    "il y a Halloween en France", // français malgré « Halloween » → réorientation
    "Sí, hay una fiesta: Halloween",
  ]);
  check("langue : « il y a Halloween » refusé", r[1].includes("francés"), r[1]);
  check("langue : « Sí, hay una fiesta » accepté ensuite", r[2].includes("mariposa"), r[2]);
  const r2 = play("valeria", ["non"]);
  check("langue : « non » → réorientation vers « No »", r2[0].includes("francés") && r2[0].includes("No, no conozco"), r2[0]);
}

// ---- 27) Langue : mission du Capitán (français puis anglais, score) ----
{
  const r = play("capitan", [
    "1",
    "Me llamo Léo y tengo 12 años",
    "naranja",
    "Yo tengo 12 años",
    "C'est le Guernica", //        français → refusé, indice
    "Es el Guernica", //           espagnol (2e essai → 1 pt)
    "I like to play football", //  anglais → refusé, indice
    "Me gusta jugar al fútbol", // espagnol (2e essai → 1 pt)
    "la mochila",
  ]);
  check("langue : « C'est le Guernica » refusé", r[4].includes("francés") && !r[4].includes("[[etapa: 5/6]]"), r[4]);
  check("langue : « Es el Guernica » accepté (2e essai)", r[5].includes("[[etapa: 5/6]]"), r[5]);
  check("langue : « I like to play football » → inglés", r[6].includes("inglés"), r[6]);
  check("langue : score final 10/12", r[8].includes("total=10/12"), r[8]);
}

// ---- 28) Langue : chez Chispa aussi ----
{
  const r = play("chispa", ["hola", "sí", "je suis étudiant", "soy estudiante"]);
  check("chispa : « je suis étudiant » refusé", r[2].includes("francés") && !r[2].includes("Pregunta 2"), r[2]);
  check("chispa : « soy estudiante » accepté (2e essai)", r[3].includes("Pregunta 2 de 3"), r[3]);
}

// ---- 29bis) Langue : « bonjour » et autres mots français isolés ----
{
  const r = play("mateo", ["bonjour", "Me llamo Hugo"]);
  check("langue : « bonjour » → réorientation en espagnol", r[0].includes("francés") && r[0].includes("Me llamo"), r[0]);
  check("langue : puis « Me llamo Hugo » accepté", r[1].includes("asignatura"), r[1]);
  const r2 = play("mateo", ["Léo", "les maths"]);
  check("langue : « les maths » → réorientation + modèle", r2[1].includes("francés") && r2[1].includes("Mi asignatura favorita es"), r2[1]);
  const r3 = play("mateo", ["Léo", "historia", "jai un chat 🐱"]);
  check("langue : « jai un chat » (SMS sans apostrophe) refusé", r3[2].includes("francés"), r3[2]);
  const r4 = play("capitan", [
    "1",
    "Me llamo Léo y tengo 12 años",
    "orange", //  la couleur en français → réorientation, pas l'indice seul
  ]);
  check("langue : « orange » → réorientation vers naranja", r4[2].includes("francés") && r4[2].includes("mandarinas"), r4[2]);
  const r5 = play("capitan", [
    "1",
    "Me llamo Léo y tengo 12 años",
    "naranja",
    "il faut dire tengo", // phrase française contenant la bonne réponse → refusée
    "tengo",
  ]);
  check("langue : « il faut dire tengo » refusé malgré « tengo »", r5[3].includes("francés") && !r5[3].includes("[[etapa: 4/6]]"), r5[3]);
  check("langue : puis « tengo » accepté", r5[4].includes("[[etapa: 4/6]]"), r5[4]);
}

// ---- 29ter) « hola » seul est une salutation, pas un prénom ----
{
  const r = play("mateo", ["hola", "Me llamo Léa"]);
  check("salut : « hola » → on repose la question sans avancer", r[0].includes("Seguimos") && r[0].includes("Cómo te llamas"), r[0]);
  check("salut : puis « Me llamo Léa » accepté", r[1].includes("asignatura"), r[1]);
  const r2 = play("capitan", ["1", "Me llamo Léo y tengo 12 años", "buenos días"]);
  check("salut : « buenos días » mi-mission → on repose le défi", r2[2].includes("Seguimos"), r2[2]);
}

// ---- 29) Langue : tolérance et non-régressions ----
{
  // Un gallicisme isolé dans une phrase espagnole reste accepté
  const r = play("capitan", ["1", "Me llamo Léo et tengo 12 años"]);
  check("langue : un seul « et » dans une phrase espagnole toléré", r[1].includes("[[etapa: 2/6]]"), r[1]);
  // « oui » seul reste un acquiescement poli (on repose le défi)
  const r2 = play("capitan", ["1", "Me llamo Léo y tengo 12 años", "oui"]);
  check("langue : « oui » seul → Seguimos", r2[2].includes("Seguimos"), r2[2]);
  // Une réponse espagnole imparfaite suit le chemin normal de l'indice
  const r3 = play("valeria", ["quiero tacos"]);
  check("langue : espagnol hors-sujet → indice normal, sans « francés »", !r3[0].includes("francés"), r3[0]);
}

// ---- 30) Classifieur de langue : table de régression ----
// Réponses d'élèves générées par IA puis vérifiées une à une ; chaque entrée
// documente le comportement attendu de detectForeign (null = acceptée).
{
  const table: [string, "fr" | "en" | null][] = [
    // — Français : à refuser, même avec un mot partagé ou attendu dedans —
    ["je mapelle Lucas", "fr"],
    ["moi c'est Emma", "fr"],
    ["jai douze ans", "fr"],
    ["moi chui Nathan", "fr"],
    ["histoire", "fr"],
    ["le sport", "fr"],
    ["jm bien la svt", "fr"],
    ["ma matiere preferee c'est l'anglais", "fr"],
    ["je mange un sandwich", "fr"],
    ["un croissant et du jus d'orange", "fr"],
    ["vers midi", "fr"],
    ["on mange a la cantine a 12h30", "fr"],
    ["j'ai un hamster", "fr"],
    ["jai un chat 🐱", "fr"],
    ["mon chien s'appelle Filou", "fr"],
    ["g 12 ans et demi", "fr"],
    ["orange", "fr"],
    ["c'est orange", "fr"],
    ["il faut dire tengo", "fr"],
    ["on dit tengo pas soy", "fr"],
    ["la réponse est estoy", "fr"],
    ["c'est le Guernica", "fr"],
    ["je vais jouer au foot avec mes copains ⚽", "fr"],
    ["samedi g un match de basket", "fr"],
    ["l'intrus c'est mochila", "fr"],
    ["je suis étudiant", "fr"],
    ["il y a halloween chez nous", "fr"],
    ["la toussaint cest un peu pareil je crois", "fr"],
    ["moi cest la pizza 🍕", "fr"],
    ["jadore les pates carbonara", "fr"],
    ["je veux aller au japon", "fr"],
    ["sa me fait plutot de la joie", "fr"],
    ["jecoute du rap surtout", "fr"],
    ["la musica moi jecoute du rap", "fr"],
    ["plutot les jeux video moi", "fr"],
    ["le japon", "fr"],
    ["un chat", "fr"],
    ["les maths", "fr"],
    ["foot", "fr"],
    ["douze", "fr"],
    ["bonjour", "fr"],
    ["non", "fr"],
    ["je mange a las doce au self", "fr"],
    ["je prefere les series a los videojuegos", "fr"],
    ["chui estudiante et je suis contenta", "fr"],
    ["ma comida favorita c'est les pates carbonara", "fr"],
    ["je m'appelle emma y tengo 12 ans", "fr"],
    ["la couleur c'est naranja je crois", "fr"],
    ["j'ai un perro qui s'appelle max 🐶", "fr"],
    // — Anglais : à refuser —
    ["My name is Emma and I'm twelve", "en"],
    ["im tom and i am 12 years old", "en"],
    ["history", "en"],
    ["i lisen to rap and pop", "en"],
    ["video games are way better than series", "en"],
    ["gonna visit my grandma on sunday", "en"],
    ["the flower is orange", "en"],
    ["dunno maybe japan or spain", "en"],
    ["the answer is tengo", "en"],
    ["you must say tengo not soy", "en"],
    ["guernica is a painting by picasso", "en"],
    ["i want to visit spain one day", "en"],
    ["we eat at 12", "en"],
    ["i like football", "en"],
    // — Espagnol (correct ou fautif) et réponses neutres : à accepter —
    ["me llamo hugo y tengo 12 anos", null],
    ["lucas", null],
    ["mi asignatura favorita es historia", null],
    ["como un bocadilo y una manzana", null],
    ["a las 12", null],
    ["12h30", null],
    ["tengo un perro se llama rex", null],
    ["escucho reggaeton", null],
    ["prefiero los videojuegos", null],
    ["el fin de semana voy a jugar al futbol", null],
    ["naranja", null],
    ["tengo", null],
    ["se dice tengo 12 anos", null],
    ["en francia hay halloween y navidad", null],
    ["es el guernica de picasso", null],
    ["soy estudiante", null],
    ["madrid esta en espana", null],
    ["mi comida favorita es la pizza", null],
    ["quiero visitar japon", null],
    ["yo soy 12 años", null], //                   faute d'apprenant : chemin normal
    ["mi asignatura favorito es matematicas", null],
    ["yo comer un bocadiyo en el recreo", null],
    ["la color del cempasuchil es naranga", null],
    ["el gernica es un cuadro de picaso", null],
    ["kiero visitar mexico y espana", null],
    ["si conosco un poco mexico", null],
    ["mi mascota es un perra negro", null],
    ["guernica me da mucha tristesa y sorpresa", null],
    ["me llamo hugo et tengo doce anos", null], // un seul gallicisme : toléré
    ["me llamo Lea et tengo 12 años", null],
    ["mi asignatura favorita es histoire", null],
    ["como una pomme en el recreo", null],
    ["tengo un chien se llama rex", null],
    ["me gusta el foot", null],
    ["el frances", null],
    ["pizza", null],
    ["sandwich", null],
    ["japon", null],
    ["picasso", null],
    ["emma", null],
    ["tres gatos", null],
    ["son las dos", null],
    ["me gusta la pizza ¿y tu?", null],
    ["si conozco", null],
    ["es bonito 😍", null],
    ["estoy contento car manana no hay clase", null],
    // — Découvertes de l'attaque boîte blanche (2e vague) —
    // Faux positifs corrigés : prénoms/noms français, espagnol correct
    ["Rose", null],
    ["Blanche", null],
    ["hugo blanc", null],
    ["Lucas Petit", null],
    ["un par de galletas", null],
    ["meriendo un par de galletas", null],
    ["has comido tacos", null],
    ["le doy galletas", null],
    ["le pongo agua", null],
    ["le doy pan y agua", null],
    ["le canto canciones", null],
    ["call of duty", null],
    ["clash of clans", null],
    ["juego a the legend of zelda", null],
    ["the weeknd", null],
    ["un snack y un zumo", null],
    ["la classe de historia", null],
    ["patatas frites", null],
    ["galletas y un jus", null],
    ["nado en la piscine", null],
    ["hago natation", null],
    ["America", null],
    ["me encan🎉ta la fies🎉ta", null], // emojis dans les mots
    ["est🥰oy contenta", null],
    // Contournements français corrigés
    ["vers 13h", "fr"],
    ["a peu pres 13h", "fr"],
    ["13h pile", "fr"],
    ["aucune idee", "fr"],
    ["franchement aucune idee", "fr"],
    ["svt", "fr"],
    ["eps", "fr"],
    ["arts plastiques", "fr"],
    ["la geo", "fr"],
    ["un perroquet", "fr"],
    ["un furet", "fr"],
    ["g faim", "fr"],
    ["g 1 hamster", "fr"],
    ["madeleines", "fr"],
    ["la raclette", "fr"],
    ["gratin dauphinois", "fr"],
    ["tacos sans hesiter", "fr"],
    ["mario kart surtout", "fr"],
    ["minecraft ou fortnite", "fr"],
    ["jregarde netflix", "fr"],
    ["plein de trucs", "fr"],
    ["de la pop coreenne", "fr"],
    ["grasse matinee", "fr"],
    ["balade en foret", "fr"],
    ["devoirs puis console", "fr"],
    ["que dalle", "fr"],
    ["mes cousins", "fr"],
    ["un peu stresse", "fr"],
    ["un peu fatigue", "fr"],
    ["jsuis stresse", "fr"],
    ["faut mettre tengo", "fr"],
    ["ser = permanent, estar = temporaire", "fr"],
    ["bombardement de guernica", "fr"],
    ["etats unis", "fr"],
    ["la norvege", "fr"],
    ["bof", "fr"],
    ["carrement", "fr"],
    ["16h30 chocolat", "fr"],
    ["jadooore lhistoiiire", "fr"], //  lettres étirées
    ["histoiiiiire geooooo", "fr"],
    ["jaimelefoot", "fr"], //           mots collés
    ["jemappellelea", "fr"],
    ["tu es mechant", "fr"],
    ["tu es qui", "fr"],
    // Charpente française + noms espagnols : refusé (égalité fr/es)
    ["c'est mi perro", "fr"],
    ["j'aime el futbol", "fr"],
    ["je veux visitar mexico", "fr"],
    ["mi perro est mignon", "fr"],
    ["j adore el espanol", "fr"],
    // Contournements anglais corrigés
    ["same", "en"],
    ["purple", "en"],
    ["light blue", "en"],
    ["an apple", "en"],
    ["chicken nuggets", "en"],
    ["juice", "en"],
    ["some chips", "en"],
    ["around noon", "en"],
    ["noon", "en"],
    ["lunchtime", "en"],
    ["almost 13", "en"],
    ["just turned 12", "en"],
    ["dogs", "en"],
    ["a bunny", "en"],
    ["drawing", "en"],
    ["art class", "en"],
    ["nothing much", "en"],
    ["just chilling", "en"],
    ["sleeping", "en"],
    ["netflix mostly", "en"],
    ["minecraft obviously", "en"],
    ["billie eilish songs", "en"],
    ["movies", "en"],
    ["happy", "en"],
    ["sad", "en"],
    ["kinda tired", "en"],
    ["bored", "en"],
    ["scared", "en"],
    ["about war", "en"],
    ["no clue", "en"],
    ["somewhere hot", "en"],
    ["only from movies", "en"],
    ["bruh", "en"],
    ["nah bro", "en"],
    ["videogames everyday", "en"],
    ["watchi🤣ng seri🤣es all wee🤣kend", "en"],
    // — Découvertes de l'attaque boîte blanche (3e vague) —
    // Faux positifs corrigés : prénoms, artistes, titres, emprunts, typos
    ["Jaime", null],
    ["jaime garcia", null],
    ["Madeleine", null],
    ["bad bunny", null],
    ["escucho bad bunny", null],
    ["me gusta bad bunny", null],
    ["karol g", null],
    ["escucho black pink", null],
    ["the sims", null],
    ["the legend of zelda", null],
    ["angry birds", null],
    ["candy crush", null],
    ["candy crush y fortnite", null],
    ["un hot dog", null],
    ["como hot dogs", null],
    ["de cena como un hot dog", null],
    ["un chocolat caliente", null],
    ["palomitas de mais", null],
    ["practico natation", null],
    ["practico equitation", null],
    ["m aburro", null],
    ["my divertido", null],
    ["bah que aburrido", null],
    ["escribo en un chat", null],
    ["mi merienda es un pain au chocolat", null],
    ["meriendo un pain au chocolat", null],
    ["N A R A N J A", null], //          lettres espacées pour le style
    ["m e g u s t a", null],
    // Charpente française : prime sur les noms espagnols qui suivent
    ["je bois un zumo de naranja y como galletas", "fr"],
    ["je joue a los videojuegos con mis amigos", "fr"],
    ["je prefere las matematicas y el espanol y la musica", "fr"],
    ["je veux manger una hamburguesa con patatas", "fr"],
    ["je mange a las doce y media", "fr"],
    ["je vais a madrid", "fr"],
    ["j'aime el futbol y el baloncesto", "fr"],
    ["tu es trop fort", "fr"],
    // Formats : apostrophe typographique, insécables, collages, étirements
    ["L’histoire", "fr"],
    ["l’espagnol", "fr"],
    ["Je mange une pomme", "fr"],
    ["sappellle Rex", "fr"],
    ["jaipasdanimal", "fr"],
    ["jemangeungateau", "fr"],
    ["jveuxunchien", "fr"],
    ["jai12ans", "fr"],
    ["g12ans", "fr"],
    ["12ans", "fr"],
    ["ilikefootball", "en"],
    ["12years", "en"],
    // Longue traîne française
    ["souvent", "fr"],
    ["de temps en temps", "fr"],
    ["environ 13h", "fr"],
    ["presque 13", "fr"],
    ["un chaton", "fr"],
    ["un chiot", "fr"],
    ["cochon dinde", "fr"],
    ["la paix", "fr"],
    ["la mort", "fr"],
    ["la sieste", "fr"],
    ["la plage", "fr"],
    ["la flemme", "fr"],
    ["petit dej", "fr"],
    ["tartines", "fr"],
    ["gaufres", "fr"],
    ["oklm", "fr"],
    ["jpp", "fr"],
    ["osef", "fr"],
    ["degoute", "fr"],
    ["la chine", "fr"],
    ["la coree", "fr"],
    ["la russie", "fr"],
    ["australie", "fr"],
    // Longue traîne anglaise
    ["who knows", "en"],
    ["whatever", "en"],
    ["nope", "en"],
    ["nearly 13", "en"],
    ["13 next month", "en"],
    ["midday", "en"],
    ["seven pm", "en"],
    ["math", "en"],
    ["sleep", "en"],
    ["homework", "en"],
    ["tv shows", "en"],
    ["got a goldfish", "en"],
    ["two turtles", "en"],
    ["everything tbh", "en"],
    ["mac n cheese", "en"],
    ["peanut butter", "en"],
    ["hungry", "en"],
    ["stressed", "en"],
    ["a little nervous", "en"],
    ["united states", "en"],
    ["one day", "en"],
    ["ser means to be", "en"],
    ["tengo means have", "en"],
    ["temporary", "en"],
    ["wrong verb", "en"],
    ["a bombing", "en"],
    ["boring", "en"],
    ["cartoons", "en"],
    ["fries", "en"],
    ["i live in mexico", "en"],
    ["i visited madrid", "en"],
    ["leo im 12", "en"],
    // — Découvertes de l'attaque boîte blanche (4e vague) —
    // Faux positifs corrigés : prénoms (Jairo), mots espagnols (cesta,
    // verte), fautes d'apprenant (tú es, y→i), titres, gallicisme unique
    ["me llamo jairo", null],
    ["soy jairo", null],
    ["mi amigo se llama jairo", null],
    ["una cesta de fruta", null],
    ["la fruta esta en la cesta", null],
    ["tu es mi mejor amigo", null],
    ["y tu es de mexico", null],
    ["tengo 12ans", null],
    ["si tengo casi 13ans", null],
    ["one piece", null],
    ["just dance", null],
    ["pokemon go", null],
    ["league of legends", null],
    ["la play", null],
    ["un conejo et un hamster", null],
    ["sabado et domingo", null],
    ["quesadillas et enchiladas", null],
    ["bailo i dibujo", null],
    ["trabajo i duermo", null],
    ["les visito en vacaciones", null],
    ["Un póney pequeño", null],
    ["Espero verte pronto", null],
    ["de color verte", null],
    ["tiempo livre", null],
    ["Duermo la sieste", null],
    ["Monto en velo", null],
    ["no ai deberes hoy", null],
    ["de color orange", null],
    // « j'aime » sans apostrophe : détecté dès qu'une suite le confirme,
    // mais le prénom Jaime reste accepté (voir plus haut)
    ["jaime el futbol", "fr"],
    ["jaime trop el futbol", "fr"],
    ["jaime bien los videojuegos", "fr"],
    ["jaime la musica espanola", "fr"],
    ["moi jaime bien el queso", "fr"],
    ["jaime lhistoire", "fr"],
    ["lhistoire", "fr"],
    ["lespagnol", "fr"],
    ["de lescalade", "fr"],
    ["jkiffe el futbol", "fr"],
    ["jem el futbol", "fr"],
    ["jador el futbol", "fr"],
    ["il y a un perro en mi casa", "fr"],
    ["il y a dos gatos en mi casa", "fr"],
    ["jejoueafortnite", "fr"],
    ["jesuiscontente", "fr"],
    ["jevaisalapiscine", "fr"],
    ["jeregardenetflix", "fr"],
    ["la gym", "fr"],
    ["ca me soule", "fr"],
    ["une barre de cereales", "fr"],
    ["ser pour toujours estar pour maintenant", "fr"],
    ["plus tard", "fr"],
    ["la fete foraine", "fr"],
    ["chelou", "fr"],
    ["flippant", "fr"],
    ["magnifique", "fr"],
    ["la tristesse", "fr"],
    ["la colere", "fr"],
    ["perruche", "fr"],
    ["cetait tro bien", "fr"],
    ["jsui trankil", "fr"],
    ["12 an", "fr"],
    ["𝐣𝐞 𝐦𝐚𝐧𝐠𝐞 𝐮𝐧 𝐠𝐚𝐭𝐞𝐚𝐮", "fr"], // lettres Unicode « fantaisie »
    ["no way", "en"],
    ["so so", "en"],
    ["someday", "en"],
    ["hopefully", "en"],
    ["great", "en"],
    ["awesome", "en"],
    ["feeling great", "en"],
    ["13 soon", "en"],
    ["i hate maths", "en"],
    ["i do sport on saturday", "en"],
    ["only on tv", "en"],
    ["korea", "en"],
    ["brazil", "en"],
    ["no colors", "en"],
    ["people dying", "en"],
    ["ngl", "en"],
    ["idc", "en"],
    ["iplayfortnite", "en"],
    ["iwatchnetflix", "en"],
  ];
  const bad = table
    .filter(([t, e]) => detectForeign(t) !== e)
    .map(([t, e]) => `« ${t} » attendu=${e ?? "accepté"} obtenu=${detectForeign(t) ?? "accepté"}`);
  check(`détecteur de langue : table de ${table.length} réponses d'élèves`, bad.length === 0, bad.join(" ; "));
}

// ---- 22) Documents imprimables ----
{
  const { studentReportHtml, classReportHtml } = await import("./src/lib/print");
  const html = studentReportHtml({
    studentName: 'Léa <script>alert("x")</script>',
    className: "5e B — Espagnol",
    progress: {
      xp: 210,
      msg_count: 9,
      missions_completed: 1,
      best_mission: 10,
      vocab: [{ es: "la mochila", fr: "le sac à dos" }],
      updated_at: "2026-08-21T10:00:00Z",
    },
    reports: [
      {
        total: 10,
        comprension: 4,
        expresion: 3,
        lexico: 3,
        insignia: "Agente Estrella",
        consejo: "Revoir tener",
        created_at: "2026-08-21T10:00:00Z",
      },
    ],
    convs: [
      {
        agent_id: "mateo",
        level: "A1",
        messages: [
          { id: "1", role: "assistant", content: "¡Hola! ¿Cómo te llamas?", ts: 0 },
          { id: "2", role: "user", content: "Soy 12 años <b>gras</b>", ts: 0 },
          {
            id: "3",
            role: "assistant",
            content: "¡Tienes 12 años!\n[[astuce: On dit « tengo », pas « soy ».]]",
            ts: 0,
          },
        ],
      },
    ],
    printedAt: new Date("2026-08-21"),
  });
  check("print élève : sections présentes", ["Synthèse", "Rapports de mission (1)", "Carnet de mots (1)", "Conversations"].every((s) => html.includes(s)), html.slice(0, 200));
  check("print élève : script neutralisé", html.includes("&lt;script&gt;") && !html.includes("<script>alert"), "");
  check("print élève : balise élève neutralisée", html.includes("&lt;b&gt;gras&lt;/b&gt;") || html.includes("&lt;b&gt;"), "");
  check("print élève : astuce extraite", html.includes("💡 Astuce :") && !html.includes("[[astuce"), "");
  check("print élève : score mission", html.includes("10/12") && html.includes("Agente Estrella"), "");

  const classe = classReportHtml({
    className: "5e B",
    joinCode: "ABC123",
    rows: [
      { name: "Léa", progress: undefined, reportCount: 0 },
      { name: "Tom", progress: { xp: 150, msg_count: 12, missions_completed: 1, best_mission: 8, vocab: [], updated_at: "2026-08-21T10:00:00Z" }, reportCount: 1 },
    ],
    printedAt: new Date("2026-08-21"),
  });
  check("print classe : 2 élèves listés", classe.includes("Léa") && classe.includes("Tom") && classe.includes("2 élève(s)"), "");
  check("print classe : niveau calculé", classe.includes("<td>150</td><td>2</td>"), classe);
}

console.log(failures ? `\n❌ ${failures} échec(s)` : "\n✅ Tous les tests passent");
process.exit(failures ? 1 : 0);
