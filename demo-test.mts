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
