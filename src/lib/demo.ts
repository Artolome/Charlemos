// Mode démo : réponses préenregistrées diffusées mot à mot, sans appel API.
// Permet de découvrir l'interface en classe ou avant d'avoir configuré une clé.
//
// Le mode démo est RÉACTIF pour les SIX personnages :
// - mission du Capitán et mini-reto de Chispa : bonne réponse → on avance ;
//   mauvaise → indice « inténtalo otra vez » ; 2e échec → la réponse est
//   donnée et on continue. Le score final reflète les réussites réelles.
// - Mateo, Valeria, Diego, Lucía : dialogue guidé — chaque question attend un
//   type de réponse en espagnol ; réponse à côté → le personnage donne un
//   modèle (« Escribe: “Mi asignatura favorita es...” ») ; 2e essai raté →
//   il montre la réponse et continue, sans bloquer ni compter de points.
// - Dans les deux cas, une réponse écrite en FRANÇAIS (ou en anglais) n'est
//   jamais acceptée, même si elle contient un mot-clé attendu : le personnage
//   la refuse gentiment et redonne le modèle en espagnol.
// - Chaque personnage a PLUSIEURS quêtes, enchaînées à la relance : trois
//   missions au choix pour le Capitán (1/2/3), trois mini-retos pour Chispa
//   (ser/estar, gustar, la hora), deux conversations par correspondant.
// - Le prénom donné à Mateo est mémorisé et réutilisé ({nombre}), certaines
//   étapes réagissent différemment selon la réponse choisie (reactions), et
//   une bonne réponse contenant une erreur A1 classique reçoit une
//   [[astuce]] corrective sans être bloquée.
// - Les aides de l'interface sont servies par étape : traduction française
//   de chaque message, 3 suggestions de réponse et vocabulaire du défi en
//   cours (registre de fragments, en fin de fichier).
//
// Limite connue : les conversations démo enregistrées AVANT cette version
// peuvent se rejouer différemment ; il suffit de réinitialiser la
// conversation (bouton corbeille).

import type { AgentDef, ChatMessage } from "./types";
import { AGENTS } from "./agents";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------
// Analyse tolérante des réponses de l'élève
// ---------------------------------------------------------------

/** "¡NARANJA!" → "naranja" ; "está" → "esta" ; la ponctuation devient espace.
 *  - la ponctuation typographique (« l'histoire » tapé au téléphone avec ',
 *    espaces insécables collées...) sépare les mots comme la ponctuation ASCII ;
 *  - les emojis et symboles sont supprimés SANS couper le mot (« est🥰oy ») ;
 *  - les lettres étirées sont repliées : voyelles → simple (« naranjaaa »),
 *    consonnes → double (« sappellle » → « sappelle ») ;
 *  - les lettres espacées pour le style (« N A R A N J A ») sont recollées. */
function normalize(s: string): string {
  let out = "";
  // NFKD : décompose aussi les lettres « fantaisie » (𝐣𝐞 → je), les
  // ligatures (œ → oe) et les pleines chasses, en plus des accents.
  for (const ch of s.normalize("NFKD").toLowerCase()) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x0300 && cp <= 0x036f) continue; // accents décomposés
    if ((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9")) out += ch;
    else if (cp < 128 || /[\p{P}\p{Z}]/u.test(ch)) out += " ";
    // sinon : emoji ou symbole → ignoré, le mot reste entier
  }
  out = out
    .replace(/([aeiou])\1{2,}/g, "$1")
    .replace(/([^aeiou\s])\1{2,}/g, "$1$1")
    .replace(/\s+/g, " ")
    .trim();
  const parts = out.split(" ");
  if (parts.length >= 4 && parts.every((p) => p.length === 1)) {
    return parts.join("");
  }
  return out;
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
  return /^(ok(ay|i)?|d ?accord|merci( beaucoup)?|super|genial|cool|vale|gracias|si|oui|yes|jaja(ja)*|lol|mdr|bien|muy bien|bravo|top|guay|chevere|perfecto|entendido|vamos|hola+|buenas|buenos dias|buenas tardes|buenas noches|hey)$/.test(
    n,
  );
}

// ---------------------------------------------------------------
// Détection de la langue de la réponse
// ---------------------------------------------------------------
// Une réponse écrite en français (ou en anglais) n'est JAMAIS acceptée,
// même si elle contient un mot-clé attendu (« Je mange un sandwich »,
// « J'écoute du rap », « il y a Halloween »...) : le personnage la refuse
// gentiment, rappelle qu'ici on répond en espagnol et redonne le modèle.
// Les listes ne contiennent que des mots impossibles en espagnol après
// normalisation (« tres », « son », « la », « en »... sont exclus, communs
// aux deux langues) pour ne jamais bloquer une vraie réponse espagnole.

const FRENCH_ONLY = new Set([
  // salutations et politesse
  "bonjour", "bonsoir", "salut", "coucou", "revoir", "bienvenue", "merci",
  "stp", "svp", "plait",
  // pronoms, déterminants, petits mots
  // (« par » est exclu : « un par de galletas » est de l'espagnol correct)
  "je", "il", "elle", "on", "nous", "vous", "ils", "elles", "moi", "toi",
  "mon", "ma", "ta", "ton", "sa", "une", "des", "du", "au", "aux",
  "ce", "cet", "cette", "ces", "qu", "quoi", "pourquoi", "comment",
  "quand", "quel", "quelle", "quels", "quelles", "qui", "ca", "cela",
  "et", "ou", "ne", "pas", "non", "oui", "ouais", "nan", "bah", "ben",
  "euh", "bof", "ouf", "aussi", "avec", "chez", "beaucoup", "mais",
  "donc", "alors", "puis", "voila", "comme", "parce", "encore",
  "toujours", "jamais", "rien", "tout", "tous", "toute", "toutes",
  "meme", "vraiment", "trop", "plutot", "pareil", "ici", "bas", "chose",
  "truc", "trucs", "vers", "peu", "pres", "pile", "aucun", "aucune",
  "sans", "plein", "pleine", "surtout", "franchement", "carrement",
  "idee", "idees", "dalle", "souvent", "parfois", "environ", "bientot",
  "presque", "temps", "pour", "maintenant", "tard", "plus", "soule",
  "barre",
  // être / avoir et verbes fréquents
  "est", "sont", "sommes", "etes", "suis", "ai", "etre", "avoir", "faire",
  "aller", "aime", "aimes", "adore", "adores", "deteste", "prefere",
  "preferes", "preferee", "mange", "manges", "manger", "bois", "joue",
  "joues", "jouer", "ecoute", "ecoutes", "ecouter", "regarde", "regardes",
  "regarder", "lire", "voir", "habite", "habites", "appelle", "appelles",
  "veux", "veut", "peux", "peut", "fais", "fait", "faut", "dit", "dois",
  "sais", "connais", "comprends", "pense", "crois", "parle", "parles",
  "prends", "voudrais", "aimerais", "remplacer", "remplace", "mettre",
  "dessiner", "hesiter", "hesite", "rire",
  // élisions et abréviations SMS tapées sans apostrophe
  // (« jaime » n'y est pas : Jaime est un prénom espagnol courant)
  "jai", "jadore", "jecoute", "jhabite", "jregarde", "jsuis",
  "jvais", "jveux", "jjoue", "jfais", "jmange", "jbois", "jsais",
  "jpense", "jcrois", "jprefere", "cest", "sappelle", "mappelle",
  "jemappelle", "jmappelle", "aujourdhui", "jm", "chui", "chuis", "chai",
  "chais", "pk", "pcq", "bcp", "jpp", "osef", "oklm", "relou", "chelou",
  "jkiffe", "jem", "jador", "jsui", "cetait", "tro", "trankil",
  // école et vie quotidienne
  "ans", "annee", "annees", "ecole", "college", "classe", "cinquieme",
  "cantine", "recre", "devoirs", "matiere", "matieres", "cours",
  "professeur", "prof", "eleve", "etudiant", "etudiante", "nom", "prenom",
  "reponse", "question", "histoire", "geographie", "geo", "mathematiques",
  "maths", "sciences", "physique", "chimie", "musique", "dessin",
  "anglais", "allemand", "espagnol", "francais", "francaise",
  "technologie", "sport", "gym", "svt", "eps", "arts", "plastiques",
  "escalade",
  "permanent", "temporaire", "chanson", "chansons", "semaine", "heure",
  "heures", "midi", "minuit", "demi", "demie", "aujourd", "hui",
  "demain", "hier", "matin", "matinee", "grasse", "soir", "jour",
  "jours", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi",
  "dimanche",
  // nourriture (« madeleine » au singulier est épargné : c'est un prénom)
  "gouter", "faim", "soif", "fromage", "pomme", "gateau", "gateaux",
  "jus", "lait", "pain", "poulet", "frites", "viande", "poisson", "eau",
  "banane", "orange", "fraise", "poire", "yaourt", "bonbon", "bonbons",
  "pates", "compote", "chocolat", "madeleines", "raclette", "gratin",
  "tartine", "tartines", "gaufre", "gaufres", "dej",
  // animaux, famille, loisirs, sentiments
  // (pas de mots qui sont aussi des prénoms ou noms de famille réels :
  //  Rose, Fleur, Blanche, Violette, Petit, Blanc... restent acceptés)
  "chien", "chienne", "chiens", "chat", "chats", "chaton", "chiot",
  "lapin", "oiseau", "tortue", "cheval", "souris", "perroquet", "furet",
  "poney", "cochon", "dinde", "mignon", "maison", "copain", "copains",
  "copine", "copines", "potes", "cousin", "cousins", "cousine",
  "cousines", "famille", "frere", "soeur", "mere", "pere", "parents",
  "vacances", "balade", "foret", "console", "jeux", "livre", "livres",
  "musee", "peinture", "peintre", "tableau", "guerre", "bombardement",
  "paix", "mort", "souffrance", "couleur", "surprise", "joie", "peur",
  "content", "contente", "heureux", "heureuse", "stresse", "stressee",
  "fatigue", "fatiguee", "mechant", "mechante", "degoute", "creve",
  "tranquille", "flemme", "sieste", "dodo", "flippant", "magnifique",
  "douleur", "tristesse", "colere", "fete", "foraine", "perruche",
  "bizarre", "intrus",
  "football", "foot", "basket", "natation", "danse", "velo", "piscine",
  "plage", "trottinette", "lecture", "equitation", "coreen", "coreenne",
  // couleurs et nombres (formes espagnoles toutes différentes ;
  // « verte » est épargné : c'est l'espagnol « ver+te », Espero verte)
  "bleu", "bleue", "rouge", "vert", "jaune", "noir", "noire",
  "violet",
  "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix",
  "onze", "douze", "treize", "quatorze", "quinze", "seize", "vingt",
  // adjectifs courants
  "petite", "grand", "bon", "bonne", "beau", "belle", "joli", "jolie",
  "facile", "difficile",
  // pays (les formes espagnoles diffèrent toutes)
  "france", "espagne", "italie", "angleterre", "allemagne", "bresil",
  "grece", "maroc", "mexique", "perou", "norvege", "suisse", "belgique",
  "tunisie", "algerie", "etats", "unis", "chine", "coree", "thailande",
  "russie", "australie", "argentine", "colombie", "inde", "irlande",
]);

// (« has » est exclu : « ¿has comido? » est de l'espagnol correct ;
//  « america » aussi : « América » est un mot espagnol valide)
const ENGLISH_ONLY = new Set([
  "the", "my", "your", "name", "is", "am", "are", "was", "were", "and",
  "not", "of", "or", "an", "at", "by", "for", "from", "about", "some",
  "just", "you", "she", "we", "they", "it", "im", "its", "this", "that",
  "there", "here", "his", "her", "him", "like", "love", "play",
  "playing", "listen", "watch", "watching", "have", "dont", "cant",
  "didnt", "doesnt", "isnt", "want", "can", "must", "say", "know",
  "speak", "eat", "go", "going", "gonna", "wanna", "been", "never",
  "turned", "sleeping", "chilling", "drawing", "what", "hello", "hi",
  "yes", "please", "thanks", "thank", "dunno", "maybe", "same",
  "nothing", "much", "mostly", "obviously", "almost", "around",
  "somewhere", "everyday", "food", "lunch", "lunchtime", "noon",
  "break", "snack", "crisps", "cookies", "candy", "sweets", "juice",
  "apple", "chicken", "nuggets", "pancakes", "hot", "school", "class",
  "history", "geography", "science", "favorite", "favourite", "because",
  "with", "week", "weekend", "really", "very", "too", "all", "better",
  "than", "after", "time", "half", "past", "good", "bad", "happy",
  "sad", "tired", "bored", "excited", "scared", "angry", "morning",
  "years", "old", "eleven", "twelve", "thirteen", "friend", "friends",
  "brother", "sister", "grandma", "called", "home", "dog", "dogs",
  "cat", "cats", "bunny", "game", "games", "videogames", "music",
  "songs", "movies", "painting", "war", "clue", "football", "soccer",
  "basketball", "swimming", "spanish", "french", "english", "bruh",
  "nah", "bro", "orange", "purple", "blue", "green", "yellow", "black",
  "white", "pink", "brown", "six", "japan", "spain", "england",
  "germany", "italy", "monday", "tuesday", "wednesday", "thursday",
  "friday", "saturday", "sunday",
  "to", "in", "be", "one", "two", "seven", "who", "knows", "cares",
  "whatever", "nope", "nearly", "next", "month", "midday", "clock",
  "math", "sleep", "homework", "reading", "shows", "stuff", "duh",
  "got", "goldfish", "turtle", "turtles", "mainly", "everything",
  "tbh", "cheese", "fried", "rice", "peanut", "butter", "fine",
  "hungry", "sleepy", "stressed", "kinda", "little", "nervous",
  "united", "states", "day", "means", "temporary", "wrong", "verb",
  "bombing", "boring", "cartoons", "fries", "live", "visited",
  "cookie", "on", "only", "do", "hate", "so", "way", "bit", "neither",
  "someday", "hopefully", "soon", "great", "awesome", "feeling",
  "doing", "call", "calls", "colors", "people", "dying", "korea",
  "brazil", "greece", "turkey", "ngl", "idc",
]);

/** Mots clairement espagnols : une vraie tentative, même imparfaite */
const SPANISH_HINTS = new Set([
  "me", "mi", "mis", "yo", "el", "los", "las", "es", "esta", "estas",
  "estan", "estoy", "soy", "eres", "tengo", "tienes", "tiene", "tenemos",
  "gusta", "gustan", "encanta", "encantan", "llamo", "llamas", "llama",
  "quiero", "quieres", "prefiero", "prefieres", "escucho", "escuchas",
  "veo", "ves", "juego", "juegas", "voy", "vas", "hay", "si", "hola",
  "buenas", "buenos", "dias", "gracias", "anos", "ano", "muy", "mucho",
  "mucha", "muchos", "muchas", "gusto", "tambien", "pero", "como", "cual",
  "donde", "cuando", "porque", "con", "por", "para", "conozco", "vivo",
  "vives", "puedo", "puedes", "hablo", "hablas", "hablar", "entiendo",
  "comprendo", "comer", "bebo", "tomo", "desayuno", "meriendo",
  "merienda", "ceno", "cena", "jugar", "leer", "leo", "ver", "escuchar",
  "cantar", "bailar", "gustaria", "quisiera", "doy", "pongo", "canto",
  "digo", "hago", "nado", "comido", "jugado", "visto", "representa",
  "ser", "estar", "bailo", "dibujo", "pinto", "trabajo", "duermo",
  "visito", "monto", "espero",
  "favorito", "favorita", "espanol", "espanola", "comida", "asignatura",
  "mascota", "fiesta", "musica", "cancion", "canciones", "futbol",
  "baloncesto", "deporte", "videojuegos", "juegos", "perro", "gato",
  "loro", "animales", "mariposa", "amigo", "amiga", "amigos", "amigas",
  "casa", "clase", "libro", "cuadro", "pintor", "museo", "abuela",
  "llave", "madrid", "espana", "mexico", "colegio", "instituto",
  "recreo", "bocadillo", "manana", "tarde", "noche", "hoy", "nada",
  "todo", "al", "del", "este", "ese", "esa", "aqui", "naranja", "azul",
  "rojo", "verde", "amarillo", "negro", "blanco", "rosa", "morado",
  "color", "pequeno", "pequena", "pronto", "tiempo", "deberes",
  "vacaciones", "conejo", "sabado", "domingo", "lunes", "martes",
  "miercoles", "jueves", "viernes", "quesadillas", "enchiladas",
  "cesta",
  "historia", "matematicas", "ingles", "ciencias", "lengua", "frances",
  // (« chocolate » n'y est pas : c'est aussi le mot anglais)
  "galletas", "fruta", "yogur", "cereales", "zumo", "queso", "ensalada",
  "sopa", "tacos", "patatas", "pescado", "carne", "pollo", "arroz",
  "hamburguesa", "agua", "leche", "pan", "caliente", "palomitas",
  "practico", "escribo", "aburro", "aburrido", "divertido", "divertida",
  "rollo",
  "dos", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez",
  "doce", "trece", "media", "cuarto", "dia", "mochila",
  "manzana", "platano", "una", "uno", "visitar", "peru", "italia",
  "francia",
]);

/** Titres de jeux, séries, artistes et emprunts lexicaux cités tels quels
 *  par les élèves : neutralisés avant le comptage pour que leur « the » /
 *  « of » / « bad »... ne fasse pas passer « juego a call of duty » ou
 *  « escucho bad bunny » pour de l'anglais. Les plus longs d'abord. */
const NEUTRAL_PHRASES = [
  "the legend of zelda", "legend of zelda", "call of duty",
  "clash of clans", "clash royale", "the walking dead", "the weeknd",
  "the last of us", "the sims", "stranger things", "wednesday",
  "mario kart", "brawl stars", "animal crossing", "grand theft auto",
  "star wars", "harry potter", "bad bunny", "black pink", "angry birds",
  "candy crush", "one piece", "just dance", "pokemon go",
  "league of legends", "la play", "hot dogs", "hot dog",
  "pain au chocolat",
];

/** Verbes français agglutinés sans espace (« jaimelefoot », « cestbon »).
 *  Les préfixes sont bordés pour épargner les mots et prénoms espagnols :
 *  « jai » exige une suite française (Jairo passe), « cest » refuse le
 *  a de « cesta ». */
const GLUED_FR =
  /^(?:jai(?=\d|pas|un|une|la|le|les|des|deux|douze|faim|soif)|jaime(?=[a-z]{2})|je(?:joue|suis|regarde|vais|veux|bois|mange|prefere|deteste|pense|crois|sais|fais|adore)|jadore|jsuis|jvais|jveux|jjoue|jmange|jbois|jecoute|jregarde|jhabite|jfais|jemappelle|jmappelle|mappelle|sappelle|cest(?!a))/;

/** Anglais aggloméré (« ilikefootball », « iplayfortnite »...) */
const GLUED_EN = /^(?:ilike|ilove|iam|ihave|iwant|iplay|iwatch|ieat|igo|myname)/;

/** Mots qui révèlent une CHARPENTE de phrase française (sujet + verbe) :
 *  leur présence l'emporte sur les noms espagnols qui suivent
 *  (« je bois un zumo de naranja » reste une phrase française). */
const STRONG_FR = new Set([
  "je", "jai", "jadore", "jsuis", "jsui", "jvais", "jveux", "jmange",
  "jbois", "jkiffe", "jem", "jador", "chui", "chuis", "cest", "cetait",
  "jemappelle", "jmappelle", "mappelle", "sappelle", "jm",
]);

/** "fr" si la réponse est écrite en français, "en" si anglais, null sinon.
 *  (Exporté pour les tests : demo-test.mts sonde le classifieur directement.) */
export function detectForeign(raw: string): "fr" | "en" | null {
  let text = ` ${normalize(raw)} `;
  for (const phrase of NEUTRAL_PHRASES) text = text.split(` ${phrase} `).join(" ");
  const tokens = text.split(" ").filter(Boolean);
  let fr = 0;
  let en = 0;
  let es = 0;
  let leHits = 0;
  let strongFr = false;
  let strongEn = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const prev = tokens[i - 1] ?? "";
    const next = tokens[i + 1] ?? "";
    if (FRENCH_ONLY.has(t)) fr++;
    else if (t.length >= 5 && GLUED_FR.test(t)) {
      fr++;
      strongFr = true; // « jaimelefoot », « jai12ans »
    } else if (
      // élision agglutinée : « lhistoire », « despagnol », « lecole »...
      // (« jaime »/« jaimes » exclus : Jaime est un prénom espagnol)
      t.length >= 4 &&
      t !== "jaime" &&
      t !== "jaimes" &&
      "jcdlmnst".includes(t[0]) &&
      FRENCH_ONLY.has(t.slice(1))
    ) {
      fr++;
    }
    if (STRONG_FR.has(t)) strongFr = true;
    // « jaime » seul ou après llamo/soy est le prénom espagnol Jaime ;
    // suivi d'un article ou d'un adverbe, c'est « j'aime » sans apostrophe
    if (
      t === "jaime" &&
      !["llamo", "llama", "soy"].includes(prev) &&
      (FRENCH_ONLY.has(next) ||
        ["el", "la", "los", "las", "bien"].includes(next))
    ) {
      fr++;
      strongFr = true;
    }
    // charpente existentielle « il y a... »
    if (t === "il" && next === "y") strongFr = true;
    if (ENGLISH_ONLY.has(t)) en++;
    else if (t.length >= 5 && GLUED_EN.test(t)) {
      en++;
      strongEn = true; // « ilikefootball »
    }
    if (t === "im") strongEn = true;
    if (SPANISH_HINTS.has(t)) es++;
    if (t.length === 1) {
      // élisions françaises : « c'est », « m'appelle », « l'école » ;
      // seul « j' » (jamais espagnol) est un marqueur structurel fort
      if ("jcdlmnst".includes(t) && /^[aeiouh]/.test(next)) {
        fr++;
        if (t === "j") strongFr = true;
      }
      // SMS « g » = j'ai, seulement en tête de message (« g faim ») —
      // jamais après un nom (« karol g » est un nom d'artiste)
      if (t === "g" && i === 0 && tokens.length >= 2) {
        fr++;
        strongFr = true;
      }
      if (t === "i") en++; // « I like... »
    }
    // âge collé « 12ans », « g12ans » ou fautif « 12 an » / anglais « 12years »
    // (simple point fr : « tengo 12ans » garde sa charpente espagnole)
    if (/^g?\d{1,2}ans?$/.test(t)) fr++;
    if (t === "an" && /^\d+$/.test(prev)) fr++;
    if (/^\d{1,2}years?$/.test(t)) en++;
    // « tu es... », « tu as... » : conjugaison française — simple point fr,
    // car « tú es de México » est aussi une faute d'apprenant en espagnol
    if (t === "tu" && (next === "es" || next === "as")) fr++;
    // Article français devant un nom qui n'est pas espagnol (« le japon »,
    // « les series ») — comptés seulement si la réponse ne contient par
    // ailleurs AUCUN mot espagnol, pour épargner le pronom espagnol
    // « le/les » (« le doy galletas », « les canto canciones »).
    if ((t === "le" || t === "les") && next.length >= 3 && !SPANISH_HINTS.has(next)) {
      leHits++;
    }
  }
  if (es === 0) fr += leHits;
  // Une charpente de phrase clairement française ou anglaise l'emporte,
  // même noyée sous des noms espagnols (« je joue a los videojuegos »).
  if (strongFr && fr >= en) return "fr";
  if (strongEn && en >= fr) return "en";
  // Sinon : un gallicisme isolé dans une phrase espagnole reste toléré
  // (« Me llamo Léo et tengo 12 años ») ; à partir de deux mots étrangers,
  // l'égalité avec les mots espagnols ne suffit plus (« mi perro est
  // mignon » est refusé, son prédicat est français).
  const wins = (score: number) => (score >= 2 ? score >= es : score === 1 && es === 0);
  if (wins(fr) && fr >= en) return "fr";
  if (wins(en)) return "en";
  return null;
}

const FOREIGN_NUDGE = {
  fr: "¡Uy! ¡Eso es francés! 😅 Aquí respondemos EN ESPAÑOL. (Réécris ta réponse en espagnol — aide-toi du modèle ! 😉)",
  en: "¡Uy! ¡Eso es inglés! 😅 Aquí respondemos EN ESPAÑOL. (Réécris ta réponse en espagnol — aide-toi du modèle ! 😉)",
} as const;

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
  /** Au 2e échec : la bonne réponse est donnée / modélisée, puis on continue */
  reveal: string;
  /** Réaction à une bonne réponse, suivie du défi suivant */
  success: string;
  /** Autres options proposées : si la réponse hésite entre elles, choisir ! */
  distractors?: string[];
  /** false = étape d'introduction ou de conversation, non comptée dans le score */
  scored?: boolean;
  /** Réactions différenciées selon la réponse : la première dont un mot de
   *  `when` apparaît dans la réponse remplace `success` */
  reactions?: { when: string[]; reply: string }[];
  /** true : la réponse acceptée contient le prénom de l'élève — il est
   *  mémorisé et remplace {nombre} dans les textes suivants */
  captureName?: boolean;
}

interface Quest {
  steps: QuestStep[];
  /** Message final ; results = score par étape comptée (2, 1 ou 0 points) */
  final: (results: number[]) => string;
  /**
   * true = le message d'accueil du personnage pose déjà la question de
   * l'étape 0 : le premier message de l'élève est donc évalué directement.
   * false/absent = le premier message lance la quête (cas du Capitán).
   */
  firstAskIsStarter?: boolean;
}

/**
 * Partie interrogative d'un message (les phrases finissant par « ? »),
 * normalisée — pour détecter un copier-coller de la question sans pénaliser
 * l'élève qui réutilise les phrases-modèles déclaratives du personnage.
 */
function questionPart(s: string): string {
  const stripped = s.replace(/\[\[[^\]]*\]\]/g, " ");
  const fragments = stripped.match(/[^.!?\n¡¿]*\?/g) ?? [];
  return normalize(fragments.join(" "));
}

/** Mots jamais pris pour un prénom lors de la capture du nom */
const NAME_STOP = new Set([
  "me", "llamo", "yo", "soy", "es", "hola", "buenas", "y", "de", "la",
  "el", "mi", "tengo", "anos", "claro", "pues", "senor", "senora",
  "que", "tal", "bueno", "vale", "todos", "capitan", "profesor", "don",
]);

/** Extrait le prénom d'une réponse acceptée (« Me llamo Léa » → « Léa ») */
function extractName(raw: string): string {
  for (const w of raw.split(/[^\p{L}\p{M}'’-]+/u)) {
    const t = normalize(w);
    if (
      t.length >= 2 &&
      !NAME_STOP.has(t) &&
      !FRENCH_ONLY.has(t) &&
      !ENGLISH_ONLY.has(t) &&
      !SPANISH_HINTS.has(t)
    ) {
      return w[0].toUpperCase() + w.slice(1);
    }
  }
  return "";
}

/** Astuce corrective sur une réponse ACCEPTÉE mais imparfaite (erreurs A1
 *  classiques) — comme la vraie IA, on avance ET on corrige. */
function astucePara(raw: string): string | null {
  const n = ` ${normalize(raw)} `;
  if (hasWord(raw, "soy") && hasWord(raw, "anos") && !hasWord(raw, "tengo")) {
    return "Pour l'âge on utilise TENER : « Tengo 12 años », pas « soy ».";
  }
  if (/ me gusta (los|las) /.test(n)) {
    return "Au pluriel, gustar prend un N : « Me gustAN los videojuegos ».";
  }
  if (/ me gustan (el|la) /.test(n)) {
    return "Au singulier, pas de N : « Me gustA la música ».";
  }
  if (/ me gusta (futbol|musica|baloncesto|espanol|deporte|cine|natacion) /.test(n)) {
    return "N'oublie pas l'article : « Me gusta EL fútbol », « Me gusta LA música ».";
  }
  if (/ yo (comer|jugar|leer|ver|escuchar|bailar|cantar|beber|vivir|dormir) /.test(n)) {
    return "Conjugue le verbe avec yo : « yo como », « yo juego », « yo leo »...";
  }
  return null;
}

/** Choix de la quête au lancement : le Capitán obéit au numéro de mission
 *  demandé ; sinon on enchaîne les quêtes dans l'ordre à chaque relance. */
function pickQuest(
  agentId: string,
  quests: Quest[],
  launchMsg: string,
  completed: number,
): number {
  if (agentId === "capitan" && quests.length >= 3) {
    if (hasWord(launchMsg, "1", "calavera", "operacion")) return 0;
    if (hasWord(launchMsg, "2", "cuadro", "desaparecido")) return 1;
    if (hasWord(launchMsg, "3", "sorpresa")) return 2;
  }
  return quests.length ? completed % quests.length : 0;
}

/**
 * Rejoue de façon déterministe tous les messages de l'élève pour retrouver
 * l'état de la quête, et renvoie la réponse au dernier message.
 * Chaque personnage a une LISTE de quêtes : à la relance après une quête
 * terminée, on passe à la suivante (missions 2 et 3 du Capitán, nouveaux
 * retos de Chispa, deuxième conversation des correspondants...).
 */
function runQuest(agentId: string, quests: Quest[], userMessages: string[]): string {
  let questIdx = 0;
  let quest = quests[0];
  let pos = quest.firstAskIsStarter ? 0 : -1;
  let attempts = 0;
  let completed = 0;
  let nombre = "";
  let results: number[] = [];
  /** Remplace {nombre} par le prénom mémorisé (ou l'efface proprement) */
  const fill = (t: string) =>
    t.replace(/(, )?\{nombre\}/g, (_m, comma) =>
      nombre ? (comma ? `, ${nombre}` : nombre) : "",
    );
  let reply = fill(quest.steps[0]?.ask ?? "");

  for (const raw of userMessages) {
    if (pos === -1 || pos >= quest.steps.length) {
      // Lancement de la quête (ou relance : on passe à la quête suivante)
      questIdx = pickQuest(agentId, quests, raw, completed);
      quest = quests[questIdx];
      pos = 0;
      attempts = 0;
      results = [];
      reply = fill(quest.steps[0].ask);
      continue;
    }
    const step = quest.steps[pos];
    const na = normalize(raw);

    // Copier-coller de la QUESTION du personnage : pas une réponse.
    // (On ne compare que la partie interrogative : réutiliser une
    // phrase-modèle déclarative reste une excellente réponse !)
    const q = questionPart(step.ask);
    if (q.length >= 12 && na.includes(q)) {
      reply = `Jeje, ¡esa es MI pregunta! 😄 Ahora te toca responder a ti:\n\n${step.ask}`;
      continue;
    }
    // « no sé », « no entiendo »... : détresse, jamais une bonne réponse
    // (sauf étape d'introduction sans indice, où tout fait avancer)
    const helpless = isHelpless(raw) && step.hint !== "";
    // Réponse en français ou en anglais : jamais acceptée, on réoriente
    const foreign = !helpless && step.hint !== "" ? detectForeign(raw) : null;
    const passes = !helpless && !foreign && step.check(raw);
    // « ok », « merci »... après un succès : on repose le défi sans pénalité
    if (!passes && isSmallTalk(raw)) {
      reply = `¡Vale! 😊 Seguimos:\n\n${step.ask}`;
      continue;
    }
    // L'élève hésite entre les options (« ¿azul o naranja? ») : il doit
    // choisir ! (Poser une question en retour, « ¿y tú? », reste permis.)
    const nSpaced = ` ${na} `;
    const distractorHits =
      step.distractors?.filter((d) => hasWord(raw, d)).length ?? 0;
    const hesitates =
      passes &&
      (distractorHits >= 2 ||
        (distractorHits >= 1 &&
          (nSpaced.includes(" o ") || nSpaced.includes(" ou "))));
    if (hesitates) {
      reply = `¡Las dos opciones no, elige una sola! 😄\n\n${step.ask}`;
      continue;
    }

    if (passes) {
      if (step.captureName) nombre = extractName(raw) || nombre;
      if (step.scored !== false) results.push(attempts === 0 ? 2 : 1);
      pos++;
      attempts = 0;
      const done = pos >= quest.steps.length;
      if (done) completed++;
      const next = done ? quest.final(results) : fill(quest.steps[pos].ask);
      // Réaction différenciée selon la réponse (bonito vs extraño...)
      const reaction =
        step.reactions?.find((r) => hasWord(raw, ...r.when))?.reply ?? step.success;
      reply = [fill(reaction), next].filter(Boolean).join("\n\n");
      // Astuce corrective : la réponse est acceptée mais contient une
      // erreur A1 classique → on avance ET on corrige, comme la vraie IA
      const astuce = astucePara(raw);
      if (astuce) reply += `\n[[astuce: ${astuce}]]`;
    } else if (attempts === 0) {
      attempts = 1;
      reply = foreign ? `${FOREIGN_NUDGE[foreign]}\n\n${step.hint}` : step.hint;
    } else {
      if (step.scored !== false) results.push(0);
      pos++;
      attempts = 0;
      const done = pos >= quest.steps.length;
      if (done) completed++;
      const next = done ? quest.final(results) : fill(quest.steps[pos].ask);
      reply = [step.reveal, next].filter(Boolean).join("\n\n");
    }
  }
  return reply;
}

// ---------------------------------------------------------------
// Mission de démonstration du Capitán (6 étapes vérifiées, notées)
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
  final: missionFinal(
    "¡Has viajado, has hablado y has demostrado tu español, agente!",
  ),
};

/** Message final d'une mission du Capitán : phrase de clôture propre à la
 *  mission + rapport chiffré standard + invitation à la mission suivante */
function missionFinal(cierre: string): (results: number[]) => string {
  return (results) => {
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
    return `${cierre}\n[[informe: total=${total}/12 | comprension=${comprension}/4 | expresion=${expresion}/4 | lexico=${lexico}/4 | insignia=${insignia} | consejo=${consejo}]]\n¿Otra misión, agente? Escríbeme (o elige: 1️⃣ Calavera · 2️⃣ Cuadro · 3️⃣ Sorpresa) y seguimos. (Mission de démonstration — en mode classe ou avec une clé API, les missions sont générées par l'IA.)`;
  };
}

// ---------------------------------------------------------------
// Mini-reto de démonstration du Profesor Chispa (ser / estar, noté)
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
  final: retoFinal(
    "¿Otro reto? Escríbeme y te propongo un desafío diferente. ⚡ (En mode classe, les défis sont générés par l'IA et changent à chaque fois !)",
  ),
};

/** Message final d'un mini-reto de Chispa : score en étoiles + invitation */
function retoFinal(invitacion: string): (results: number[]) => string {
  return (results) => {
    const stars = results.map((r) => (r === 2 ? "⚡" : r === 1 ? "✨" : "·")).join("");
    const points = results.reduce((s, r) => s + (r === 2 ? 1 : r === 1 ? 0.5 : 0), 0);
    const pts = String(points).replace(".", ",");
    const bravo =
      points >= 2.5 ? "¡Genial!" : points >= 1.5 ? "¡Muy bien!" : "¡Buen comienzo, sigue así!";
    return `Puntuación: ${stars} — ${pts} sobre 3. ${bravo}\n\n${invitacion}`;
  };
}

// ---------------------------------------------------------------
// Dialogues guidés des correspondants (non notés : un modèle est donné
// si la réponse est à côté, puis la conversation continue)
// ---------------------------------------------------------------

const MUSICAS = [
  "musica",
  "escucho",
  "pop",
  "rap",
  "rock",
  "reggaeton",
  "kpop",
  "electro",
  "clasica",
  "jazz",
  "todo",
  "nada",
  "cancion",
  "canciones",
];

const MASCOTAS = [
  "si",
  "no",
  "tengo",
  "quiero",
  "perro",
  "perra",
  "gato",
  "gata",
  "mascota",
  "hamster",
  "conejo",
  "pez",
  "peces",
  "pajaro",
  "tortuga",
  "caballo",
  "animal",
];

const MATEO_QUEST: Quest = {
  firstAskIsStarter: true,
  steps: [
    {
      ask: "¡Hola! 👋 Soy Mateo, de Madrid. Tengo 13 años y estoy en 2º de ESO (es como la 4ème en Francia). ¿Y tú? ¿Cómo te llamas?",
      // Un prénom contient au moins une lettre (« 1234 » n'est pas un prénom)
      check: (a) => /[a-z]/.test(normalize(a)) && !isHelpless(a) && !isSmallTalk(a),
      hint: "¿Tu nombre? 😊 Escribe: « Me llamo ... ». ¡Inténtalo!",
      reveal: "No pasa nada. 😊 Yo digo: « Me llamo Mateo ». ¡Mucho gusto!",
      success: "¡Genial, {nombre}! 😃 ¡Mucho gusto!",
      captureName: true,
      scored: false,
    },
    {
      ask: "Mi asignatura favorita es Educación Física. ¿Cuál es tu asignatura favorita?",
      check: (a) =>
        hasWord(
          a,
          "asignatura",
          "favorita",
          "gusta",
          "espanol",
          "frances",
          "ingles",
          "matematicas",
          "mates",
          "historia",
          "geografia",
          "ciencias",
          "fisica",
          "quimica",
          "musica",
          "arte",
          "plastica",
          "tecnologia",
          "deporte",
          "educacion",
          "dibujo",
          "lengua",
          "svt",
        ),
      hint: "¿Tu asignatura favorita? 📚 Por ejemplo: Historia, Matemáticas, Música, Español... Escribe: « Mi asignatura favorita es ... ». ¡Inténtalo!",
      reveal:
        "Te ayudo: puedes decir « Mi asignatura favorita es Español » 😉. ¡Seguro que la próxima vez lo dices tú!",
      success: "",
      scored: false,
    },
    {
      ask: "¡Qué guay! A mí no me gustan las Matemáticas... En el recreo como un bocadillo de tortilla. ¿Qué comes tú en el recreo?\n[[astuce: On dit « me gusta el fútbol », pas « me gusta fútbol ».]]",
      // « como » (je mange) est exclu : impossible à distinguer de « ¿cómo? » (pardon ?)
      check: (a) =>
        hasWord(
          a,
          "bocadillo",
          "sandwich",
          "fruta",
          "manzana",
          "platano",
          "galletas",
          "chocolate",
          "pan",
          "croissant",
          "cereales",
          "yogur",
          "zumo",
          "nada",
          "barrita",
          "compota",
          "brioche",
        ),
      hint: "¿Qué comes? 🥪 Pista: « Como una fruta » o « Como un bocadillo ». ¡Inténtalo en español!",
      reveal: "Yo te ayudo: puedes decir « Como una manzana » 🍎 (une pomme). ¡Qué rico!",
      success: "",
      scored: false,
    },
    {
      ask: "¡Qué rico! En España comemos a las dos y media. ¿A qué hora comes tú?",
      check: (a) =>
        /\d/.test(a) || hasWord(a, "una", "dos", "doce", "once", "mediodia", "hora", "las"),
      hint: "¿A qué hora? 🕐 Pista: « Como a las doce » o « a las 12 ». ¡Inténtalo!",
      reveal: "Por ejemplo: « Como a las doce y media » (midi et demi). ¡Muy pronto para mí!",
      success: "",
      scored: false,
    },
    {
      ask: "¿En serio? ¡Es muy pronto! 😄 Yo tengo una perra, se llama Canela. ¿Tienes una mascota (un animal de compagnie)?",
      check: (a) => hasWord(a, ...MASCOTAS),
      hint: "¿Mascota? 🐶 Responde: « Sí, tengo un perro » o « No, no tengo ». ¡Inténtalo!",
      reveal: "Puedes decir: « No, no tengo mascota » o « Sí, tengo un gato » 🐱.",
      success: "",
      scored: false,
    },
  ],
  final: () =>
    "¡Qué guay hablar contigo! 😄 Ahora me voy a entrenar al fútbol. Escríbeme otra vez para recomenzar, o habla con Valeria, Diego o Lucía. ¡Hasta luego! ⚽ (En mode classe, la vraie IA fait continuer la conversation librement !)",
};

const VALERIA_QUEST: Quest = {
  firstAskIsStarter: true,
  steps: [
    {
      ask: "¡Hola, hola! 🦋 Soy Valeria, de Oaxaca, en el sur de México. Me encanta viajar y tomar fotos de fiestas y paisajes. ¿Conoces México, sí o no?",
      check: (a) => hasWord(a, "si", "no", "conozco", "mexico"),
      hint: "¿Sí o no? 😊 Responde: « Sí » o « No, no conozco México ». ¡Inténtalo!",
      reveal: "Puedes decir: « No, no conozco México » — ¡pues te lo enseño yo! 🦋",
      success: "",
      scored: false,
    },
    {
      ask: "¡Órale (waouh)! ¿Sabes qué es el Día de Muertos? El 1 y el 2 de noviembre, en México, hacemos altares con flores naranjas, el cempasúchil. ¿En Francia hay una fiesta parecida?",
      check: (a) =>
        hasWord(a, "si", "no", "hay", "fiesta", "toussaint", "halloween", "navidad", "carnaval"),
      hint: "Piensa en Francia... 🎃 Pista: « Sí, hay una fiesta: Halloween » o « la Toussaint ». ¡Inténtalo!",
      reveal: "En Francia se celebra la Toussaint, el 1 de noviembre — ¡un poco parecida! 🕯️",
      success: "",
      scored: false,
    },
    {
      ask: "¡Qué interesante! 🦋 Yo he visitado las montañas donde duermen las mariposas monarca. Son millones y vuelan desde Canadá. ¿Te gustan los animales?\n[[astuce: « He visitado » = j'ai visité (pretérito perfecto).]]",
      check: (a) => hasWord(a, "si", "no", "gustan", "gusta", "encantan", "animales"),
      hint: "¿Te gustan? 🦋 Responde: « Sí, me gustan » o « No, no me gustan ». ¡Ojo: gustan avec N (pluriel) !",
      reveal: "Se dice: « Sí, me gustan los animales » (gustan, avec un N, car pluriel). 😉",
      success: "",
      scored: false,
    },
    {
      ask: "La neta (la vérité), mi comida favorita es el mole, una salsa con chocolate y chile. ¿Cuál es tu comida favorita?",
      check: (a) =>
        hasWord(
          a,
          "comida",
          "favorita",
          "gusta",
          "pizza",
          "pasta",
          "hamburguesa",
          "pollo",
          "arroz",
          "chocolate",
          "crepe",
          "crepes",
          "queso",
          "ensalada",
          "sopa",
          "tacos",
          "patatas",
          "pan",
          "pescado",
          "carne",
          "sushi",
        ),
      hint: "¿Tu comida favorita? 🍽️ Escribe: « Mi comida favorita es la pizza » (por ejemplo). ¡Inténtalo!",
      reveal: "Puedes decir: « Mi comida favorita es la pasta » 🍝. La neta, ¡todo está rico!",
      success: "",
      scored: false,
    },
    {
      ask: "¡Padrísimo! Un día quiero ver el Machu Picchu, en Perú. ¿Qué país quieres visitar tú?",
      check: (a) =>
        hasWord(
          a,
          "quiero",
          "visitar",
          "pais",
          "espana",
          "mexico",
          "peru",
          "argentina",
          "colombia",
          "japon",
          "italia",
          "francia",
          "chile",
          "cuba",
          "brasil",
          "portugal",
          "inglaterra",
          "china",
          "canada",
          "marruecos",
          "estados",
          "grecia",
        ),
      hint: "¿Qué país? 🌎 Escribe: « Quiero visitar España » (por ejemplo). ¡Inténtalo!",
      reveal: "Por ejemplo: « Quiero visitar México » 🇲🇽 — ¡órale, buena elección!",
      success: "",
      scored: false,
    },
  ],
  final: () =>
    "¡Padrísimo hablar contigo! 🦋 Me voy a tomar fotos al mercado. Escríbeme otra vez para recomenzar, o habla con otro personaje. ¡Hasta pronto! (En mode classe, la vraie IA continue la conversation librement !)",
};

const DIEGO_QUEST: Quest = {
  firstAskIsStarter: true,
  steps: [
    {
      ask: "¡Buenas! 🎨 Soy Diego, de Sevilla. Me encantan el arte, la música y las leyendas misteriosas. ¿Te cuento una historia? Responde: sí o no.",
      check: (a) => hasWord(a, "si", "no", "vale", "cuenta", "cuentame", "historia"),
      hint: "¿Sí o no? 🎨 Responde simplemente: « Sí » o « No ». ¡Inténtalo!",
      reveal: "Imagino que sí... 😄 ¡Te la cuento!",
      success: "",
      scored: false,
    },
    {
      ask: "Se cuenta que en el museo del Prado hay un cuadro muy misterioso: Las Meninas de Velázquez. El pintor está DENTRO de su propio cuadro, mirándote a ti... 👀 ¿Te parece bonito o extraño?",
      check: (a) =>
        hasWord(
          a,
          "bonito",
          "bonita",
          "extrano",
          "extrana",
          "precioso",
          "raro",
          "rara",
          "misterioso",
          "interesante",
          "parece",
          "guay",
          "feo",
          "miedo",
        ),
      distractors: ["bonito", "extrano"],
      hint: "¿Qué sientes? 🎨 Responde: « Me parece bonito » o « Me parece extraño ». ¡Inténtalo!",
      reveal: "Puedes decir: « Me parece misterioso » 👀. ¡A mí también!",
      success: "",
      scored: false,
    },
    {
      ask: "¡A mí también! ¿Sabes qué pasó entonces? Picasso miró Las Meninas y pintó ¡58 versiones! Los artistas se inspiran unos a otros. ¿Te gusta dibujar o pintar?\n[[astuce: « Me gusta dibujar » : gustar + infinitif pour dire ce qu'on aime faire.]]",
      check: (a) => hasWord(a, "si", "no", "gusta", "encanta", "dibujar", "pintar", "dibujo", "pinto"),
      distractors: ["dibujar", "pintar"],
      hint: "Responde: « Sí, me gusta dibujar » o « No, no me gusta ». 🖌️ ¡Inténtalo!",
      reveal: "Se dice: « Me gusta dibujar » — gustar + infinitivo. 😉",
      success: "",
      scored: false,
    },
    {
      ask: "Entonces te va a encantar esta historia: en España, el Ratoncito Pérez toma los dientes de los niños, ¡como la petite souris! ¿Qué sientes: sorpresa o alegría?",
      check: (a) =>
        hasWord(a, "sorpresa", "alegria", "siento", "miedo", "nada", "divertido", "gracia"),
      distractors: ["sorpresa", "alegria"],
      hint: "¿Sorpresa o alegría? 🐭 Responde: « Siento sorpresa » o simplemente « ¡Sorpresa! ». ¡Inténtalo!",
      reveal: "Puedes decir: « ¡Qué sorpresa! » 😄",
      success: "",
      scored: false,
    },
    {
      ask: "El flamenco es alegría y tristeza al mismo tiempo. Mi tía Carmen baila con un vestido rojo precioso. ¿Qué música escuchas tú?",
      check: (a) => hasWord(a, ...MUSICAS),
      hint: "¿Tu música? 🎵 Escribe: « Escucho pop » o « Escucho rap ». ¡Inténtalo!",
      reveal: "Por ejemplo: « Escucho pop » 🎧. ¡Buena elección!",
      success: "",
      scored: false,
    },
  ],
  final: () =>
    "¡Ha sido genial, artista! 🎨 Me voy a dibujar al río. Escríbeme otra vez para recomenzar, o habla con otro personaje. ¡Hasta luego! (En mode classe, la vraie IA invente de nouvelles histoires à chaque fois !)",
};

const LUCIA_QUEST: Quest = {
  firstAskIsStarter: true,
  steps: [
    {
      ask: "¡Hola! 💌 Soy Lucía. Vivo en Madrid, pero mi familia es de Bogotá, en Colombia. Contigo puedo hablar de TODO: música, juegos, series, deporte... ¿Qué te gusta a ti?",
      check: (a) =>
        hasWord(
          a,
          "gusta",
          "gustan",
          "encanta",
          "musica",
          "deporte",
          "futbol",
          "videojuegos",
          "series",
          "leer",
          "bailar",
          "cantar",
          "dibujar",
          "animales",
          "amigos",
          "cine",
          "todo",
          "nada",
        ),
      hint: "¡Lo que sea! 💌 Escribe: « Me gusta la música » o « Me gustan los videojuegos ». ¡Inténtalo!",
      reveal: "Por ejemplo: « Me gusta la música » 🎶 — ¡a mí también!",
      success: "",
      scored: false,
    },
    {
      ask: "¡Qué chévere! 😍 A mí me encanta la música, canto en un coro. En verano, en Bogotá, escucho vallenato con mis primos. ¿Qué música escuchas tú?",
      check: (a) => hasWord(a, ...MUSICAS),
      hint: "🎵 Escribe: « Escucho pop » (o rap, rock, reggaetón...). ¡Inténtalo!",
      reveal: "Puedes decir: « Escucho de todo » 🎧 ¡como yo!",
      success: "",
      scored: false,
    },
    {
      ask: "¡No te creo! ¡Yo también! 😄 En Colombia decimos « ¡qué chévere! », en España dicen « ¡qué guay! ». ¿Prefieres los videojuegos o las series?\n[[astuce: « Prefiero » = je préfère (verbe preferir, e→ie).]]",
      check: (a) => hasWord(a, "prefiero", "videojuegos", "series", "juegos", "ninguno", "dos"),
      distractors: ["videojuegos", "series"],
      hint: "¿Videojuegos o series? 🎮 Responde: « Prefiero los videojuegos » o « Prefiero las series ». ¡Inténtalo!",
      reveal: "Se dice: « Prefiero los videojuegos » (préférer → preferir). 😉",
      success: "",
      scored: false,
    },
    {
      ask: "Yo tengo un loro que se llama Kiwi 🦜 y repite « ¡hola, hola! » todo el día. ¿Tienes una mascota o quieres una?",
      check: (a) => hasWord(a, ...MASCOTAS),
      hint: "🐾 Responde: « Tengo un gato », « Quiero un perro » o « No tengo ». ¡Inténtalo!",
      reveal: "Puedes decir: « Quiero un perro » 🐶 — ¡yo también quiero otro!",
      success: "",
      scored: false,
    },
    {
      ask: "¡Jajaja! Cuéntame: ¿qué vas a hacer este fin de semana? Yo voy a jugar al vóley con mis amigas.",
      check: (a) =>
        hasWord(
          a,
          "voy",
          "jugar",
          "ver",
          "salir",
          "leer",
          "dormir",
          "estudiar",
          "casa",
          "amigos",
          "amigas",
          "futbol",
          "nada",
          "familia",
          "playa",
          "parque",
          "deporte",
          "compras",
          "cine",
        ),
      hint: "Le futur proche : « Voy a + ... » 😊 Ejemplo: « Voy a jugar al fútbol ». ¡Inténtalo!",
      reveal: "Por ejemplo: « Voy a ver una serie » 📺. ¡Buen fin de semana!",
      success: "",
      scored: false,
    },
  ],
  final: () =>
    "¡Qué chévere hablar contigo! 💌 Kiwi dice « ¡adiós, adiós! » 🦜 Escríbeme otra vez para recomenzar, o habla con otro personaje. (En mode classe, on peut parler de TOUT avec la vraie IA !)",
};

// Chaque personnage a une LISTE de quêtes, enchaînées à la relance.
// Les quêtes supplémentaires (missions 2-3, nouveaux retos, deuxièmes
// conversations) sont ajoutées plus bas, après leur définition.
const QUESTS: Record<string, Quest[]> = {
  capitan: [MISSION_QUEST],
  chispa: [CHISPA_QUEST],
  mateo: [MATEO_QUEST],
  valeria: [VALERIA_QUEST],
  diego: [DIEGO_QUEST],
  lucia: [LUCIA_QUEST],
};

// ---------------------------------------------------------------
// Point d'entrée du moteur démo
// ---------------------------------------------------------------

/** Calcule la réponse démo (exposé séparément pour les tests) */
export function demoReplyFor(agent: AgentDef, history: ChatMessage[]): string {
  const userMessages = history.filter((m) => m.role === "user").map((m) => m.content);
  const quests = QUESTS[agent.id] ?? QUESTS.mateo;
  return runQuest(agent.id, quests, userMessages);
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
// Aides en mode démo : registre de fragments
// ---------------------------------------------------------------
// Tous les textes du mode démo étant connus d'avance, chaque fragment
// (question, indice, réponse donnée...) peut porter sa traduction
// française, 3 suggestions de réponse et le vocabulaire de l'étape.
// Les réponses composées (« bravo » + question suivante) sont découpées
// sur les doubles sauts de ligne et retrouvées morceau par morceau.

interface FragAides {
  fr?: string;
  sug?: string[];
  vocab?: { es: string; fr: string }[];
}

const FRAG = new Map<string, FragAides>();

/** Clé stable d'un fragment : marqueurs [[...]] ignorés, accents et
 *  ponctuation neutralisés, nombres remplacés (scores dynamiques) */
function fragKey(s: string): string {
  return normalize(s.replace(/\[\[[^\]]*\]\]/g, " ")).replace(/\d+/g, "#");
}

function regFrag(text: string | undefined, aides: FragAides): void {
  if (!text) return;
  const key = fragKey(text);
  if (!key) return;
  const prev = FRAG.get(key) ?? {};
  FRAG.set(key, {
    fr: aides.fr ?? prev.fr,
    sug: aides.sug ?? prev.sug,
    vocab: aides.vocab ?? prev.vocab,
  });
}

/** Aides d'une étape, accrochées à ses textes */
interface StepAides {
  fr?: { ask?: string; hint?: string; reveal?: string; success?: string };
  sug?: string[];
  vocab?: { es: string; fr: string }[];
}

function registerStepAides(step: QuestStep, a?: StepAides): void {
  if (!a) return;
  regFrag(step.ask, { fr: a.fr?.ask, sug: a.sug, vocab: a.vocab });
  if (step.hint) regFrag(step.hint, { fr: a.fr?.hint, sug: a.sug, vocab: a.vocab });
  if (step.reveal) regFrag(step.reveal, { fr: a.fr?.reveal });
  if (step.success) regFrag(step.success, { fr: a.fr?.success });
}

/** Étape de quête définie en données (contenu généré puis révisé par IA,
 *  intégré ici en dur) : convertie en QuestStep + aides enregistrées */
interface StepData {
  ask: string;
  accept: string[];
  distractors?: string[];
  hint: string;
  reveal: string;
  success: string;
  reactions?: { when: string[]; text: string; textFr?: string }[];
  sug?: string[];
  vocab?: { es: string; fr: string }[];
  fr?: { ask?: string; hint?: string; reveal?: string; success?: string };
  captureName?: boolean;
}

function questFromData(
  steps: StepData[],
  final: (results: number[]) => string,
  opts?: { scored?: false; firstAskIsStarter?: boolean },
): Quest {
  const qs: QuestStep[] = steps.map((d) => {
    const step: QuestStep = {
      ask: d.ask,
      // Une étape sans indice est une introduction : tout fait avancer
      check: d.hint === "" ? () => true : (a) => hasWord(a, ...d.accept),
      hint: d.hint,
      reveal: d.reveal,
      success: d.success,
      distractors: d.distractors,
      scored: opts?.scored ?? (d.hint === "" ? false : undefined),
      reactions: d.reactions?.map((r) => ({ when: r.when, reply: r.text })),
      captureName: d.captureName,
    };
    registerStepAides(step, { fr: d.fr, sug: d.sug, vocab: d.vocab });
    d.reactions?.forEach((r) => regFrag(r.text, { fr: r.textFr }));
    return step;
  });
  return { steps: qs, final, firstAskIsStarter: opts?.firstAskIsStarter };
}

/** Traductions des textes dynamiques (score de Chispa, prénom mémorisé...) */
const BRAVO_FR: Record<string, string> = {
  "¡Genial!": "Génial !",
  "¡Muy bien!": "Très bien !",
  "¡Buen comienzo, sigue así!": "Bon début, continue comme ça !",
};

const DYNAMIC_FR: { re: RegExp; fr: (m: RegExpExecArray) => string }[] = [
  {
    re: /^Puntuación: (.+) — (.+) sobre 3\. (.+)$/u,
    fr: (m) => `Score : ${m[1]} — ${m[2]} sur 3. ${BRAVO_FR[m[3]] ?? m[3]}`,
  },
  {
    re: /^¡Genial, (.+)! 😃 ¡Mucho gusto!$/u,
    fr: (m) => `Génial, ${m[1]} ! 😃 Enchanté !`,
  },
];

function lookupFr(fragment: string): string | null {
  const hit = FRAG.get(fragKey(fragment));
  if (hit?.fr) return hit.fr;
  for (const d of DYNAMIC_FR) {
    const m = d.re.exec(fragment.trim());
    if (m) return d.fr(m);
  }
  return null;
}

/** Traduit une suite de fragments, en essayant l'ensemble puis chaque
 *  découpe possible (une réponse composée = 2-3 fragments connus) */
function translateParts(parts: string[]): string | null {
  if (parts.length === 0) return null;
  const direct = lookupFr(parts.join("\n\n"));
  if (direct) return direct;
  for (let cut = 1; cut < parts.length; cut++) {
    const head = lookupFr(parts.slice(0, cut).join("\n\n"));
    if (!head) continue;
    const tail = translateParts(parts.slice(cut));
    if (tail) return `${head}\n\n${tail}`;
  }
  return null;
}

export function demoTranslation(text: string): string {
  const clean = text.replace(/\[\[[^\]]*\]\]/g, "").trim();
  const parts = clean
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    translateParts(parts) ??
    "📝 Traduction indisponible pour ce message en mode démo. (En mode classe ou avec une clé API, l'IA traduit tout !)"
  );
}

/** Retrouve les aides (suggestions, vocabulaire) du défi contenu dans un
 *  message affiché — le défi est le dernier fragment reconnu du message */
function stepAidesFor(text: string): FragAides | null {
  const clean = text.replace(/\[\[[^\]]*\]\]/g, "").trim();
  const parts = clean
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  // Le défi est un SUFFIXE du message composé (« bravo » + question) :
  // on essaie chaque suffixe, du plus long au plus court.
  for (let from = 0; from < parts.length; from++) {
    const hit = FRAG.get(fragKey(parts.slice(from).join(" ")));
    if (hit && (hit.sug || hit.vocab)) return hit;
  }
  return null;
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

export function demoVocab(agentId: string, text?: string): { es: string; fr: string }[] {
  if (text) {
    const aides = stepAidesFor(text);
    if (aides?.vocab?.length) return aides.vocab;
  }
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

export function demoSuggestions(agentId: string, history?: ChatMessage[]): string[] {
  // Suggestions adaptées à la question en cours : celle du dernier
  // message du personnage (repli : les 3 suggestions génériques)
  const last = history?.filter((m) => m.role === "assistant" && !m.error).at(-1);
  if (last) {
    const aides = stepAidesFor(last.content);
    if (aides?.sug?.length) return aides.sug;
  }
  return DEMO_SUGGESTIONS[agentId] ?? DEMO_SUGGESTIONS.mateo;
}

// ---------------------------------------------------------------
// Traductions des textes fixes du moteur (préfixes des réponses)
// ---------------------------------------------------------------

regFrag("¡Vale! 😊 Seguimos:", { fr: "D'accord ! 😊 On continue :" });
regFrag("Jeje, ¡esa es MI pregunta! 😄 Ahora te toca responder a ti:", {
  fr: "Héhé, ça c'est MA question ! 😄 Maintenant c'est à toi de répondre :",
});
regFrag("¡Las dos opciones no, elige una sola! 😄", {
  fr: "Pas les deux à la fois : choisis une seule option ! 😄",
});
regFrag(FOREIGN_NUDGE.fr, {
  fr: "Ouh là ! Ça, c'est du français ! 😅 Ici on répond EN ESPAGNOL. (Réécris ta réponse en espagnol — aide-toi du modèle ! 😉)",
});
regFrag(FOREIGN_NUDGE.en, {
  fr: "Ouh là ! Ça, c'est de l'anglais ! 😅 Ici on répond EN ESPAGNOL. (Réécris ta réponse en espagnol — aide-toi du modèle ! 😉)",
});
// Variante SANS prénom du succès de Mateo (la variante avec prénom est
// traduite dynamiquement par DYNAMIC_FR)
regFrag("¡Genial! 😃 ¡Mucho gusto!", { fr: "Génial ! 😃 Enchanté !" });

// ===== CONTENU GÉNÉRÉ PAR IA (révisé) — missions 2-3, retos, conversations 2, aides =====
// Généré par un pipeline d'agents (génération + révision pédagogique),
// puis intégré et testé ici. Voir demo-test.mts pour les parcours complets.

const MISSION_2: Quest = questFromData([
  {
    "ask": "¡Alerta máxima, agente! 🚨 Misión « El cuadro desaparecido »: ¡Las Meninas han desaparecido del museo del Prado, en Madrid!\n[[etapa: 1/6]]\nEn la sala solo queda un marco (un cadre) vacío. El vigilante (le gardien) te deja investigar si respondes: ¿quién es el pintor de Las Meninas? Pista: su apellido (son nom de famille) empieza por V...",
    "accept": [
      "velazquez",
      "velasquez"
    ],
    "distractors": [],
    "hint": "El vigilante espera... 🖼️ Pista: es el pintor más famoso del Siglo de Oro (le Siècle d'or), se llama Diego V-e-l-á... Escribe: « Es ... ». ¡Inténtalo otra vez!",
    "reveal": "Es Diego VELÁZQUEZ, el pintor del rey Felipe IV — Las Meninas son de 1656. El vigilante te deja investigar de todos modos. 🖼️",
    "success": "¡Correcto, agente! Diego Velázquez, el genio del Prado. El vigilante te deja pasar. 🕵️",
    "sug": [
      "Es Velázquez.",
      "¡Velázquez! ¿Es muy famoso?",
      "Diego Velázquez — me gusta mucho el arte."
    ],
    "vocab": [
      {
        "es": "el cuadro",
        "fr": "le tableau"
      },
      {
        "es": "el marco",
        "fr": "le cadre"
      },
      {
        "es": "el vigilante",
        "fr": "le gardien"
      },
      {
        "es": "la sala",
        "fr": "la salle"
      }
    ],
    "fr": {
      "ask": "Alerte générale, agent ! 🚨 Mission « Le tableau disparu » : Les Ménines ont disparu du musée du Prado, à Madrid !\nDans la salle, il ne reste qu'un cadre vide. Le gardien te laisse enquêter si tu réponds : qui est le peintre des Ménines ? Indice : son nom de famille commence par V...",
      "hint": "Le gardien attend... 🖼️ Indice : c'est le peintre le plus célèbre du Siècle d'or, il s'appelle Diego V-e-l-á... Écris : « Es... » (c'est...). Réessaie !",
      "reveal": "C'est Diego VELÁZQUEZ, le peintre du roi Philippe IV — Les Ménines datent de 1656. Le gardien te laisse quand même enquêter. 🖼️",
      "success": "Correct, agent ! Diego Velázquez, le génie du Prado. Le gardien te laisse passer. 🕵️"
    }
  },
  {
    "ask": "[[etapa: 2/6]]\nEn el suelo (par terre) encuentras un billete de tren: ¡es del ladrón (le voleur)! 🚂 ¿A qué ciudad viaja: Barcelona, Sevilla o Valencia? Pista: es la ciudad de la Sagrada Familia.\n[[astuce: « viaja » = il/elle voyage : en espagnol, pas besoin du pronom « il », le verbe suffit !]]",
    "accept": [
      "barcelona"
    ],
    "distractors": [
      "sevilla",
      "valencia"
    ],
    "hint": "Mmm, mira bien el billete... 🚂 Pista: es la ciudad del arquitecto Gaudí, al lado del mar Mediterráneo. Escribe: « Viaja a ... ». ¡Inténtalo otra vez!",
    "reveal": "El ladrón viaja a BARCELONA, la ciudad de Gaudí y de la Sagrada Familia. ¡Rápido, agente, al tren! 🚂",
    "success": "¡Exacto, Barcelona! Subes al tren justo a tiempo (juste à temps). 🚂",
    "sug": [
      "Viaja a Barcelona.",
      "¡A Barcelona! ¿Está lejos?",
      "Barcelona, la ciudad de Gaudí — ¡quiero visitarla!"
    ],
    "vocab": [
      {
        "es": "el billete de tren",
        "fr": "le billet de train"
      },
      {
        "es": "el ladrón",
        "fr": "le voleur"
      },
      {
        "es": "el suelo",
        "fr": "le sol"
      },
      {
        "es": "la ciudad",
        "fr": "la ville"
      }
    ],
    "fr": {
      "ask": "Par terre, tu trouves un billet de train : c'est celui du voleur ! 🚂 Dans quelle ville va-t-il : Barcelone, Séville ou Valence ? Indice : c'est la ville de la Sagrada Familia.",
      "hint": "Mmm, regarde bien le billet... 🚂 Indice : c'est la ville de l'architecte Gaudí, au bord de la mer Méditerranée. Écris : « Viaja a... » (il voyage à...). Réessaie !",
      "reveal": "Le voleur va à BARCELONE, la ville de Gaudí et de la Sagrada Familia. Vite, agent, au train ! 🚂",
      "success": "Exact, Barcelone ! Tu montes dans le train juste à temps. 🚂"
    }
  },
  {
    "ask": "[[etapa: 3/6]]\nEn el tren, un pasajero misterioso te da una nota sobre el ladrón, ¡con un error! 📝 Corrige la frase para descifrarla (la déchiffrer) → « Al ladrón le gusta los cuadros ».",
    "accept": [
      "gustan"
    ],
    "distractors": [
      "gusta"
    ],
    "hint": "¡Casi, agente! 📝 Pista: « los cuadros » est un pluriel — au pluriel, gustar prend un N : « le gustaN ». ¡Inténtalo otra vez!",
    "reveal": "La nota dice: « Al ladrón le GUSTAN los cuadros » — con un plural, gustar lleva una N. ¡El tren ya llega a Barcelona! 🚉",
    "success": "¡Brillante! « Al ladrón le GUSTAN los cuadros » — gustan con N, porque « los cuadros » es plural. ¡El tren llega a Barcelona! 🚉",
    "sug": [
      "Al ladrón le gustan los cuadros.",
      "Gustan. ¿Llegamos pronto a Barcelona?",
      "Le gustan los cuadros — en clase practico el verbo gustar."
    ],
    "vocab": [
      {
        "es": "el pasajero",
        "fr": "le passager"
      },
      {
        "es": "la nota",
        "fr": "le mot, la note"
      },
      {
        "es": "el error",
        "fr": "l'erreur"
      },
      {
        "es": "descifrar",
        "fr": "déchiffrer"
      }
    ],
    "fr": {
      "ask": "Dans le train, un passager mystérieux te donne un mot sur le voleur, avec une erreur ! 📝 Corrige la phrase pour la déchiffrer → « Al ladrón le gusta los cuadros » (le voleur aime les tableaux).",
      "hint": "Presque, agent ! 📝 Indice : « los cuadros » est un pluriel — au pluriel, gustar prend un N : « le gustaN ». Réessaie !",
      "reveal": "Le mot dit : « Al ladrón le GUSTAN los cuadros » — avec un pluriel, gustar prend un N. Le train arrive déjà à Barcelone ! 🚉",
      "success": "Brillant ! « Al ladrón le GUSTAN los cuadros » — gustan avec un N, car « los cuadros » est pluriel. Le train arrive à Barcelone ! 🚉"
    }
  },
  {
    "ask": "[[etapa: 4/6]]\nEn el mercado de la Boquería, una vendedora sabe dónde está el ladrón. 🕵️ Te lo dice si completas la frase: « En Nochevieja (la Saint-Sylvestre), los españoles comen doce ___ de la suerte (porte-bonheur) ».",
    "accept": [
      "uvas",
      "uva"
    ],
    "distractors": [],
    "hint": "Piensa, agente... 🕛 Pista: es una fruta pequeña, verde o morada — en francés, « le raisin ». Escribe: « Comen doce u... ». ¡Inténtalo!",
    "reveal": "¡Son las doce UVAS de la suerte, una con cada campanada (coup de cloche) de medianoche! 🍇 La vendedora susurra: « El ladrón está en el puerto (le port) ».",
    "success": "¡Muy bien, las doce uvas! 🍇 La vendedora susurra (chuchote): « El ladrón está en el puerto (le port) ».",
    "sug": [
      "¡Doce uvas!",
      "Comen doce uvas. ¿Tú también comes uvas?",
      "Doce uvas — ¡en Francia no tenemos esa tradición!"
    ],
    "vocab": [
      {
        "es": "el mercado",
        "fr": "le marché"
      },
      {
        "es": "la vendedora",
        "fr": "la vendeuse"
      },
      {
        "es": "la Nochevieja",
        "fr": "la Saint-Sylvestre"
      },
      {
        "es": "la suerte",
        "fr": "la chance"
      }
    ],
    "fr": {
      "ask": "Au marché de la Boquería, une vendeuse sait où est le voleur. 🕵️ Elle te le dit si tu complètes la phrase : « À la Saint-Sylvestre, les Espagnols mangent douze ___ porte-bonheur ».",
      "hint": "Réfléchis, agent... 🕛 Indice : c'est un petit fruit, vert ou violet — en français, « le raisin ». Écris : « Comen doce u... » (ils mangent douze...). Essaie !",
      "reveal": "Ce sont les douze GRAINS DE RAISIN porte-bonheur, un à chaque coup de cloche de minuit ! 🍇 La vendeuse chuchote : « Le voleur est au port ».",
      "success": "Très bien, les douze grains de raisin ! 🍇 La vendeuse chuchote : « Le voleur est au port »."
    }
  },
  {
    "ask": "[[etapa: 5/6]]\nEn el puerto, un viejo marinero (marin) vigila el almacén (l'entrepôt) del ladrón. ⚓ Te abre la puerta si respondes a su pregunta: « ¿Qué desayunas tú por la mañana? »\n[[astuce: « desayunar » = prendre le petit-déjeuner : en espagnol, un seul verbe suffit !]]",
    "accept": [
      "desayuno",
      "tostadas",
      "tostada",
      "leche",
      "zumo",
      "galletas",
      "churros",
      "fruta",
      "bocadillo",
      "yogur",
      "mantequilla",
      "huevos",
      "batido",
      "bebo",
      "tomo",
      "nada"
    ],
    "distractors": [],
    "hint": "El marinero espera una frase completa EN ESPAÑOL... ⚓ Pista: empieza por « Desayuno... », por ejemplo « Desayuno leche y cereales ». ¡Inténtalo!",
    "reveal": "El marinero te ayuda: puedes decir « Desayuno pan con mantequilla y un zumo ». ⚓ Te abre la puerta de todos modos.",
    "success": "¡Qué rico! El marinero sonríe y abre la puerta del almacén... ⚓",
    "reactions": [
      {
        "when": [
          "churros"
        ],
        "text": "¿Churros? ¡Mmm, desayunas como en España! 😋 El marinero, impresionado, abre la puerta del almacén.",
        "textFr": "Des churros ? Mmm, tu prends ton petit-déjeuner comme en Espagne ! 😋 Le marin, impressionné, ouvre la porte de l'entrepôt."
      },
      {
        "when": [
          "nada"
        ],
        "text": "¿Nada? ¡Un agente secreto necesita energía por la mañana! 😅 El marinero te da una tostada y abre la puerta.",
        "textFr": "Rien ? Un agent secret a besoin d'énergie le matin ! 😅 Le marin te donne une tartine grillée et ouvre la porte."
      }
    ],
    "sug": [
      "Desayuno cereales con leche.",
      "Desayuno pan con mantequilla. ¿Y tú?",
      "Desayuno un zumo de naranja antes del colegio."
    ],
    "vocab": [
      {
        "es": "el puerto",
        "fr": "le port"
      },
      {
        "es": "el marinero",
        "fr": "le marin"
      },
      {
        "es": "el almacén",
        "fr": "l'entrepôt"
      },
      {
        "es": "desayunar",
        "fr": "prendre le petit-déjeuner"
      }
    ],
    "fr": {
      "ask": "Au port, un vieux marin surveille l'entrepôt du voleur. ⚓ Il t'ouvre la porte si tu réponds à sa question : « Que prends-tu au petit-déjeuner le matin ? »",
      "hint": "Le marin attend une phrase complète EN ESPAGNOL... ⚓ Indice : commence par « Desayuno... » (au petit-déjeuner, je prends...), par exemple « Desayuno leche y cereales ». Essaie !",
      "reveal": "Le marin t'aide : tu peux dire « Desayuno pan con mantequilla y un zumo » (du pain avec du beurre et un jus). ⚓ Il t'ouvre quand même la porte.",
      "success": "Miam ! Le marin sourit et ouvre la porte de l'entrepôt... ⚓"
    }
  },
  {
    "ask": "[[etapa: 6/6]]\nDentro del almacén, ¡el cuadro está en una caja fuerte (un coffre-fort)! 🔐 El código es el intruso de esta lista: Velázquez, Picasso, Goya, Cervantes. ¿Quién NO es pintor?",
    "accept": [
      "cervantes",
      "escritor"
    ],
    "distractors": [
      "velazquez",
      "velasquez",
      "picasso",
      "goya"
    ],
    "hint": "Piensa, agente... 🔐 Pista: tres pintan cuadros, uno escribe libros — es el autor de Don Quijote. ¡Inténtalo otra vez!",
    "reveal": "¡Era CERVANTES! No es pintor: es el escritor (l'écrivain) de Don Quijote. 📖 La caja fuerte se abre lentamente...",
    "success": "¡MISIÓN CUMPLIDA, agente! 🎉 Cervantes es escritor, no pintor. La caja fuerte se abre...",
    "sug": [
      "¡Es Cervantes!",
      "Cervantes, el escritor, ¿verdad?",
      "El intruso es Cervantes: escribe libros, no pinta cuadros."
    ],
    "vocab": [
      {
        "es": "la caja fuerte",
        "fr": "le coffre-fort"
      },
      {
        "es": "el código",
        "fr": "le code"
      },
      {
        "es": "el intruso",
        "fr": "l'intrus"
      },
      {
        "es": "el pintor",
        "fr": "le peintre"
      }
    ],
    "fr": {
      "ask": "Dans l'entrepôt, le tableau est dans un coffre-fort ! 🔐 Le code, c'est l'intrus de cette liste : Velázquez, Picasso, Goya, Cervantes. Qui N'EST PAS peintre ?",
      "hint": "Réfléchis, agent... 🔐 Indice : trois peignent des tableaux, un écrit des livres — c'est l'auteur de Don Quichotte. Réessaie !",
      "reveal": "C'était CERVANTES ! Il n'est pas peintre : c'est l'écrivain de Don Quichotte. 📖 Le coffre-fort s'ouvre lentement...",
      "success": "MISSION ACCOMPLIE, agent ! 🎉 Cervantes est écrivain, pas peintre. Le coffre-fort s'ouvre..."
    }
  }
], missionFinal("¡Las Meninas vuelven al Prado y tú, agente, ya eres una leyenda del arte español! 🖼️ El Capitán Misión te saluda: ¡caso cerrado!"));
regFrag("¡Las Meninas vuelven al Prado y tú, agente, ya eres una leyenda del arte español! 🖼️ El Capitán Misión te saluda: ¡caso cerrado!", { fr: "Les Ménines retournent au Prado et toi, agent, te voilà une légende de l'art espagnol ! 🖼️ Le Capitán Misión te salue : affaire classée !" });

const MISSION_3: Quest = questFromData([
  {
    "ask": "¡Ajá, la misión sorpresa, la más loca de todas! 🚨 Un paquete misterioso (un colis mystérieux) debe viajar de Madrid a Buenos Aires HOY.\n[[etapa: 1/6]]\nPrimera prueba, en la chocolatería San Ginés: la agente Sofía te da el paquete si respondes: en Madrid, ¿qué mojamos (trempons) en el chocolate caliente? ¿Churros, cruasanes o patatas fritas? 🍫",
    "accept": [
      "churros",
      "churro"
    ],
    "distractors": [
      "cruasanes",
      "patatas"
    ],
    "hint": "Mmm, no exactamente... 🍫 Pista: son largos, fritos y dulces (sucrés). Escribe: « ¡Son los chu___! ». ¡Inténtalo otra vez!",
    "reveal": "Te ayudo, agente: ¡son los CHURROS! Churros con chocolate, el desayuno de Madrid. 🍫 Sofía te da el paquete de todos modos. ¡En marcha!",
    "success": "¡Correcto, agente! ¡Churros con chocolate, qué rico! 🍫 Sofía sonríe y te da el paquete misterioso.",
    "sug": [
      "¡Son los churros!",
      "Churros, ¿no? ¿Están ricos?",
      "Churros. En Francia yo como crepes."
    ],
    "vocab": [
      {
        "es": "el paquete",
        "fr": "le paquet / le colis"
      },
      {
        "es": "mojar",
        "fr": "tremper"
      },
      {
        "es": "el chocolate caliente",
        "fr": "le chocolat chaud"
      },
      {
        "es": "los churros",
        "fr": "les churros (beignets frits)"
      }
    ],
    "fr": {
      "ask": "Ah ah, la mission surprise, la plus folle de toutes ! 🚨 Un paquet mystérieux doit voyager de Madrid à Buenos Aires AUJOURD'HUI. Première épreuve, à la chocolaterie San Ginés : l'agente Sofía te donne le paquet si tu réponds : à Madrid, qu'est-ce qu'on trempe dans le chocolat chaud ? Des churros, des croissants ou des frites ? 🍫",
      "hint": "Mmm, pas exactement... 🍫 Indice : ils sont longs, frits et sucrés. Écris : « ¡Son los chu___! ». Essaie encore !",
      "reveal": "Je t'aide, agent : ce sont les CHURROS ! Des churros au chocolat, le petit-déjeuner de Madrid. 🍫 Sofía te donne quand même le paquet. En route !",
      "success": "Correct, agent ! Des churros au chocolat, quel régal ! 🍫 Sofía sourit et te donne le paquet mystérieux."
    }
  },
  {
    "ask": "[[etapa: 2/6]]\nEl tren AVE te lleva a Valencia, ¡a 300 kilómetros por hora! 🚄 Aquí, en marzo, hay una fiesta con esculturas gigantes de cartón (en carton) que se queman (qu'on brûle) en la calle. ¿Cómo se llama: las Fallas, la Tomatina o el Carnaval?\n[[astuce: « hay » = il y a — toujours invariable : hay una fiesta, hay dos fiestas.]]",
    "accept": [
      "fallas"
    ],
    "distractors": [
      "tomatina",
      "carnaval"
    ],
    "hint": "¡Uy, casi! 🔥 Pista: el nombre viene del fuego (le feu). Empieza por « Las Fa___ ». ¡Inténtalo otra vez!",
    "reveal": "Son las FALLAS: esculturas gigantes que se queman la noche del 19 de marzo. 🔥 ¡El viaje continúa!",
    "success": "¡Exacto, las Fallas! 🔥 ¡Fuego, música y esculturas gigantes! Ahora, ¡al aeropuerto!",
    "sug": [
      "¡Son las Fallas!",
      "Las Fallas, ¿verdad? ¿Tú vas a la fiesta?",
      "Las Fallas. En Francia hay carnavales también."
    ],
    "vocab": [
      {
        "es": "el tren",
        "fr": "le train"
      },
      {
        "es": "la fiesta",
        "fr": "la fête"
      },
      {
        "es": "quemar",
        "fr": "brûler"
      },
      {
        "es": "la calle",
        "fr": "la rue"
      }
    ],
    "fr": {
      "ask": "Le train AVE t'emmène à Valence, à 300 kilomètres à l'heure ! 🚄 Ici, en mars, il y a une fête avec des sculptures géantes en carton qu'on brûle dans la rue. Comment s'appelle-t-elle : las Fallas, la Tomatina ou le Carnaval ?",
      "hint": "Ouh, presque ! 🔥 Indice : le nom vient du feu. Ça commence par « Las Fa___ ». Essaie encore !",
      "reveal": "Ce sont les FALLAS : des sculptures géantes qu'on brûle la nuit du 19 mars. 🔥 Le voyage continue !",
      "success": "Exact, les Fallas ! 🔥 Du feu, de la musique et des sculptures géantes ! Maintenant, direction l'aéroport !"
    }
  },
  {
    "ask": "[[etapa: 3/6]]\nEn el aeropuerto, ¡problema! Tu billete (billet) está medio borrado (à moitié effacé): « Vuelo a Buenos Aires — puerta de embarque: seis + seis ». ✈️ ¿Qué número es? ¡Escríbelo en español!",
    "accept": [
      "doce",
      "12"
    ],
    "distractors": [],
    "hint": "El avión sale pronto... ✈️ Pista: 6 + 6. En español, el número empieza por « do___ ». ¡Inténtalo otra vez!",
    "reveal": "¡Es la puerta DOCE (6 + 6 = 12)! ✈️ Corres por el aeropuerto y subes al avión justo a tiempo.",
    "success": "¡Doce, perfecto! ✈️ Llegas a la puerta justo a tiempo. ¡El avión despega!",
    "sug": [
      "¡Es la puerta doce!",
      "Doce, ¿no? ¿Dónde está la puerta?",
      "Seis más seis son doce. ¡Qué fácil!"
    ],
    "vocab": [
      {
        "es": "el billete",
        "fr": "le billet"
      },
      {
        "es": "el vuelo",
        "fr": "le vol (en avion)"
      },
      {
        "es": "la puerta de embarque",
        "fr": "la porte d'embarquement"
      },
      {
        "es": "el número",
        "fr": "le numéro"
      }
    ],
    "fr": {
      "ask": "À l'aéroport, problème ! Ton billet est à moitié effacé : « Vol pour Buenos Aires — porte d'embarquement : six + six ». ✈️ Quel est le numéro ? Écris-le en espagnol !",
      "hint": "L'avion part bientôt... ✈️ Indice : 6 + 6. En espagnol, le nombre commence par « do___ ». Essaie encore !",
      "reveal": "C'est la porte DOCE (6 + 6 = 12) ! ✈️ Tu cours dans l'aéroport et tu montes dans l'avion juste à temps.",
      "success": "Doce, parfait ! ✈️ Tu arrives à la porte juste à temps. L'avion décolle !"
    }
  },
  {
    "ask": "[[etapa: 4/6]]\nDoce horas de vuelo sobre el océano... La azafata (l'hôtesse de l'air) trae empanadas argentinas 🥟 y dice: « ¡Me gusta las empanadas! ». ¡Uy, hay un error! Corrige la frase para ganar una.",
    "accept": [
      "gustan",
      "encantan"
    ],
    "distractors": [
      "gusta"
    ],
    "hint": "¡Casi! 🥟 Pista: « las empanadas » est au pluriel → le verbe aussi : « Me gusta__ las empanadas ». ¡Inténtalo otra vez!",
    "reveal": "La frase correcta es « Me GUSTAN las empanadas » — con N, porque son varias (plusieurs). 🥟 La azafata te da una empanada de todos modos.",
    "success": "¡Muy bien! « Me GUSTAN las empanadas », con N. 🥟 La azafata te regala una empanada caliente.",
    "sug": [
      "Me gustan las empanadas.",
      "Se dice « me gustan », ¿no?",
      "¡Me gustan las empanadas y los churros!"
    ],
    "vocab": [
      {
        "es": "la azafata",
        "fr": "l'hôtesse de l'air"
      },
      {
        "es": "la empanada",
        "fr": "le chausson fourré (empanada)"
      },
      {
        "es": "el error",
        "fr": "l'erreur"
      },
      {
        "es": "la frase",
        "fr": "la phrase"
      }
    ],
    "fr": {
      "ask": "Douze heures de vol au-dessus de l'océan... L'hôtesse de l'air apporte des empanadas argentines 🥟 et dit : « ¡Me gusta las empanadas! ». Ouh là, il y a une erreur ! Corrige la phrase pour en gagner une.",
      "hint": "Presque ! 🥟 Indice : « las empanadas » est au pluriel → le verbe aussi : « Me gusta__ las empanadas ». Essaie encore !",
      "reveal": "La phrase correcte est « Me GUSTAN las empanadas » — avec un N, parce qu'il y en a plusieurs. 🥟 L'hôtesse te donne quand même une empanada.",
      "success": "Très bien ! « Me GUSTAN las empanadas », avec un N. 🥟 L'hôtesse t'offre une empanada chaude."
    }
  },
  {
    "ask": "[[etapa: 5/6]]\n¡Aterrizas en Buenos Aires, la capital de Argentina! 🇦🇷 El taxista Carlos te pregunta: « ¿Cómo estás después de (après) un viaje tan largo? » Responde con una frase completa.\n[[astuce: estoy cansado (garçon) / estoy cansada (fille) — l'adjectif s'accorde avec toi !]]",
    "accept": [
      "estoy",
      "cansado",
      "cansada",
      "contento",
      "contenta",
      "feliz",
      "emocionado",
      "emocionada",
      "nervioso",
      "nerviosa",
      "tranquilo",
      "tranquila",
      "fenomenal",
      "estupendo",
      "estupenda"
    ],
    "distractors": [],
    "hint": "Carlos espera una frase EN ESPAÑOL... 🚕 Pista: empieza por « Estoy... » (cansado, contento, nervioso...). ¡Inténtalo!",
    "reveal": "Carlos te ayuda: puedes decir « Estoy cansado » o « Estoy contenta ». 🚕 ¡Y arranca el taxi!",
    "success": "¡Muy bien, agente! Carlos sonríe y arranca (démarre) el taxi. 🚕",
    "reactions": [
      {
        "when": [
          "cansado",
          "cansada"
        ],
        "text": "¡Normal, agente! Doce horas de avión... Carlos te ofrece un mate (la boisson argentine). 💪",
        "textFr": "Normal, agent ! Douze heures d'avion... Carlos t'offre un maté (la boisson argentine). 💪"
      },
      {
        "when": [
          "contento",
          "contenta",
          "feliz",
          "emocionado",
          "emocionada"
        ],
        "text": "¡Qué energía, agente! A Carlos le encanta tu entusiasmo. ⭐",
        "textFr": "Quelle énergie, agent ! Carlos adore ton enthousiasme. ⭐"
      }
    ],
    "sug": [
      "Estoy contento.",
      "Estoy feliz, ¿y tú cómo estás?",
      "Estoy cansada, ¡pero muy contenta!"
    ],
    "vocab": [
      {
        "es": "el taxista",
        "fr": "le chauffeur de taxi"
      },
      {
        "es": "el viaje",
        "fr": "le voyage"
      },
      {
        "es": "largo / larga",
        "fr": "long / longue"
      },
      {
        "es": "cansado / cansada",
        "fr": "fatigué(e)"
      }
    ],
    "fr": {
      "ask": "Tu atterris à Buenos Aires, la capitale de l'Argentine ! 🇦🇷 Le chauffeur de taxi Carlos te demande : « Comment vas-tu après un si long voyage ? » Réponds avec une phrase complète.",
      "hint": "Carlos attend une phrase EN ESPAGNOL... 🚕 Indice : commence par « Estoy... » (cansado, contento, nervioso...). Essaie !",
      "reveal": "Carlos t'aide : tu peux dire « Estoy cansado » ou « Estoy contenta ». 🚕 Et le taxi démarre !",
      "success": "Très bien, agent ! Carlos sourit et démarre le taxi. 🚕"
    }
  },
  {
    "ask": "[[etapa: 6/6]]\nÚltima prueba, en el famoso Café Tortoni, el café del tango y de los artistas: la abuela Amparo espera su paquete. Para abrirlo, encuentra el intruso → Argentina, México, Brasil, España. 🔎 ¿En qué país NO se habla español?",
    "accept": [
      "brasil"
    ],
    "distractors": [
      "argentina",
      "mexico",
      "espana"
    ],
    "hint": "Piensa, agente... 🔎 Pista: en ese país enorme se habla portugués, no español. ¡Inténtalo otra vez!",
    "reveal": "¡Era BRASIL! Allí se habla portugués, no español. 🔎 El paquete hace « clic » y se abre lentamente...",
    "success": "¡BRASIL, exacto! Allí se habla portugués. 🎉 El paquete hace « clic » y se abre lentamente...",
    "sug": [
      "¡Es Brasil!",
      "Brasil, ¿verdad? Allí hablan portugués.",
      "El intruso es Brasil. ¡Yo quiero visitar Argentina!"
    ],
    "vocab": [
      {
        "es": "el intruso",
        "fr": "l'intrus"
      },
      {
        "es": "el país",
        "fr": "le pays"
      },
      {
        "es": "la abuela",
        "fr": "la grand-mère"
      },
      {
        "es": "abrir",
        "fr": "ouvrir"
      }
    ],
    "fr": {
      "ask": "Dernière épreuve, au célèbre Café Tortoni, le café du tango et des artistes : la grand-mère Amparo attend son paquet. Pour l'ouvrir, trouve l'intrus → Argentine, Mexique, Brésil, Espagne. 🔎 Dans quel pays ne parle-t-on PAS espagnol ?",
      "hint": "Réfléchis, agent... 🔎 Indice : dans ce pays immense, on parle portugais, pas espagnol. Essaie encore !",
      "reveal": "C'était le BRÉSIL ! Là-bas, on parle portugais, pas espagnol. 🔎 Le paquet fait « clic » et s'ouvre lentement...",
      "success": "Le BRÉSIL, exact ! Là-bas, on parle portugais. 🎉 Le paquet fait « clic » et s'ouvre lentement..."
    }
  }
], missionFinal("¡MISIÓN CUMPLIDA, agente internacional! 🎉 Dentro del paquete hay una carta y fotos de la agente Sofía para su abuela Amparo... ¡Amparo está muy feliz y te regala alfajores (des biscuits argentins)! Has cruzado el mundo hispano en un día: Madrid, Valencia y Buenos Aires. 🌍 ¿Quieres intentarlo otra vez? Escríbeme y la misión recomienza. (Mission de démonstration — en mode classe ou avec une clé API, les missions sont générées par l'IA.)"));
regFrag("¡MISIÓN CUMPLIDA, agente internacional! 🎉 Dentro del paquete hay una carta y fotos de la agente Sofía para su abuela Amparo... ¡Amparo está muy feliz y te regala alfajores (des biscuits argentins)! Has cruzado el mundo hispano en un día: Madrid, Valencia y Buenos Aires. 🌍 ¿Quieres intentarlo otra vez? Escríbeme y la misión recomienza. (Mission de démonstration — en mode classe ou avec une clé API, les missions sont générées par l'IA.)", { fr: "MISSION ACCOMPLIE, agent international ! 🎉 Dans le paquet, il y a une lettre et des photos de l'agente Sofía pour sa grand-mère Amparo... Amparo est très heureuse et t'offre des alfajores (des biscuits argentins) ! Tu as traversé le monde hispanophone en un jour : Madrid, Valence et Buenos Aires. 🌍 Tu veux réessayer ? Écris-moi et la mission recommence. (Mission de démonstration — en mode classe ou avec une clé API, les missions sont générées par l'IA.)" });

const RETO_GUSTAR: Quest = questFromData([
  {
    "ask": "¡Nuevo reto! ⚡ GUSTAR es un verbo mágico : c'est la chose aimée qui commande le verbe. « Me gusta la música » (UNE chose → gusta), « Me gustan los animales » (PLUSIEURS choses → gustan), et « Me gusta bailar » (un verbe → toujours gusta). ¿Quieres un mini-reto para practicar?",
    "accept": [
      "si",
      "no",
      "vale",
      "claro",
      "quiero",
      "reto",
      "venga",
      "vamos",
      "dale",
      "listo",
      "lista",
      "practicar",
      "empezamos",
      "bueno",
      "por favor",
      "luego",
      "despues"
    ],
    "distractors": [],
    "hint": "",
    "reveal": "",
    "success": "¡Genial, vamos allá! ⚡",
    "reactions": [
      {
        "when": [
          "no",
          "luego",
          "despues"
        ],
        "text": "¿No? Jeje... ¡una pregunta pequeñita y verás que es fácil! 😄",
        "textFr": "Non ? Héhé... une toute petite question et tu verras que c'est facile ! 😄"
      },
      {
        "when": [
          "si",
          "vale",
          "claro",
          "quiero",
          "venga",
          "vamos",
          "dale",
          "reto"
        ],
        "text": "¡Genial, vamos allá! ⚡",
        "textFr": "Génial, c'est parti ! ⚡"
      }
    ],
    "sug": [
      "¡Sí, quiero un mini-reto!",
      "Vale, ¿es difícil?",
      "¡Claro! Me encanta la música."
    ],
    "vocab": [
      {
        "es": "me gusta",
        "fr": "j'aime (une seule chose)"
      },
      {
        "es": "me gustan",
        "fr": "j'aime (plusieurs choses)"
      },
      {
        "es": "bailar",
        "fr": "danser"
      },
      {
        "es": "la música",
        "fr": "la musique"
      }
    ],
    "fr": {
      "ask": "Nouveau défi ! ⚡ GUSTAR est un verbe magique : c'est la chose aimée qui commande le verbe. « Me gusta la música » (UNE chose → gusta), « Me gustan los animales » (PLUSIEURS choses → gustan), et « Me gusta bailar » (un verbe → toujours gusta). Tu veux un mini-défi pour t'entraîner ?",
      "hint": "",
      "reveal": "",
      "success": "Génial, c'est parti ! ⚡"
    }
  },
  {
    "ask": "¡Mini-reto! ⚡ Pregunta 1 de 3: completa con gusta o gustan → « Me ___ el chocolate ». ¡Ánimo (courage)!",
    "accept": [
      "gusta"
    ],
    "distractors": [
      "gustan"
    ],
    "hint": "¡Casi! ⚡ Indice : « el chocolate », c'est UNE seule chose (singulier) → GUSTA, sans N. Complète : « Me ___ el chocolate »... ¡Inténtalo!",
    "reveal": "La réponse était « GUSTA » : « Me gusta el chocolate » — une seule chose → gusta, sans N.",
    "success": "¡Muy bien! « Me gusta el chocolate » ✔ (une seule chose → gusta, sans N).",
    "sug": [
      "Me gusta.",
      "Es « gusta », ¿verdad?",
      "¡Me gusta mucho el chocolate!"
    ],
    "vocab": [
      {
        "es": "el chocolate",
        "fr": "le chocolat"
      },
      {
        "es": "me gusta",
        "fr": "ça me plaît / j'aime"
      },
      {
        "es": "la pregunta",
        "fr": "la question"
      },
      {
        "es": "¡ánimo!",
        "fr": "courage !"
      }
    ],
    "fr": {
      "ask": "Mini-défi ! ⚡ Question 1 sur 3 : complète avec gusta ou gustan → « Me ___ el chocolate ». Courage !",
      "hint": "Presque ! ⚡ Indice : « el chocolate », c'est UNE seule chose (singulier) → GUSTA, sans N. Complète : « Me ___ el chocolate »... Essaie !",
      "reveal": "La réponse était « GUSTA » : « Me gusta el chocolate » — une seule chose → gusta, sans N.",
      "success": "Très bien ! « Me gusta el chocolate » ✔ (une seule chose → gusta, sans N)."
    }
  },
  {
    "ask": "Pregunta 2 de 3: « Me ___ los videojuegos ». ¡Ojo (attention), es una trampa (un piège) célebre! 😉",
    "accept": [
      "gustan"
    ],
    "distractors": [
      "gusta"
    ],
    "hint": "¡Uy, la trampa! 😄 Indice : « los videojuegos » est au PLURIEL (plusieurs jeux) → GUSTAN, avec un N. Complète : « Me ___ los videojuegos »... ¡Inténtalo otra vez!",
    "reveal": "C'était « GUSTAN » : « Me gustan los videojuegos » — pluriel → gustan, avec un N final.",
    "success": "¡Perfecto! « Me gustan los videojuegos » ✔ — pluriel → N final. ¡Has evitado la trampa!",
    "sug": [
      "Me gustan.",
      "¿Es « gustan », profe?",
      "¡Me gustan los videojuegos de fútbol!"
    ],
    "vocab": [
      {
        "es": "los videojuegos",
        "fr": "les jeux vidéo"
      },
      {
        "es": "la trampa",
        "fr": "le piège"
      },
      {
        "es": "¡ojo!",
        "fr": "attention !"
      },
      {
        "es": "me gustan",
        "fr": "j'aime (pluriel)"
      }
    ],
    "fr": {
      "ask": "Question 2 sur 3 : « Me ___ los videojuegos ». Attention, c'est un piège célèbre ! 😉",
      "hint": "Ouh là, le piège ! 😄 Indice : « los videojuegos » est au PLURIEL (plusieurs jeux) → GUSTAN, avec un N. Complète : « Me ___ los videojuegos »... Essaie encore !",
      "reveal": "C'était « GUSTAN » : « Me gustan los videojuegos » — pluriel → gustan, avec un N final.",
      "success": "Parfait ! « Me gustan los videojuegos » ✔ — pluriel → N final. Tu as évité le piège !"
    }
  },
  {
    "ask": "Última pregunta, ¡la más difícil! « Me ___ bailar » (bailar = danser). ¿Gusta o gustan? ⚡",
    "accept": [
      "gusta"
    ],
    "distractors": [
      "gustan"
    ],
    "hint": "¡Piensa! ⚡ Indice : après gustar, un VERBE à l'infinitif (bailar) compte comme UNE seule chose → GUSTA, sans N. « Me ___ bailar »... ¡Inténtalo!",
    "reveal": "La réponse était « GUSTA » : « Me gusta bailar » — devant un infinitif, toujours gusta au singulier.",
    "success": "¡Impresionante! « Me gusta bailar » ✔ — infinitif → toujours gusta au singulier. ¡Olé!",
    "sug": [
      "Me gusta bailar.",
      "Es « gusta », ¿no?",
      "¡A mí me gusta bailar reggaetón!"
    ],
    "vocab": [
      {
        "es": "bailar",
        "fr": "danser"
      },
      {
        "es": "última",
        "fr": "dernière"
      },
      {
        "es": "difícil",
        "fr": "difficile"
      },
      {
        "es": "me gusta bailar",
        "fr": "j'aime danser"
      }
    ],
    "fr": {
      "ask": "Dernière question, la plus difficile ! « Me ___ bailar » (bailar = danser). Gusta ou gustan ? ⚡",
      "hint": "Réfléchis ! ⚡ Indice : après gustar, un VERBE à l'infinitif (bailar) compte comme UNE seule chose → GUSTA, sans N. « Me ___ bailar »... Essaie !",
      "reveal": "La réponse était « GUSTA » : « Me gusta bailar » — devant un infinitif, toujours gusta au singulier.",
      "success": "Impressionnant ! « Me gusta bailar » ✔ — infinitif → toujours gusta au singulier. Olé !"
    }
  }
], retoFinal("¿Otro reto? Escríbeme y recomenzamos. (En mode démo je repose les mêmes questions — en mode classe, les défis sont générés par l'IA et changent à chaque fois !)"));
regFrag("¿Otro reto? Escríbeme y recomenzamos. (En mode démo je repose les mêmes questions — en mode classe, les défis sont générés par l'IA et changent à chaque fois !)", { fr: "Un autre défi ? Écris-moi et on recommence. (En mode démo je repose les mêmes questions — en mode classe, les défis sont générés par l'IA et changent à chaque fois !)" });

const RETO_HORA: Quest = questFromData([
  {
    "ask": "¡La hora en español! 🕐 Pour 1h on dit « Es la una » — la SEULE heure au singulier ; pour toutes les autres : « Son las dos, son las tres... ». On ajoute « y cuarto » (et quart), « y media » (et demie) ou « menos cuarto » (moins le quart) : « Son las tres y media » = 3h30. ¿Quieres un mini-reto para practicar?",
    "accept": [
      "si",
      "no",
      "vale",
      "claro",
      "quiero",
      "reto",
      "venga",
      "vamos",
      "dale",
      "listo",
      "lista",
      "practicar",
      "empezamos",
      "bueno",
      "por favor",
      "luego",
      "despues"
    ],
    "distractors": [],
    "hint": "",
    "reveal": "",
    "success": "¡Genial, vamos allá! 🕒",
    "reactions": [
      {
        "when": [
          "no",
          "luego",
          "despues"
        ],
        "text": "¿No? ¡Uy! El reloj hace tic-tac... Una pregunta pequeñita, ¡verás qué fácil! 😄",
        "textFr": "Non ? Oh là ! L'horloge fait tic-tac... Une toute petite question, tu verras comme c'est facile ! 😄"
      },
      {
        "when": [
          "si",
          "vale",
          "claro",
          "quiero",
          "venga",
          "vamos",
          "dale",
          "reto"
        ],
        "text": "¡Genial, vamos allá! 🕒",
        "textFr": "Génial, c'est parti ! 🕒"
      }
    ],
    "sug": [
      "¡Sí, quiero practicar!",
      "Vale, ¡empezamos!",
      "¡Claro! Yo como a las doce y media."
    ],
    "vocab": [
      {
        "es": "la hora",
        "fr": "l'heure"
      },
      {
        "es": "y cuarto",
        "fr": "et quart"
      },
      {
        "es": "y media",
        "fr": "et demie"
      },
      {
        "es": "menos cuarto",
        "fr": "moins le quart"
      }
    ],
    "fr": {
      "ask": "L'heure en espagnol ! 🕐 Pour 1h on dit « Es la una » — la SEULE heure au singulier ; pour toutes les autres : « Son las dos, son las tres... ». On ajoute « y cuarto » (et quart), « y media » (et demie) ou « menos cuarto » (moins le quart) : « Son las tres y media » = 3h30. Tu veux un mini-défi pour t'entraîner ?",
      "hint": "",
      "reveal": "",
      "success": "Génial, c'est parti ! 🕒"
    }
  },
  {
    "ask": "¡Mini-reto! 🕒 Pregunta 1 de 3: mira el reloj (regarde l'horloge): marca las 3:00 de la tarde. Completa: « ___ las tres ». ¿Es o son?",
    "accept": [
      "son",
      "son las",
      "son las tres"
    ],
    "distractors": [
      "es"
    ],
    "hint": "¡Casi! 🕒 Indice : « las tres » est au pluriel (3 heures) → SON. « Es » ne s'utilise que pour la una. « ___ las tres »... ¡Inténtalo otra vez!",
    "reveal": "La réponse était « SON » : « Son las tres » — à partir de 2h, c'est toujours son las... 🕒",
    "success": "¡Muy bien! « Son las tres » ✔ — pluriel → son las.",
    "sug": [
      "Son las tres.",
      "¿« Son », no?",
      "¡Son! En Francia meriendo a las cuatro y media."
    ],
    "vocab": [
      {
        "es": "el reloj",
        "fr": "l'horloge / la montre"
      },
      {
        "es": "la tarde",
        "fr": "l'après-midi"
      },
      {
        "es": "son las tres",
        "fr": "il est trois heures"
      },
      {
        "es": "mira",
        "fr": "regarde"
      }
    ],
    "fr": {
      "ask": "Mini-défi ! 🕒 Question 1 sur 3 : regarde l'horloge : elle indique 3h00 de l'après-midi. Complète : « ___ las tres ». Es ou son ?",
      "hint": "Presque ! 🕒 Indice : « las tres » est au pluriel (3 heures) → SON. « Es » ne s'utilise que pour la una. « ___ las tres »... Essaie encore !",
      "reveal": "La réponse était « SON » : « Son las tres » — à partir de 2h, c'est toujours son las... 🕒",
      "success": "Très bien ! « Son las tres » ✔ — pluriel → son las."
    }
  },
  {
    "ask": "Pregunta 2 de 3: ahora el reloj marca la 1:00. Completa: « ___ la una ». ¡Ojo, es una trampa (un piège) célebre! 😉",
    "accept": [
      "es",
      "es la",
      "es la una"
    ],
    "distractors": [
      "son"
    ],
    "hint": "¡Es la trampa! 😄 Indice : la una = UNE seule heure (singulier) → ES la una. « ___ la una »... ¡Inténtalo otra vez!",
    "reveal": "C'était « ES » : « Es la una » — la una est la seule heure au singulier, ¡la famosa excepción!",
    "success": "¡Impresionante! « Es la una » ✔ — tu as évité la trampa : la una est la seule heure au singulier.",
    "sug": [
      "Es la una.",
      "¿Es la una, profe?",
      "¡Es la una! Yo como a la una y media."
    ],
    "vocab": [
      {
        "es": "la una",
        "fr": "une heure (1h)"
      },
      {
        "es": "ahora",
        "fr": "maintenant"
      },
      {
        "es": "la trampa",
        "fr": "le piège"
      },
      {
        "es": "¡ojo!",
        "fr": "attention !"
      }
    ],
    "fr": {
      "ask": "Question 2 sur 3 : maintenant l'horloge indique 1h. Complète : « ___ la una ». Attention, c'est un piège célèbre ! 😉",
      "hint": "C'est le piège ! 😄 Indice : la una = UNE seule heure (singulier) → ES la una. « ___ la una »... Essaie encore !",
      "reveal": "C'était « ES » : « Es la una » — la una est la seule heure au singulier, la fameuse exception !",
      "success": "Impressionnant ! « Es la una » ✔ — tu as évité le piège : la una est la seule heure au singulier."
    }
  },
  {
    "ask": "Última pregunta: son las 3:30. Completa: « Son las tres ___ ». ¿Y media, y cuarto o menos cuarto? ⏰",
    "accept": [
      "y media",
      "media"
    ],
    "distractors": [
      "y cuarto",
      "menos cuarto"
    ],
    "hint": "¡Casi! ⏰ Indice : 30 minutes = la moitié de l'heure → « y media » (et demie). « Son las tres ___ »... ¡Inténtalo otra vez!",
    "reveal": "C'était « Y MEDIA » : « Son las tres y media » = 3h30 — media = demie, cuarto = quart (15 minutes).",
    "success": "¡Perfecto! « Son las tres y media » ✔ = 3h30. ¡Eres un reloj suizo (une montre suisse)!",
    "sug": [
      "Son las tres y media.",
      "Es « y media », ¿verdad?",
      "¡Y media! Yo ceno a las siete y media."
    ],
    "vocab": [
      {
        "es": "y media",
        "fr": "et demie"
      },
      {
        "es": "y cuarto",
        "fr": "et quart"
      },
      {
        "es": "menos cuarto",
        "fr": "moins le quart"
      },
      {
        "es": "última",
        "fr": "dernière"
      }
    ],
    "fr": {
      "ask": "Dernière question : il est 3h30. Complète : « Son las tres ___ ». Y media, y cuarto ou menos cuarto ? ⏰",
      "hint": "Presque ! ⏰ Indice : 30 minutes = la moitié de l'heure → « y media » (et demie). « Son las tres ___ »... Essaie encore !",
      "reveal": "C'était « Y MEDIA » : « Son las tres y media » = 3h30 — media = demie, cuarto = quart (15 minutes).",
      "success": "Parfait ! « Son las tres y media » ✔ = 3h30. Tu es une montre suisse !"
    }
  }
], retoFinal("¿Otro reto? Escríbeme y recomenzamos: el reloj de la Academia Chispa nunca se para. ⏰ (En mode démo je repose les mêmes questions — en mode classe, les défis sont générés par l'IA et changent à chaque fois !)"));
regFrag("¿Otro reto? Escríbeme y recomenzamos: el reloj de la Academia Chispa nunca se para. ⏰ (En mode démo je repose les mêmes questions — en mode classe, les défis sont générés par l'IA et changent à chaque fois !)", { fr: "Un autre défi ? Écris-moi et on recommence : l'horloge de l'Académie Chispa ne s'arrête jamais. ⏰ (En mode démo je repose les mêmes questions — en mode classe, les défis sont générés par l'IA et changent à chaque fois !)" });

const MATEO_QUEST_2: Quest = questFromData([
  {
    "ask": "¡Hola otra vez! 👋 ¡Qué alegría (quelle joie) leerte! El sábado tengo un partido (un match) de fútbol con mi equipo: juego de defensa. ¿Haces deporte?",
    "accept": [
      "si",
      "no",
      "hago",
      "practico",
      "juego",
      "futbol",
      "deporte",
      "baloncesto",
      "natacion",
      "nado",
      "tenis",
      "danza",
      "bailo",
      "gimnasia",
      "atletismo",
      "balonmano",
      "voleibol",
      "escalada",
      "equitacion",
      "ninguno"
    ],
    "distractors": [],
    "hint": "¿Deporte? ⚽ Pista: « Sí, juego al fútbol » o « No, no hago deporte ». ¡Inténtalo!",
    "reveal": "Te ayudo: puedes decir « Sí, juego al baloncesto » o « No, no hago deporte ». 😉 ¡A mí me encanta el fútbol!",
    "success": "",
    "reactions": [
      {
        "when": [
          "no",
          "ninguno"
        ],
        "text": "¿No? ¡No pasa nada! 😄 Puedes venir a ver mi partido un día.",
        "textFr": "Non ? Pas grave ! 😄 Tu peux venir voir mon match un jour."
      },
      {
        "when": [
          "futbol"
        ],
        "text": "¿Fútbol? ¡Como yo! ⚽ ¡Choca esos cinco!",
        "textFr": "Le foot ? Comme moi ! ⚽ Tape m'en cinq !"
      }
    ],
    "sug": [
      "Sí, juego al fútbol.",
      "No hago deporte, ¿y tú juegas bien?",
      "Practico natación los miércoles con mi amiga."
    ],
    "vocab": [
      {
        "es": "el partido",
        "fr": "le match"
      },
      {
        "es": "el equipo",
        "fr": "l'équipe"
      },
      {
        "es": "el defensa",
        "fr": "le défenseur"
      },
      {
        "es": "el sábado",
        "fr": "le samedi"
      }
    ],
    "fr": {
      "ask": "Re-bonjour ! 👋 Quelle joie de te lire ! Samedi, j'ai un match de foot avec mon équipe : je joue défenseur. Tu fais du sport ?",
      "hint": "Du sport ? ⚽ Indice : « Oui, je joue au foot » ou « Non, je ne fais pas de sport ». Essaie !",
      "reveal": "Je t'aide : tu peux dire « Oui, je joue au basket » ou « Non, je ne fais pas de sport ». 😉 Moi, j'adore le foot !",
      "success": ""
    }
  },
  {
    "ask": "Después del fútbol siempre meriendo con mi equipo en mi barrio, Lavapiés: es antiguo y hay arte urbano (du street art) en las paredes. ¿Cómo es tu barrio o tu pueblo (ton village)?\n[[astuce: Pour décrire un lieu, utilise « hay » = il y a : « Hay un parque, hay tiendas ».]]",
    "accept": [
      "barrio",
      "pueblo",
      "ciudad",
      "bonito",
      "bonita",
      "pequeno",
      "pequena",
      "tranquilo",
      "tranquila",
      "hay",
      "vivo",
      "casas",
      "tiendas",
      "parque",
      "campo",
      "antiguo",
      "moderno",
      "feo",
      "aburrido"
    ],
    "distractors": [],
    "hint": "¿Tu barrio? 🏘️ Pista: « Mi barrio es pequeño y tranquilo » o « Hay un parque y tiendas ». ¡Inténtalo!",
    "reveal": "Puedes decir: « Mi barrio es bonito, hay un parque » 🏘️. ¡Quiero visitarlo un día!",
    "success": "",
    "sug": [
      "Mi barrio es pequeño y tranquilo.",
      "Hay un parque bonito, ¿y en Lavapiés?",
      "Vivo en un pueblo, hay muchas casas antiguas."
    ],
    "vocab": [
      {
        "es": "el barrio",
        "fr": "le quartier"
      },
      {
        "es": "el pueblo",
        "fr": "le village"
      },
      {
        "es": "las paredes",
        "fr": "les murs"
      },
      {
        "es": "el arte urbano",
        "fr": "le street art / l'art urbain"
      }
    ],
    "fr": {
      "ask": "Après le foot, je prends toujours le goûter avec mon équipe dans mon quartier, Lavapiés : il est ancien et il y a du street art sur les murs. Il est comment, ton quartier ou ton village ?",
      "hint": "Ton quartier ? 🏘️ Indice : « Mon quartier est petit et tranquille » ou « Il y a un parc et des magasins ». Essaie !",
      "reveal": "Tu peux dire : « Mon quartier est joli, il y a un parc » 🏘️. Je veux le visiter un jour !",
      "success": ""
    }
  },
  {
    "ask": "¡Qué interesante! 😄 En España las clases terminan a las dos y media. Por la tarde hago los deberes (les devoirs) y monto en skate en el parque del Retiro. ¿Qué haces tú después de las clases?",
    "accept": [
      "hago",
      "juego",
      "veo",
      "leo",
      "estudio",
      "deberes",
      "meriendo",
      "duermo",
      "escucho",
      "videojuegos",
      "musica",
      "deporte",
      "futbol",
      "amigos",
      "casa",
      "nada",
      "dibujo",
      "voy",
      "entreno",
      "consola"
    ],
    "distractors": [],
    "hint": "¿Después de las clases? 🎮 Pista: « Hago los deberes » o « Juego con la consola ». ¡Inténtalo!",
    "reveal": "Te ayudo: puedes decir « Juego con mis amigos y hago los deberes » 🎮. ¡Como yo!",
    "success": "",
    "sug": [
      "Hago los deberes y escucho música.",
      "Juego con la consola, ¿y tú?",
      "Voy al parque con mis amigos del colegio."
    ],
    "vocab": [
      {
        "es": "los deberes",
        "fr": "les devoirs"
      },
      {
        "es": "las clases",
        "fr": "les cours"
      },
      {
        "es": "después de",
        "fr": "après"
      },
      {
        "es": "montar en skate",
        "fr": "faire du skate"
      }
    ],
    "fr": {
      "ask": "Super intéressant ! 😄 En Espagne, les cours finissent à deux heures et demie. L'après-midi, je fais mes devoirs et je fais du skate au parc du Retiro. Qu'est-ce que tu fais, toi, après les cours ?",
      "hint": "Après les cours ? 🎮 Indice : « Je fais mes devoirs » ou « Je joue à la console ». Essaie !",
      "reveal": "Je t'aide : tu peux dire « Je joue avec mes copains et je fais mes devoirs » 🎮. Comme moi !",
      "success": ""
    }
  },
  {
    "ask": "¡Qué guay! Yo en casa juego con mi hermana pequeña, Marta: tiene 7 años y canta todo el día 🎤. Mi padre conduce el metro y mi madre es enfermera (infirmière). ¿Tienes hermanos o hermanas?",
    "accept": [
      "si",
      "no",
      "tengo",
      "hermano",
      "hermanos",
      "hermana",
      "hermanas",
      "unico",
      "unica",
      "hijo",
      "hija",
      "menor",
      "pequeno",
      "pequena"
    ],
    "distractors": [],
    "hint": "¿Hermanos? 👧 Pista: « Sí, tengo una hermana » o « No, soy hijo único / hija única (fils/fille unique) ». ¡Inténtalo!",
    "reveal": "Puedes decir: « Tengo un hermano » o « No tengo hermanos » 😉. ¡Marta te dice hola!",
    "success": "",
    "reactions": [
      {
        "when": [
          "no",
          "unico",
          "unica"
        ],
        "text": "¿Solo tú? ¡Qué tranquilidad! 😄 En mi casa Marta canta a todas horas...",
        "textFr": "Juste toi ? Quel calme ! 😄 Chez moi, Marta chante à longueur de journée..."
      },
      {
        "when": [
          "hermano",
          "hermanos",
          "hermana",
          "hermanas"
        ],
        "text": "¡Como yo! 😄 Los hermanos son geniales... y un poco ruidosos (bruyants) a veces.",
        "textFr": "Comme moi ! 😄 Les frères et sœurs, c'est génial... et un peu bruyant parfois."
      }
    ],
    "sug": [
      "Sí, tengo una hermana pequeña.",
      "No, no tengo hermanos, ¿y Marta canta bien?",
      "Tengo dos hermanos mayores muy divertidos."
    ],
    "vocab": [
      {
        "es": "la hermana pequeña",
        "fr": "la petite sœur"
      },
      {
        "es": "la enfermera",
        "fr": "l'infirmière"
      },
      {
        "es": "el metro",
        "fr": "le métro"
      },
      {
        "es": "todo el día",
        "fr": "toute la journée"
      }
    ],
    "fr": {
      "ask": "Trop bien ! Moi, à la maison, je joue avec ma petite sœur Marta : elle a 7 ans et elle chante toute la journée 🎤. Mon père conduit le métro et ma mère est infirmière. Tu as des frères ou des sœurs ?",
      "hint": "Des frères et sœurs ? 👧 Indice : « Oui, j'ai une sœur » ou « Non, je suis fils unique / fille unique ». Essaie !",
      "reveal": "Tu peux dire : « J'ai un frère » ou « Je n'ai pas de frères et sœurs » 😉. Marta te dit bonjour !",
      "success": ""
    }
  },
  {
    "ask": "Última pregunta 😄: ¿cómo es tu familia? Cuéntame (raconte-moi) un poco, por ejemplo: « Mi madre es simpática, mi padre trabaja en una oficina... »\n[[astuce: « Mi » au singulier, « mis » au pluriel : mi madre, mis padres.]]",
    "accept": [
      "familia",
      "madre",
      "padre",
      "padres",
      "hermano",
      "hermana",
      "abuela",
      "abuelo",
      "tia",
      "tio",
      "primo",
      "prima",
      "simpatico",
      "simpatica",
      "divertido",
      "divertida",
      "trabaja",
      "trabajan",
      "somos",
      "amable"
    ],
    "distractors": [],
    "hint": "¿Tu familia? 👨‍👩‍👧 Pista: « Mi madre es simpática y mi padre trabaja en... ». ¡Inténtalo!",
    "reveal": "Te ayudo: « Mi familia es pequeña: mi madre es divertida y mi padre trabaja mucho » 😊.",
    "success": "",
    "sug": [
      "Mi madre es simpática y divertida.",
      "Mi padre trabaja mucho, ¿y tus padres?",
      "Somos cuatro: mis padres, mi hermana y yo."
    ],
    "vocab": [
      {
        "es": "la familia",
        "fr": "la famille"
      },
      {
        "es": "trabaja",
        "fr": "il/elle travaille"
      },
      {
        "es": "simpática",
        "fr": "sympa, gentille"
      },
      {
        "es": "la oficina",
        "fr": "le bureau"
      }
    ],
    "fr": {
      "ask": "Dernière question 😄 : elle est comment, ta famille ? Raconte-moi un peu, par exemple : « Ma mère est sympa, mon père travaille dans un bureau... »",
      "hint": "Ta famille ? 👨‍👩‍👧 Indice : « Ma mère est sympa et mon père travaille dans... ». Essaie !",
      "reveal": "Je t'aide : « Ma famille est petite : ma mère est drôle et mon père travaille beaucoup » 😊.",
      "success": ""
    }
  }
], () => "¡Qué guay tu familia! 😄 Gracias por contármelo todo. Ahora voy a cenar: ¡esta noche hay tortilla y Marta canta en la mesa, como siempre! 🎤 Escríbeme otra vez para recomenzar, o habla con Valeria, Diego o Lucía. ¡Un abrazo desde Lavapiés! ⚽ (En mode classe, la vraie IA continue la conversation librement !)", { scored: false });
regFrag("¡Qué guay tu familia! 😄 Gracias por contármelo todo. Ahora voy a cenar: ¡esta noche hay tortilla y Marta canta en la mesa, como siempre! 🎤 Escríbeme otra vez para recomenzar, o habla con Valeria, Diego o Lucía. ¡Un abrazo desde Lavapiés! ⚽ (En mode classe, la vraie IA continue la conversation librement !)", { fr: "Trop cool, ta famille ! 😄 Merci de m'avoir tout raconté. Maintenant je vais dîner : ce soir il y a de la tortilla et Marta chante à table, comme toujours ! 🎤 Écris-moi encore pour recommencer, ou parle avec Valeria, Diego ou Lucía. Je t'embrasse depuis Lavapiés ! ⚽ (En mode classe, la vraie IA continue la conversation librement !)" });

const VALERIA_QUEST_2: Quest = questFromData([
  {
    "ask": "¡Hola otra vez! 🦋 ¡Órale (waouh), qué alegría verte! Hoy te cuento algo padrísimo (génial): en diciembre, en México, celebramos las posadas, nueve noches de fiesta antes de Navidad, ¡con piñatas llenas de dulces (bonbons)! 🎄 ¿Quieres saber más, sí o no?",
    "accept": [
      "si",
      "no",
      "quiero",
      "claro"
    ],
    "distractors": [],
    "hint": "¿Sí o no? 🎁 Responde: « Sí, quiero » o « No ». ¡Inténtalo!",
    "reveal": "Puedes decir: « Sí, quiero saber más » 🎉 — ¡te lo cuento igual! En las posadas cantamos, comemos y rompemos la piñata.",
    "success": "",
    "reactions": [
      {
        "when": [
          "no"
        ],
        "text": "¿No? ¡Jaja, no te creo! 😜 Te lo cuento igual: ¡romper la piñata es padrísimo!",
        "textFr": "Non ? Haha, je ne te crois pas ! Je te raconte quand même : casser la piñata, c'est génial !"
      },
      {
        "when": [
          "si",
          "quiero",
          "claro"
        ],
        "text": "¡Órale, qué bien! 😄 Cantamos, comemos y ¡pum!, rompemos la piñata con un palo.",
        "textFr": "Waouh, super ! On chante, on mange et boum, on casse la piñata avec un bâton."
      }
    ],
    "sug": [
      "¡Sí, quiero saber más!",
      "Sí, ¿qué es una posada?",
      "¡Claro! Me encantan las fiestas."
    ],
    "vocab": [
      {
        "es": "la posada",
        "fr": "la posada (fête mexicaine avant Noël)"
      },
      {
        "es": "la piñata",
        "fr": "la piñata"
      },
      {
        "es": "los dulces",
        "fr": "les bonbons"
      },
      {
        "es": "la Navidad",
        "fr": "Noël"
      }
    ],
    "fr": {
      "ask": "Re-bonjour ! 🦋 Waouh, quelle joie de te voir ! Aujourd'hui je te raconte un truc génial : en décembre, au Mexique, on célèbre les posadas, neuf nuits de fête avant Noël, avec des piñatas remplies de bonbons ! 🎄 Tu veux en savoir plus, oui ou non ?",
      "hint": "Oui ou non ? 🎁 Réponds : « Oui, je veux » ou « Non ». Essaie !",
      "reveal": "Tu peux dire : « Oui, je veux en savoir plus » 🎉 — je te raconte quand même ! Pendant les posadas, on chante, on mange et on casse la piñata.",
      "success": ""
    }
  },
  {
    "ask": "¿Y sabes dónde compramos los dulces para las piñatas? ¡En el mercado! La neta (la vérité), mi lugar (endroit) favorito es el mercado 20 de Noviembre, en Oaxaca: mi mamá vende tlayudas allí. 📸 Yo tomo fotos de las frutas y las flores: ¡rojo, amarillo, verde... mil colores! ¿Cuál es tu color favorito?",
    "accept": [
      "rojo",
      "azul",
      "verde",
      "amarillo",
      "naranja",
      "rosa",
      "morado",
      "negro",
      "blanco",
      "violeta",
      "turquesa",
      "favorito",
      "gusta",
      "encanta",
      "prefiero"
    ],
    "distractors": [],
    "hint": "¿Tu color favorito? 🎨 Escribe: « Mi color favorito es el azul » (por ejemplo). ¡Inténtalo!",
    "reveal": "Puedes decir: « Mi color favorito es el rojo » ❤️ — ¡como las flores de mi mercado!",
    "success": "",
    "reactions": [
      {
        "when": [
          "rojo",
          "naranja",
          "amarillo",
          "rosa"
        ],
        "text": "¡Órale, como las flores y el sol de mi mercado! 🌼",
        "textFr": "Waouh, comme les fleurs et le soleil de mon marché !"
      },
      {
        "when": [
          "azul",
          "verde",
          "turquesa",
          "morado"
        ],
        "text": "¡Padrísimo, como el mar de Yucatán en mis fotos! 🌊",
        "textFr": "Génial, comme la mer du Yucatán sur mes photos !"
      }
    ],
    "sug": [
      "Mi color favorito es el azul.",
      "Me gusta el rojo, ¿y a ti?",
      "Prefiero el verde, como la naturaleza."
    ],
    "vocab": [
      {
        "es": "el mercado",
        "fr": "le marché"
      },
      {
        "es": "las flores",
        "fr": "les fleurs"
      },
      {
        "es": "tomar fotos",
        "fr": "prendre des photos"
      },
      {
        "es": "el color",
        "fr": "la couleur"
      }
    ],
    "fr": {
      "ask": "Et tu sais où on achète les bonbons pour les piñatas ? Au marché ! Franchement, mon endroit préféré, c'est le marché 20 de Noviembre, à Oaxaca : ma maman y vend des tlayudas. 📸 Moi, je prends des photos des fruits et des fleurs : rouge, jaune, vert... mille couleurs ! Quelle est ta couleur préférée ?",
      "hint": "Ta couleur préférée ? 🎨 Écris : « Ma couleur préférée, c'est le bleu » (par exemple). Essaie !",
      "reveal": "Tu peux dire : « Ma couleur préférée, c'est le rouge » ❤️ — comme les fleurs de mon marché !",
      "success": ""
    }
  },
  {
    "ask": "Mi foto favorita es de mi familia 📷: vivo con mi mamá y mi abuela (grand-mère) 👵, ella me cuenta leyendas zapotecas por la noche. La cámara (appareil photo) es de mi abuelo, ¡es muy vieja! ¿Y tú? ¿Cómo es tu familia?\n[[astuce: « mi » au singulier, « mis » au pluriel : mi abuela, mis abuelos.]]",
    "accept": [
      "familia",
      "tengo",
      "hermano",
      "hermana",
      "hermanos",
      "hermanas",
      "madre",
      "padre",
      "padres",
      "abuelo",
      "abuela",
      "abuelos",
      "abuelas",
      "tio",
      "tia",
      "tios",
      "tias",
      "primos",
      "primas",
      "vivo",
      "somos",
      "hija",
      "hijo",
      "unica",
      "unico"
    ],
    "distractors": [],
    "hint": "¿Tu familia? 👨‍👩‍👧 Pista: « Tengo un hermano » o « Vivo con mi madre ». ¡Inténtalo!",
    "reveal": "Puedes decir: « Vivo con mis padres y tengo un hermano » 😊 ¡Seguro que tu familia es padrísima!",
    "success": "",
    "reactions": [
      {
        "when": [
          "abuelo",
          "abuela",
          "abuelos",
          "abuelas"
        ],
        "text": "¡Órale, los abuelos son un tesoro! Como mi abuela y sus leyendas. 💛",
        "textFr": "Waouh, les grands-parents sont un trésor ! Comme ma grand-mère et ses légendes."
      },
      {
        "when": [
          "hermano",
          "hermana",
          "hermanos",
          "hermanas"
        ],
        "text": "¡Qué bien! Yo no tengo hermanos, pero tengo a mi gato Nube. 🐱",
        "textFr": "Super ! Moi je n'ai pas de frères et sœurs, mais j'ai mon chat Nube."
      }
    ],
    "sug": [
      "Tengo un hermano y una hermana.",
      "Vivo con mi madre y mis dos hermanas.",
      "Soy hija única, pero tengo dos primos."
    ],
    "vocab": [
      {
        "es": "la abuela",
        "fr": "la grand-mère"
      },
      {
        "es": "el abuelo",
        "fr": "le grand-père"
      },
      {
        "es": "el hermano / la hermana",
        "fr": "le frère / la sœur"
      },
      {
        "es": "la cámara",
        "fr": "l'appareil photo"
      }
    ],
    "fr": {
      "ask": "Ma photo préférée, c'est celle de ma famille 📷 : je vis avec ma maman et ma grand-mère 👵, elle me raconte des légendes zapotèques le soir. L'appareil photo est à mon grand-père, il est très vieux ! Et toi ? Comment est ta famille ?",
      "hint": "Ta famille ? 👨‍👩‍👧 Indice : « J'ai un frère » ou « Je vis avec ma mère ». Essaie !",
      "reveal": "Tu peux dire : « Je vis avec mes parents et j'ai un frère » 😊 Ta famille est sûrement géniale !",
      "success": ""
    }
  },
  {
    "ask": "Ahora, ¡una foto con palabras (mots)! 🏙️ En Oaxaca hay un mercado enorme, hay iglesias antiguas y hay música en la calle (la rue). ¿Y en tu ciudad (ville) qué hay? Escribe una frase con « hay ».",
    "accept": [
      "hay",
      "ciudad",
      "pueblo",
      "mercado",
      "parque",
      "iglesia",
      "escuela",
      "colegio",
      "tiendas",
      "museo",
      "biblioteca",
      "estadio",
      "castillo",
      "rio",
      "playa",
      "piscina",
      "montanas",
      "casas",
      "panaderia"
    ],
    "distractors": [],
    "hint": "Una frase con « hay » (il y a)... 🏙️ Pista: « En mi ciudad hay un parque y hay tiendas ». ¡Inténtalo!",
    "reveal": "Por ejemplo: « En mi ciudad hay un colegio, hay casas y hay un parque » 🏞️ ¡« Hay » nunca cambia, qué fácil!",
    "success": "",
    "reactions": [
      {
        "when": [
          "playa",
          "rio",
          "montanas"
        ],
        "text": "¡Órale, qué bonito! La naturaleza es perfecta para las fotos. 📸",
        "textFr": "Waouh, comme c'est beau ! La nature, c'est parfait pour les photos."
      },
      {
        "when": [
          "mercado",
          "tiendas",
          "panaderia"
        ],
        "text": "¡Como en Oaxaca! La neta, me encantan los mercados. 🍊",
        "textFr": "Comme à Oaxaca ! Franchement, j'adore les marchés."
      }
    ],
    "sug": [
      "En mi ciudad hay un parque grande.",
      "En mi ciudad hay muchas tiendas y un río.",
      "En mi pueblo hay una iglesia y muchas casas."
    ],
    "vocab": [
      {
        "es": "hay",
        "fr": "il y a"
      },
      {
        "es": "la ciudad",
        "fr": "la ville"
      },
      {
        "es": "la iglesia",
        "fr": "l'église"
      },
      {
        "es": "la calle",
        "fr": "la rue"
      }
    ],
    "fr": {
      "ask": "Maintenant, une photo avec des mots ! 🏙️ À Oaxaca, il y a un marché énorme, il y a des églises anciennes et il y a de la musique dans la rue. Et dans ta ville, qu'est-ce qu'il y a ? Écris une phrase avec « hay ».",
      "hint": "Une phrase avec « hay » (il y a)... 🏙️ Indice : « Dans ma ville il y a un parc et il y a des magasins ». Essaie !",
      "reveal": "Par exemple : « Dans ma ville il y a un collège, il y a des maisons et il y a un parc » 🏞️ « Hay » ne change jamais, c'est facile !",
      "success": ""
    }
  },
  {
    "ask": "¡Qué bonita es tu ciudad! 📸 Estas vacaciones voy a ir a la playa con mi familia y voy a tomar mil fotos. ¿Y tú? ¿Qué vas a hacer en las vacaciones?\n[[astuce: le futur proche : « voy a + infinitif » = je vais faire quelque chose.]]",
    "accept": [
      "voy",
      "vacaciones",
      "playa",
      "montana",
      "campo",
      "casa",
      "abuelos",
      "familia",
      "amigos",
      "viajar",
      "visitar",
      "nadar",
      "jugar",
      "leer",
      "descansar",
      "quedo",
      "mar",
      "piscina",
      "ver"
    ],
    "distractors": [],
    "hint": "¿Tus vacaciones? ☀️ Pista: « Voy a ir a la playa » o « Voy a jugar con mis amigos ». ¡Inténtalo!",
    "reveal": "Puedes decir: « Voy a descansar en casa con mi familia » 😎 ¡Felices vacaciones!",
    "success": "",
    "reactions": [
      {
        "when": [
          "playa",
          "mar",
          "nadar",
          "piscina"
        ],
        "text": "¡Órale, el agua! Yo también — ¡y Nube se queda en casa, jaja! 🌊",
        "textFr": "Waouh, l'eau ! Moi aussi — et Nube reste à la maison, haha !"
      },
      {
        "when": [
          "casa",
          "descansar",
          "leer",
          "quedo"
        ],
        "text": "¡La neta, descansar también es padrísimo! 😴",
        "textFr": "Franchement, se reposer c'est génial aussi !"
      }
    ],
    "sug": [
      "Voy a ir a la playa.",
      "Voy a visitar a mis abuelos en el campo.",
      "Me quedo en casa y voy a leer mucho."
    ],
    "vocab": [
      {
        "es": "las vacaciones",
        "fr": "les vacances"
      },
      {
        "es": "la playa",
        "fr": "la plage"
      },
      {
        "es": "voy a + infinitivo",
        "fr": "je vais + verbe (futur proche)"
      },
      {
        "es": "hacer",
        "fr": "faire"
      }
    ],
    "fr": {
      "ask": "Comme elle est jolie, ta ville ! 📸 Ces vacances, je vais aller à la plage avec ma famille et je vais prendre mille photos. Et toi ? Qu'est-ce que tu vas faire pendant les vacances ?",
      "hint": "Tes vacances ? ☀️ Indice : « Je vais aller à la plage » ou « Je vais jouer avec mes amis ». Essaie !",
      "reveal": "Tu peux dire : « Je vais me reposer à la maison avec ma famille » 😎 Bonnes vacances !",
      "success": ""
    }
  }
], () => "¡Órale, cada día hablas mejor español! 🦋 Ahora voy a tomar fotos del atardecer (le coucher du soleil) con la cámara de mi abuelo. ¡Felices vacaciones y nos vemos (à bientôt)! Escríbeme otra vez para recomenzar, o habla con otro personaje. (En mode classe, la vraie IA continue la conversation librement !)", { scored: false });
regFrag("¡Órale, cada día hablas mejor español! 🦋 Ahora voy a tomar fotos del atardecer (le coucher du soleil) con la cámara de mi abuelo. ¡Felices vacaciones y nos vemos (à bientôt)! Escríbeme otra vez para recomenzar, o habla con otro personaje. (En mode classe, la vraie IA continue la conversation librement !)", { fr: "Waouh, chaque jour tu parles mieux espagnol ! 🦋 Maintenant je vais prendre des photos du coucher du soleil avec l'appareil de mon grand-père. Bonnes vacances et à bientôt ! Écris-moi encore pour recommencer, ou parle avec un autre personnage. (En mode classe, la vraie IA continue la conversation librement !)" });

const DIEGO_QUEST_2: Quest = questFromData([
  {
    "ask": "¡Chsss! ¿Oyes (tu entends) la guitarra? 🎸 Soy yo, Diego: dibujo una torre muy antigua en mi cuaderno (carnet) y siempre escucho música cuando dibujo. ¿Tú escuchas música cuando haces los deberes (les devoirs)?",
    "accept": [
      "si",
      "no",
      "escucho",
      "musica",
      "prefiero",
      "siempre",
      "nunca",
      "veces",
      "silencio",
      "pop",
      "rap",
      "rock",
      "reggaeton",
      "nada",
      "todo"
    ],
    "distractors": [],
    "hint": "¿Escuchas música, sí o no? 🎧 Responde: « Sí, escucho música » o « No, prefiero el silencio ». ¡Inténtalo!",
    "reveal": "Puedes decir: « Sí, escucho música » o « No, no escucho nada ». 🎧 Yo sin música no puedo dibujar.",
    "success": "",
    "sug": [
      "Sí, escucho música cuando dibujo.",
      "No, prefiero el silencio. ¿Qué dibujas tú?",
      "Escucho rap cuando hago los deberes."
    ],
    "vocab": [
      {
        "es": "la guitarra",
        "fr": "la guitare"
      },
      {
        "es": "el cuaderno",
        "fr": "le carnet / le cahier"
      },
      {
        "es": "la torre",
        "fr": "la tour"
      },
      {
        "es": "los deberes",
        "fr": "les devoirs"
      }
    ],
    "fr": {
      "ask": "Chuuut ! Tu entends la guitare ? 🎸 C'est moi, Diego : je dessine une tour très ancienne dans mon carnet et j'écoute toujours de la musique quand je dessine. Et toi, tu écoutes de la musique quand tu fais tes devoirs ?",
      "hint": "Tu écoutes de la musique, oui ou non ? 🎧 Réponds : « Oui, j'écoute de la musique » ou « Non, je préfère le silence ». Essaie !",
      "reveal": "Tu peux dire : « Oui, j'écoute de la musique » ou « Non, je n'écoute rien ». 🎧 Moi, sans musique, je ne peux pas dessiner.",
      "success": ""
    }
  },
  {
    "ask": "Mi dibujo es la Giralda, la torre más famosa de Sevilla. 👀 Se cuenta que unos hombres quieren destruirla (la détruire), pero el príncipe Alfonso dice: « ¡Prohibido tocar una sola piedra (pierre)! ». ¿La historia te parece impresionante o extraña?",
    "accept": [
      "impresionante",
      "extrana",
      "extrano",
      "parece",
      "misteriosa",
      "misterioso",
      "interesante",
      "bonita",
      "bonito",
      "guay",
      "miedo",
      "valiente",
      "rara",
      "raro"
    ],
    "distractors": [
      "impresionante",
      "extrana"
    ],
    "hint": "¿Qué sientes? 👀 Responde: « Me parece impresionante » o « Me parece extraña ». ¡Inténtalo!",
    "reveal": "Puedes decir: « Me parece impresionante » — ¡a mí también me impresiona ese príncipe! 👑",
    "success": "",
    "reactions": [
      {
        "when": [
          "impresionante",
          "valiente",
          "bonita",
          "bonito",
          "guay",
          "interesante"
        ],
        "text": "¿Verdad que sí? ¡Un príncipe que salva una torre con palabras! 👑",
        "textFr": "N'est-ce pas ? Un prince qui sauve une tour avec des mots ! 👑"
      },
      {
        "when": [
          "extrana",
          "extrano",
          "rara",
          "raro",
          "misteriosa",
          "misterioso",
          "miedo"
        ],
        "text": "Jeje, las mejores historias son un poco extrañas... 👀",
        "textFr": "Héhé, les meilleures histoires sont un peu étranges... 👀"
      }
    ],
    "sug": [
      "¡Me parece impresionante!",
      "Me parece extraña. ¿La torre es muy antigua?",
      "¡Qué guay! Me encantan las leyendas."
    ],
    "vocab": [
      {
        "es": "la piedra",
        "fr": "la pierre"
      },
      {
        "es": "el príncipe",
        "fr": "le prince"
      },
      {
        "es": "prohibido",
        "fr": "interdit"
      },
      {
        "es": "impresionante",
        "fr": "impressionnant(e)"
      }
    ],
    "fr": {
      "ask": "Mon dessin, c'est la Giralda, la tour la plus célèbre de Séville. 👀 On raconte que des hommes veulent la détruire, mais le prince Alphonse dit : « Interdit de toucher une seule pierre ! ». Tu trouves cette histoire impressionnante ou étrange ?",
      "hint": "Qu'est-ce que tu ressens ? 👀 Réponds : « Je la trouve impressionnante » ou « Je la trouve étrange ». Essaie !",
      "reveal": "Tu peux dire : « Je la trouve impressionnante » — moi aussi, ce prince m'impressionne ! 👑",
      "success": ""
    }
  },
  {
    "ask": "Ahora, otra persona valiente: Frida Kahlo, una artista de México. En sus autorretratos (autoportraits) se pinta con sus animales: monos (singes), loros y hasta un ciervo (un cerf). 🐒 ¿Qué animal prefieres: el mono o el loro?\n[[astuce: « Se pinta » = elle SE peint : en espagnol, le petit mot « se » se place devant le verbe.]]",
    "accept": [
      "mono",
      "monos",
      "loro",
      "loros",
      "ciervo",
      "prefiero",
      "animales"
    ],
    "distractors": [
      "mono",
      "loro"
    ],
    "hint": "¿El mono o el loro? 🐒 Responde: « Prefiero el mono » o « Prefiero el loro ». ¡Inténtalo!",
    "reveal": "Se dice: « Prefiero el loro » o « Prefiero el mono ». 🦜 A Frida le encantan los dos.",
    "success": "",
    "reactions": [
      {
        "when": [
          "mono",
          "monos"
        ],
        "text": "¡Como Fulang Chang, el mono favorito de Frida! 🐒",
        "textFr": "Comme Fulang Chang, le singe préféré de Frida ! 🐒"
      },
      {
        "when": [
          "loro",
          "loros"
        ],
        "text": "¡Buena elección! El loro de Frida se llama Bonito, ¡en serio! 🦜",
        "textFr": "Bon choix ! Le perroquet de Frida s'appelle Bonito, sérieux ! 🦜"
      }
    ],
    "sug": [
      "Prefiero el mono.",
      "Prefiero el loro. ¿Tú tienes animales?",
      "¡El ciervo! Me encantan los animales."
    ],
    "vocab": [
      {
        "es": "el autorretrato",
        "fr": "l'autoportrait"
      },
      {
        "es": "el mono",
        "fr": "le singe"
      },
      {
        "es": "el loro",
        "fr": "le perroquet"
      },
      {
        "es": "el ciervo",
        "fr": "le cerf"
      }
    ],
    "fr": {
      "ask": "Maintenant, une autre personne courageuse : Frida Kahlo, une artiste du Mexique. Dans ses autoportraits, elle se peint avec ses animaux : des singes, des perroquets et même un cerf. 🐒 Quel animal préfères-tu : le singe ou le perroquet ?",
      "hint": "Le singe ou le perroquet ? 🐒 Réponds : « Je préfère le singe » ou « Je préfère le perroquet ». Essaie !",
      "reveal": "On dit : « Je préfère le perroquet » ou « Je préfère le singe ». 🦜 Frida adore les deux.",
      "success": ""
    }
  },
  {
    "ask": "En abril, mi ciudad está de fiesta: ¡es la Feria de Abril! Hay casetas (petites tentes de fête) con música y farolillos (lampions), y muchas personas llevan trajes (costumes) de colores. 🎪 ¿De qué color quieres tu traje para la Feria?",
    "accept": [
      "rojo",
      "azul",
      "verde",
      "amarillo",
      "negro",
      "blanco",
      "rosa",
      "morado",
      "naranja",
      "quiero",
      "traje",
      "lunares"
    ],
    "distractors": [],
    "hint": "¿De qué color? 🎨 Pista: « Quiero un traje rojo » o « azul » o « verde ». ¡Inténtalo!",
    "reveal": "Puedes decir: « Quiero un traje azul con lunares blancos » (à pois blancs). ¡Muy sevillano! 🎪",
    "success": "",
    "sug": [
      "Quiero un traje rojo.",
      "Quiero un traje azul. ¿De qué color es tu traje?",
      "¡Verde! Es mi color favorito."
    ],
    "vocab": [
      {
        "es": "la Feria de Abril",
        "fr": "la Feria d'avril (grande fête de Séville)"
      },
      {
        "es": "la caseta",
        "fr": "la petite tente de fête"
      },
      {
        "es": "el farolillo",
        "fr": "le lampion"
      },
      {
        "es": "el traje",
        "fr": "le costume / la robe de fête"
      }
    ],
    "fr": {
      "ask": "En avril, ma ville est en fête : c'est la Feria de Abril ! Il y a des casetas (petites tentes de fête) avec de la musique et des lampions, et beaucoup de gens portent des costumes colorés. 🎪 De quelle couleur veux-tu ton costume pour la Feria ?",
      "hint": "De quelle couleur ? 🎨 Indice : « Je veux un costume rouge » ou « bleu » ou « vert ». Essaie !",
      "reveal": "Tu peux dire : « Je veux un costume bleu à pois blancs ». Très sévillan ! 🎪",
      "success": ""
    }
  },
  {
    "ask": "Última pregunta de artista: imagina tu autorretrato, como Frida. 🖼️ ¿Qué vas a dibujar a tu lado: tu mascota, tu deporte, tu comida favorita...? ¡Cuéntame!\n[[astuce: « Voy a dibujar » = je vais dessiner : ir a + infinitif = le futur proche.]]",
    "accept": [
      "voy",
      "dibujar",
      "dibujo",
      "mascota",
      "perro",
      "gato",
      "conejo",
      "futbol",
      "balon",
      "deporte",
      "musica",
      "guitarra",
      "familia",
      "amigos",
      "amigas",
      "videojuegos",
      "flores",
      "libros",
      "comida"
    ],
    "distractors": [],
    "hint": "¿Qué vas a dibujar? 🖼️ Pista: empieza por « Voy a dibujar... » — tu mascota, tu deporte... ¡Inténtalo!",
    "reveal": "Por ejemplo: « Voy a dibujar a mi gato y un balón de fútbol ». ¡Ya veo tu autorretrato! 🖼️",
    "success": "",
    "sug": [
      "Voy a dibujar a mi perro.",
      "Voy a dibujar un balón. ¿Y tú qué dibujas?",
      "Voy a dibujar mi guitarra y a mi familia."
    ],
    "vocab": [
      {
        "es": "la mascota",
        "fr": "l'animal de compagnie"
      },
      {
        "es": "el deporte",
        "fr": "le sport"
      },
      {
        "es": "la comida",
        "fr": "la nourriture / le plat"
      },
      {
        "es": "¡cuéntame!",
        "fr": "raconte-moi !"
      }
    ],
    "fr": {
      "ask": "Dernière question d'artiste : imagine ton autoportrait, comme Frida. 🖼️ Qu'est-ce que tu vas dessiner à côté de toi : ton animal, ton sport, ton plat préféré... ? Raconte-moi !",
      "hint": "Qu'est-ce que tu vas dessiner ? 🖼️ Indice : commence par « Je vais dessiner... » — ton animal, ton sport... Essaie !",
      "reveal": "Par exemple : « Je vais dessiner mon chat et un ballon de foot ». Je vois déjà ton autoportrait ! 🖼️",
      "success": ""
    }
  }
], () => "¡Guau, eres artista de verdad! 🎨 Ahora voy a terminar mi Giralda antes de la noche... Mi cuaderno y yo te decimos, con mucho misterio: ¡hasta la próxima leyenda! 👀 Escríbeme otra vez para recomenzar, o habla con Mateo, Valeria o Lucía. (En mode classe, la vraie IA invente de nouvelles histoires à chaque fois !)", { scored: false });
regFrag("¡Guau, eres artista de verdad! 🎨 Ahora voy a terminar mi Giralda antes de la noche... Mi cuaderno y yo te decimos, con mucho misterio: ¡hasta la próxima leyenda! 👀 Escríbeme otra vez para recomenzar, o habla con Mateo, Valeria o Lucía. (En mode classe, la vraie IA invente de nouvelles histoires à chaque fois !)", { fr: "Waouh, tu es un(e) vrai(e) artiste ! 🎨 Maintenant je vais finir ma Giralda avant la nuit... Mon carnet et moi te disons, avec beaucoup de mystère : à la prochaine légende ! 👀 Écris-moi encore pour recommencer, ou parle avec Mateo, Valeria ou Lucía. (En mode classe, la vraie IA invente de nouvelles histoires à chaque fois !)" });

const LUCIA_QUEST_2: Quest = questFromData([
  {
    "ask": "¡Holaaa! 💌 ¡Qué chévere verte otra vez! ¿Sabes qué? ¡Kiwi tiene una palabra nueva! Ahora grita « ¡chévere, chévere! » 🦜 ¿Cómo estás hoy?",
    "accept": [
      "estoy",
      "bien",
      "muy",
      "contento",
      "contenta",
      "feliz",
      "cansado",
      "cansada",
      "chevere",
      "fenomenal",
      "nervioso",
      "nerviosa",
      "emocionado",
      "emocionada",
      "tranquilo",
      "tranquila",
      "aburrido",
      "aburrida"
    ],
    "distractors": [],
    "hint": "¿Cómo estás? 😊 Pista: « Estoy muy bien » o « Estoy cansado / cansada ». ¡Inténtalo!",
    "reveal": "No pasa nada 😊 Puedes decir: « Estoy muy bien, ¿y tú? ». ¡Yo estoy feliz de verte!",
    "success": "¡Qué bien! 😄",
    "reactions": [
      {
        "when": [
          "cansado",
          "cansada",
          "nervioso",
          "nerviosa",
          "aburrido",
          "aburrida",
          "mal",
          "triste",
          "fatal",
          "regular"
        ],
        "text": "¡Ánimo! 💪 Un poco de música y todo va mejor, ¡seguro!",
        "textFr": "Courage ! 💪 Un peu de musique et tout ira mieux, c'est sûr !"
      },
      {
        "when": [
          "contento",
          "contenta",
          "feliz",
          "chevere",
          "fenomenal",
          "bien"
        ],
        "text": "¡Yupi! 🎉 Yo también estoy feliz — ¡me encanta hablar contigo!",
        "textFr": "Youpi ! 🎉 Moi aussi je suis heureuse — j'adore parler avec toi !"
      }
    ],
    "sug": [
      "¡Estoy muy bien!",
      "Estoy contenta, ¿y tú qué tal?",
      "Estoy cansado, tengo muchos deberes."
    ],
    "vocab": [
      {
        "es": "otra vez",
        "fr": "encore une fois, à nouveau"
      },
      {
        "es": "contento / contenta",
        "fr": "content(e)"
      },
      {
        "es": "gritar",
        "fr": "crier"
      },
      {
        "es": "una palabra nueva",
        "fr": "un mot nouveau"
      }
    ],
    "fr": {
      "ask": "Salut !! 💌 Trop cool de te revoir ! Tu sais quoi ? Kiwi a un mot nouveau ! Maintenant il crie « chévere, chévere ! » 🦜 Comment vas-tu aujourd'hui ?",
      "hint": "Comment vas-tu ? 😊 Indice : « Estoy muy bien » (je vais très bien) ou « Estoy cansado / cansada » (je suis fatigué(e)). Essaie !",
      "reveal": "Ce n'est pas grave 😊 Tu peux dire : « Estoy muy bien, ¿y tú? » (je vais très bien, et toi ?). Moi, je suis heureuse de te voir !",
      "success": "Super ! 😄"
    }
  },
  {
    "ask": "Oye, ¡cuéntame de tu colegio! Aquí en Madrid yo como en casa, ¡a las tres de la tarde! En Bogotá mis primos comen a las doce, como en Francia. 😮 ¿Tú comes en la cantina (à la cantine) o en casa?\n[[astuce: Pour dire l'heure : « a la una, a las dos, a las tres... » → « Como a las tres » = je mange à trois heures.]]",
    "accept": [
      "cantina",
      "casa",
      "comedor"
    ],
    "distractors": [
      "cantina",
      "casa"
    ],
    "hint": "¿Cantina o casa? 🍽️ Responde: « Como en la cantina » o « Como en casa ». ¡Inténtalo!",
    "reveal": "Te ayudo: puedes decir « Como en la cantina del colegio » 🍽️ ¡En España comemos más tarde!",
    "success": "¡Qué interesante! 😋",
    "reactions": [
      {
        "when": [
          "cantina",
          "comedor"
        ],
        "text": "¡En la cantina con los amigos! 😄 En España muchos niños comen en casa, ¡a las tres!",
        "textFr": "À la cantine avec les copains ! 😄 En Espagne, beaucoup d'enfants mangent à la maison, à trois heures !"
      },
      {
        "when": [
          "casa"
        ],
        "text": "¡Como yo! 😋 Comer en casa es más tranquilo, ¿verdad?",
        "textFr": "Comme moi ! 😋 Manger à la maison, c'est plus tranquille, pas vrai ?"
      }
    ],
    "sug": [
      "Como en la cantina.",
      "Como en casa, ¿y tú a qué hora comes?",
      "Como en la cantina con mis amigos."
    ],
    "vocab": [
      {
        "es": "la cantina",
        "fr": "la cantine"
      },
      {
        "es": "comer",
        "fr": "manger"
      },
      {
        "es": "a las tres de la tarde",
        "fr": "à trois heures de l'après-midi"
      },
      {
        "es": "los primos",
        "fr": "les cousins"
      }
    ],
    "fr": {
      "ask": "Dis, raconte-moi ton collège ! Ici à Madrid, moi je mange à la maison, à trois heures de l'après-midi ! À Bogotá, mes cousins mangent à midi, comme en France. 😮 Toi, tu manges à la cantine ou à la maison ?",
      "hint": "Cantine ou maison ? 🍽️ Réponds : « Como en la cantina » (je mange à la cantine) ou « Como en casa » (à la maison). Essaie !",
      "reveal": "Je t'aide : tu peux dire « Como en la cantina del colegio » (je mange à la cantine du collège) 🍽️ En Espagne, on mange plus tard !",
      "success": "Comme c'est intéressant ! 😋"
    }
  },
  {
    "ask": "Hoy tengo entrenamiento (entraînement) con mi equipo de vóley. ¡El sábado jugamos un partido súper importante! 🏐 ¿Y tú? ¿Practicas un deporte? 💪",
    "accept": [
      "practico",
      "juego",
      "hago",
      "deporte",
      "futbol",
      "baloncesto",
      "voley",
      "voleibol",
      "natacion",
      "nado",
      "tenis",
      "ciclismo",
      "danza",
      "bailo",
      "gimnasia",
      "atletismo",
      "escalada",
      "equitacion",
      "balonmano",
      "patinaje",
      "ninguno"
    ],
    "distractors": [],
    "hint": "¿Un deporte? 🏐 Pista: « Juego al fútbol » o « No practico ningún deporte ». ¡Inténtalo!",
    "reveal": "Puedes decir: « Juego al baloncesto » o « No practico deporte » 😊 ¡Yo esta semana solo pienso en mi partido del sábado!",
    "success": "¡Qué guay! 💪",
    "reactions": [
      {
        "when": [
          "voley",
          "voleibol"
        ],
        "text": "¡¿Tú también juegas al vóley?! 🏐 ¡Qué chévere! ¡Somos casi un equipo!",
        "textFr": "Toi aussi tu joues au volley ?! 🏐 Trop cool ! On est presque une équipe !"
      },
      {
        "when": [
          "futbol",
          "baloncesto",
          "balonmano"
        ],
        "text": "¡Qué chévere! ⚽ ¡Otro deporte de equipo, como mi vóley!",
        "textFr": "Trop cool ! ⚽ Encore un sport d'équipe, comme mon volley !"
      }
    ],
    "sug": [
      "Juego al fútbol con mis amigos.",
      "No practico deporte. ¿Es difícil el vóley?",
      "Hago natación los miércoles."
    ],
    "vocab": [
      {
        "es": "el entrenamiento",
        "fr": "l'entraînement"
      },
      {
        "es": "el equipo",
        "fr": "l'équipe"
      },
      {
        "es": "el partido",
        "fr": "le match"
      },
      {
        "es": "el sábado",
        "fr": "samedi"
      }
    ],
    "fr": {
      "ask": "Aujourd'hui j'ai entraînement avec mon équipe de volley. Samedi, on joue un match super important ! 🏐 Et toi ? Tu pratiques un sport ? 💪",
      "hint": "Un sport ? 🏐 Indice : « Juego al fútbol » (je joue au foot) ou « No practico ningún deporte » (je ne fais aucun sport). Essaie !",
      "reveal": "Tu peux dire : « Juego al baloncesto » (je joue au basket) ou « No practico deporte » (je ne fais pas de sport) 😊 Moi, cette semaine, je ne pense qu'à mon match de samedi !",
      "success": "Trop cool ! 💪"
    }
  },
  {
    "ask": "Mi madre es de Bogotá y le encanta Fernando Botero, un pintor colombiano muy famoso: ¡en sus cuadros las personas y los gatos son gorditos (tout ronds)! 🎨 Para mí, sus cuadros son más divertidos que una foto. Ahora tú: escribe una comparación con « más ... que ».\n[[astuce: « más ... que » = plus ... que → El vóley es más divertido que los deberes.]]",
    "accept": [
      "mas",
      "divertido",
      "divertida",
      "dificil",
      "facil",
      "interesante",
      "aburrido",
      "aburrida",
      "bonito",
      "bonita",
      "rico",
      "rica",
      "pequeno",
      "rapido",
      "mejor",
      "gordito",
      "gorditos",
      "gordo",
      "gorda",
      "feo",
      "alto"
    ],
    "distractors": [],
    "hint": "Una comparación 😊 Modelo: « El español es más fácil que las matemáticas ». Escribe tu frase con « más ... que ». ¡Inténtalo!",
    "reveal": "Por ejemplo: « Mi gato es más gordito que Kiwi » 😄 ¡Parece un cuadro de Botero!",
    "success": "¡Qué buena comparación! 👏 ¡Eres un artista de las palabras!",
    "sug": [
      "El español es más fácil que las matemáticas.",
      "El vóley es más divertido que el fútbol, ¿no?",
      "Mi perro es más gordito que tu loro."
    ],
    "vocab": [
      {
        "es": "el pintor",
        "fr": "le peintre"
      },
      {
        "es": "gordito / gordita",
        "fr": "tout rond / toute ronde (potelé)"
      },
      {
        "es": "el cuadro",
        "fr": "le tableau"
      },
      {
        "es": "más ... que",
        "fr": "plus ... que"
      }
    ],
    "fr": {
      "ask": "Ma mère est de Bogotá et elle adore Fernando Botero, un peintre colombien très célèbre : dans ses tableaux, les personnes et les chats sont tout ronds ! 🎨 Pour moi, ses tableaux sont plus amusants qu'une photo. À toi maintenant : écris une comparaison avec « más ... que » (plus ... que).",
      "hint": "Une comparaison 😊 Modèle : « El español es más fácil que las matemáticas » (l'espagnol est plus facile que les maths). Écris ta phrase avec « más ... que ». Essaie !",
      "reveal": "Par exemple : « Mi gato es más gordito que Kiwi » (mon chat est plus rond que Kiwi) 😄 On dirait un tableau de Botero !",
      "success": "Quelle bonne comparaison ! 👏 Tu es un artiste des mots !"
    }
  },
  {
    "ask": "En las próximas vacaciones voy a ir a Bogotá, a ver a mis abuelos. ¡Voy a comer ajiaco, una sopa colombiana con pollo, maíz (maïs) y papas! 🥣 ¿Y tú? ¿Qué vas a hacer en las próximas vacaciones?",
    "accept": [
      "voy",
      "visitar",
      "viajar",
      "jugar",
      "ver",
      "leer",
      "descansar",
      "quedarme",
      "comer",
      "casa",
      "playa",
      "montana",
      "piscina",
      "abuelos",
      "familia",
      "amigos",
      "nada",
      "estudiar"
    ],
    "distractors": [],
    "hint": "¿Tus planes? ✈️ Pista: « Voy a + infinitivo » → « Voy a visitar a mi familia ». ¡Inténtalo!",
    "reveal": "Puedes decir: « Voy a descansar y jugar con mis amigos » 😎 ¡Felices vacaciones!",
    "success": "¡Qué buen plan! ✨",
    "sug": [
      "Voy a descansar en casa.",
      "Voy a jugar al fútbol. ¿Está rico el ajiaco?",
      "Voy a visitar a mi abuela en Bretaña."
    ],
    "vocab": [
      {
        "es": "las vacaciones",
        "fr": "les vacances"
      },
      {
        "es": "los abuelos",
        "fr": "les grands-parents"
      },
      {
        "es": "el ajiaco",
        "fr": "l'ajiaco (soupe colombienne)"
      },
      {
        "es": "las papas",
        "fr": "les pommes de terre (en Amérique latine)"
      }
    ],
    "fr": {
      "ask": "Aux prochaines vacances, je vais aller à Bogotá voir mes grands-parents. Je vais manger de l'ajiaco, une soupe colombienne avec du poulet, du maïs et des pommes de terre ! 🥣 Et toi ? Qu'est-ce que tu vas faire aux prochaines vacances ?",
      "hint": "Tes projets ? ✈️ Indice : « Voy a + infinitif » → « Voy a visitar a mi familia » (je vais rendre visite à ma famille). Essaie !",
      "reveal": "Tu peux dire : « Voy a descansar y jugar con mis amigos » (je vais me reposer et jouer avec mes copains) 😎 Bonnes vacances !",
      "success": "Quel bon programme ! ✨"
    }
  }
], () => "¡Ay, qué chévere hablar contigo otra vez! 💌 Me voy al entrenamiento — ¡deséame suerte (souhaite-moi bonne chance) para el partido del sábado! Kiwi grita « ¡chao, chao! » 🦜 Escríbeme otra vez para recomenzar, o habla con otro personaje. (En mode classe, on peut parler de TOUT avec la vraie IA !)", { scored: false });
regFrag("¡Ay, qué chévere hablar contigo otra vez! 💌 Me voy al entrenamiento — ¡deséame suerte (souhaite-moi bonne chance) para el partido del sábado! Kiwi grita « ¡chao, chao! » 🦜 Escríbeme otra vez para recomenzar, o habla con otro personaje. (En mode classe, on peut parler de TOUT avec la vraie IA !)", { fr: "Ah, trop cool de parler avec toi encore une fois ! 💌 Je file à l'entraînement — souhaite-moi bonne chance pour le match de samedi ! Kiwi crie « chao, chao ! » 🦜 Écris-moi encore pour recommencer, ou parle avec un autre personnage. (En mode classe, on peut parler de TOUT avec la vraie IA !)" });

QUESTS.capitan.push(MISSION_2, MISSION_3);
QUESTS.chispa.push(RETO_GUSTAR, RETO_HORA);
QUESTS.mateo.push(MATEO_QUEST_2);
QUESTS.valeria.push(VALERIA_QUEST_2);
QUESTS.diego.push(DIEGO_QUEST_2);
QUESTS.lucia.push(LUCIA_QUEST_2);

const EXISTING_AIDES: Record<string, (StepAides | undefined)[]> = {
  "capitan": [
    {
      "fr": {
        "ask": "Excellent choix, agent ! 🧭 Mission « Opération Calavera » : l'offrande du Jour des Morts a disparu et tu dois la récupérer.\nPremière épreuve, à l'aéroport de Mexico : présente-toi au garde. Écris ton nom et ton âge EN ESPAGNOL pour passer le contrôle.",
        "hint": "Le garde ne te comprend pas... 😅 Indice : en espagnol on dit « Me llamo ... y tengo ... años » (Je m'appelle ... et j'ai ... ans). Réessaie !",
        "reveal": "Le garde t'aide avec un sourire : on dit « Me llamo Léo y tengo 12 años » (Je m'appelle Léo et j'ai 12 ans). Il te laisse passer pour cette fois. 🛂",
        "success": "Parfait, agent ! Le garde te laisse passer. 🛂"
      },
      "sug": [
        "Me llamo Léo y tengo 12 años.",
        "Soy Nina y tengo doce años.",
        "Me llamo Hugo, tengo 12 años y soy francés."
      ],
      "vocab": [
        {
          "es": "la ofrenda",
          "fr": "l'offrande, l'autel des morts"
        },
        {
          "es": "la prueba",
          "fr": "l'épreuve"
        },
        {
          "es": "el guardia",
          "fr": "le garde"
        },
        {
          "es": "la edad",
          "fr": "l'âge"
        }
      ]
    },
    {
      "fr": {
        "ask": "Au marché, la grand-mère Rosa te donne une clé si tu réponds : de quelle couleur est la fleur du Jour des Morts, le cempasúchil ? Bleu, orange ou noir ?",
        "hint": "Mmm, pas exactement... 🌼 Indice : c'est la couleur du soleil et des mandarines. Réessaie !",
        "reveal": "Je t'aide, agent : le cempasúchil est ORANGE (naranja), comme le soleil. 🌼 La grand-mère te donne quand même la clé.",
        "success": "Correct ! Orange comme le soleil ! 🌼 La grand-mère sourit et te donne une clé."
      },
      "sug": [
        "¡Es naranja!",
        "La flor es naranja, ¿verdad?",
        "Naranja, como el sol de México."
      ],
      "vocab": [
        {
          "es": "el mercado",
          "fr": "le marché"
        },
        {
          "es": "la abuela",
          "fr": "la grand-mère"
        },
        {
          "es": "la llave",
          "fr": "la clé"
        },
        {
          "es": "naranja",
          "fr": "orange (couleur)"
        }
      ]
    },
    {
      "fr": {
        "ask": "Avec la clé de la grand-mère, tu arrives à la porte du musée, mais il y a aussi un code : corrige cette phrase pour ouvrir → « Yo soy 12 años ».",
        "hint": "Presque ! 🚪 Indice : en espagnol, pour dire l'âge on utilise le verbe AVOIR (tener), pas être. Réessaie !",
        "reveal": "La porte te le murmure : « Yo TENGO 12 años » (J'AI 12 ans) — tener, le verbe de l'âge ! Elle s'ouvre lentement... 🚪",
        "success": "C'est ça ! « Yo TENGO 12 años » — la porte s'ouvre... 🚪"
      },
      "sug": [
        "Yo tengo 12 años.",
        "Se dice « Yo tengo 12 años », ¿no?",
        "Yo tengo 12 años, ¡como en la vida real!"
      ],
      "vocab": [
        {
          "es": "la puerta",
          "fr": "la porte"
        },
        {
          "es": "el museo",
          "fr": "le musée"
        },
        {
          "es": "corregir",
          "fr": "corriger"
        },
        {
          "es": "la frase",
          "fr": "la phrase"
        }
      ]
    },
    {
      "fr": {
        "ask": "À l'intérieur du musée, tu vois une copie géante d'un tableau en noir et blanc qui représente la guerre, peint par Picasso. Comment s'appelle-t-il ? Indice : ça commence par G...",
        "hint": "Le tableau attend... 🖼️ Indice : ça commence par « Guer- » et c'est le nom d'un village du Pays basque. Réessaie !",
        "reveal": "C'est GUERNICA, de Picasso (1937) — l'original est au musée Reina Sofía, à Madrid. Le tableau te laisse quand même passer. 🖼️",
        "success": "Exact, Guernica ! (L'original est au musée Reina Sofía, à Madrid.) Le tableau te laisse passer. 🖼️"
      },
      "sug": [
        "¡Es el Guernica!",
        "Se llama Guernica, ¿verdad?",
        "El Guernica, de Picasso — ¡lo conozco del colegio!"
      ],
      "vocab": [
        {
          "es": "el cuadro",
          "fr": "le tableau"
        },
        {
          "es": "la guerra",
          "fr": "la guerre"
        },
        {
          "es": "blanco y negro",
          "fr": "noir et blanc"
        },
        {
          "es": "la pista",
          "fr": "l'indice"
        }
      ]
    },
    {
      "fr": {
        "ask": "Le fantôme du musée te parle : « Qu'est-ce que tu aimes faire le week-end ? » Réponds avec une phrase complète en espagnol.",
        "hint": "Le fantôme attend une phrase complète EN ESPAGNOL... 👻 Indice : commence par « Me gusta... » (J'aime...). Essaie !",
        "reveal": "Le fantôme te souffle une réponse : « Me gusta jugar con mis amigos » (J'aime jouer avec mes amis). 👻 La prochaine fois, ce sera ton tour !",
        "success": "Très bien, agent ! Le fantôme adore ta réponse. 👻"
      },
      "sug": [
        "Me gusta jugar al fútbol.",
        "Me gusta escuchar música, ¿y a ti?",
        "Me encanta ver series con mi familia."
      ],
      "vocab": [
        {
          "es": "el fantasma",
          "fr": "le fantôme"
        },
        {
          "es": "el fin de semana",
          "fr": "le week-end"
        },
        {
          "es": "hacer",
          "fr": "faire"
        },
        {
          "es": "una frase completa",
          "fr": "une phrase complète"
        }
      ]
    },
    {
      "fr": {
        "ask": "Dernière épreuve : trouve l'intrus → manzana, plátano, naranja, mochila. Lequel de ces mots n'est pas un fruit ?",
        "hint": "Réfléchis, agent... 🍎 Indice : trois se mangent, une s'emporte à l'école. Réessaie !",
        "reveal": "C'était la MOCHILA ! Ce n'est pas un fruit : c'est le « sac à dos ». 🎒 Mission terminée !",
        "success": "MISSION ACCOMPLIE, agent ! 🎉 La mochila n'est pas un fruit, et l'offrande est sauvée !"
      },
      "sug": [
        "¡Es la mochila!",
        "La mochila no es una fruta, ¿verdad?",
        "¡La mochila! Yo tengo una mochila azul."
      ],
      "vocab": [
        {
          "es": "la manzana",
          "fr": "la pomme"
        },
        {
          "es": "el plátano",
          "fr": "la banane"
        },
        {
          "es": "la mochila",
          "fr": "le sac à dos"
        },
        {
          "es": "el intruso",
          "fr": "l'intrus"
        }
      ]
    }
  ],
  "chispa": [
    {
      "fr": {
        "ask": "Excellente question ! ⚡ SER = la carte d'identité (ce qu'on est toujours) : « Soy francés / francesa » (Je suis français / française). ESTAR = la météo du moment : « Estoy cansado(a) » (Je suis fatigué(e), là, maintenant). Exemple : « Soy alto » (Je suis grand) vs « Estoy triste » (Je suis triste). Tu veux un mini-défi pour t'entraîner ?",
        "success": "Génial, c'est parti !"
      },
      "sug": [
        "¡Sí, quiero practicar!",
        "Sí, ¿es difícil el reto?",
        "¡Vale, vamos!"
      ],
      "vocab": [
        {
          "es": "cansado / cansada",
          "fr": "fatigué(e)"
        },
        {
          "es": "triste",
          "fr": "triste"
        },
        {
          "es": "alto / alta",
          "fr": "grand(e)"
        },
        {
          "es": "el reto",
          "fr": "le défi"
        }
      ]
    },
    {
      "fr": {
        "ask": "Mini-défi ! ⚡ Question 1 sur 3 : complète avec ser ou estar → « Yo ___ estudiante » (Je ___ élève). À toi !",
        "hint": "Presque ! ⚡ Indice : être étudiant, c'est ton identité (carte d'identité → SER). Conjugue ser avec « yo »... Réessaie !",
        "reveal": "La réponse était « SOY » : « Yo soy estudiante » (Je suis élève) — identité → ser.",
        "success": "Très bien ! « Soy estudiante » ✔ (c'est ce que tu es : carte d'identité)."
      },
      "sug": [
        "Yo soy estudiante, ¡claro!",
        "Es « soy », ¿verdad?",
        "Soy estudiante de español."
      ],
      "vocab": [
        {
          "es": "el / la estudiante",
          "fr": "l'élève, l'étudiant(e)"
        },
        {
          "es": "ser",
          "fr": "être (identité)"
        },
        {
          "es": "estar",
          "fr": "être (état, lieu)"
        },
        {
          "es": "la pregunta",
          "fr": "la question"
        }
      ]
    },
    {
      "fr": {
        "ask": "Question 2 sur 3 : « Hoy yo ___ contento (o contenta) » (Aujourd'hui je ___ content(e)) — aujourd'hui = état du moment. À toi !",
        "hint": "Oups ! Indice : « aujourd'hui » = la météo du moment → ESTAR. Conjugue estar avec « yo »... Réessaie !",
        "reveal": "C'était « ESTOY » : « Hoy estoy contento (o contenta) » (Aujourd'hui je suis content(e)) — état du moment → estar.",
        "success": "Parfait ! « Estoy contento » ✔."
      },
      "sug": [
        "Hoy yo estoy contento.",
        "¿Es « estoy »?",
        "Hoy estoy contenta, ¡no hay deberes!"
      ],
      "vocab": [
        {
          "es": "hoy",
          "fr": "aujourd'hui"
        },
        {
          "es": "contento / contenta",
          "fr": "content(e)"
        },
        {
          "es": "estar",
          "fr": "être (état du moment)"
        },
        {
          "es": "los deberes",
          "fr": "les devoirs"
        }
      ]
    },
    {
      "fr": {
        "ask": "Dernière question : « Madrid ___ en España » (Madrid ___ en Espagne). Attention, piège célèbre ! 😉",
        "hint": "C'est le piège ! 😄 Indice : pour situer un lieu, on utilise toujours ESTAR — même si Madrid ne bouge jamais. Réessaie !",
        "reveal": "La réponse était « ESTÁ » : « Madrid está en España » (Madrid est en Espagne) — pour la localisation, toujours estar.",
        "success": "Impressionnant ! « Madrid ESTÁ en España » ✔ — tu as évité le piège célèbre !"
      },
      "sug": [
        "Madrid está en España.",
        "¡Está! Para los lugares, siempre estar.",
        "Madrid está en España, ¡quiero ir un día!"
      ],
      "vocab": [
        {
          "es": "la última pregunta",
          "fr": "la dernière question"
        },
        {
          "es": "España",
          "fr": "l'Espagne"
        },
        {
          "es": "estar en",
          "fr": "être à, se trouver à"
        },
        {
          "es": "la trampa",
          "fr": "le piège"
        }
      ]
    }
  ],
  "mateo": [
    {
      "fr": {
        "ask": "Salut ! 👋 Je suis Mateo, de Madrid. J'ai 13 ans et je suis en 2º de ESO (c'est comme la 4ème en France). Et toi ? Comment tu t'appelles ?",
        "hint": "Ton prénom ? 😊 Écris : « Me llamo ... » (Je m'appelle ...). Essaie !",
        "reveal": "Ce n'est pas grave. 😊 Moi je dis : « Me llamo Mateo » (Je m'appelle Mateo). Enchanté !"
      },
      "sug": [
        "Me llamo Emma.",
        "Me llamo Louis, ¿cómo estás?",
        "Me llamo Chloé y tengo 12 años."
      ],
      "vocab": [
        {
          "es": "me llamo",
          "fr": "je m'appelle"
        },
        {
          "es": "tengo ... años",
          "fr": "j'ai ... ans"
        },
        {
          "es": "estoy en",
          "fr": "je suis en (classe)"
        },
        {
          "es": "¿cómo te llamas?",
          "fr": "comment tu t'appelles ?"
        }
      ]
    },
    {
      "fr": {
        "ask": "Ma matière préférée, c'est l'EPS (Educación Física). Quelle est ta matière préférée ?",
        "hint": "Ta matière préférée ? 📚 Par exemple : Histoire, Maths, Musique, Espagnol... Écris : « Mi asignatura favorita es ... » (Ma matière préférée est ...). Essaie !",
        "reveal": "Je t'aide : tu peux dire « Mi asignatura favorita es Español » (Ma matière préférée est l'espagnol) 😉. La prochaine fois, c'est sûr, tu le diras toi-même !"
      },
      "sug": [
        "Mi asignatura favorita es Historia.",
        "Mi favorita es Música, ¿tienes muchos deberes?",
        "Me gusta el dibujo, dibujo muy bien."
      ],
      "vocab": [
        {
          "es": "la asignatura",
          "fr": "la matière (scolaire)"
        },
        {
          "es": "favorito / favorita",
          "fr": "préféré(e)"
        },
        {
          "es": "la Educación Física",
          "fr": "l'EPS (le sport)"
        },
        {
          "es": "¡mucho gusto!",
          "fr": "enchanté(e) !"
        }
      ]
    },
    {
      "fr": {
        "ask": "Trop cool ! Moi, je n'aime pas les maths... À la récré, je mange un sandwich à la tortilla (omelette espagnole). Et toi, qu'est-ce que tu manges à la récré ?",
        "hint": "Qu'est-ce que tu manges ? 🥪 Indice : « Como una fruta » (Je mange un fruit) ou « Como un bocadillo » (Je mange un sandwich). Essaie en espagnol !",
        "reveal": "Je t'aide : tu peux dire « Como una manzana » 🍎 (Je mange une pomme). Miam !"
      },
      "sug": [
        "Como un bocadillo.",
        "Como fruta, ¿está rico el bocadillo de tortilla?",
        "Como galletas y bebo un zumo de naranja."
      ],
      "vocab": [
        {
          "es": "el recreo",
          "fr": "la récréation"
        },
        {
          "es": "el bocadillo",
          "fr": "le sandwich (baguette)"
        },
        {
          "es": "la tortilla",
          "fr": "l'omelette espagnole"
        },
        {
          "es": "comer",
          "fr": "manger"
        }
      ]
    },
    {
      "fr": {
        "ask": "Miam ! En Espagne, nous déjeunons à deux heures et demie. À quelle heure manges-tu, toi ?",
        "hint": "À quelle heure ? 🕐 Indice : « Como a las doce » (Je mange à midi) ou « a las 12 ». Essaie !",
        "reveal": "Par exemple : « Como a las doce y media » (Je mange à midi et demi). C'est très tôt pour moi !"
      },
      "sug": [
        "Como a las doce.",
        "Como a mediodía, ¿a qué hora cenas tú?",
        "Como a las 12 en el comedor del colegio."
      ],
      "vocab": [
        {
          "es": "la hora",
          "fr": "l'heure"
        },
        {
          "es": "a las dos y media",
          "fr": "à deux heures et demie"
        },
        {
          "es": "comemos",
          "fr": "nous mangeons"
        },
        {
          "es": "¡qué rico!",
          "fr": "que c'est bon ! miam !"
        }
      ]
    },
    {
      "fr": {
        "ask": "Sérieux ? C'est très tôt ! 😄 Moi, j'ai une chienne, elle s'appelle Canela. Tu as un animal de compagnie ?",
        "hint": "Un animal ? 🐶 Réponds : « Sí, tengo un perro » (Oui, j'ai un chien) ou « No, no tengo » (Non, je n'en ai pas). Essaie !",
        "reveal": "Tu peux dire : « No, no tengo mascota » (Non, je n'ai pas d'animal) ou « Sí, tengo un gato » 🐱 (Oui, j'ai un chat)."
      },
      "sug": [
        "Sí, tengo un gato.",
        "No tengo mascota, ¿cómo es Canela?",
        "Tengo un perro negro, se llama Max."
      ],
      "vocab": [
        {
          "es": "la mascota",
          "fr": "l'animal de compagnie"
        },
        {
          "es": "la perra / el perro",
          "fr": "la chienne / le chien"
        },
        {
          "es": "se llama",
          "fr": "il / elle s'appelle"
        },
        {
          "es": "pronto",
          "fr": "tôt"
        }
      ]
    }
  ],
  "valeria": [
    {
      "fr": {
        "ask": "Salut, salut ! 🦋 Je suis Valeria, d'Oaxaca, dans le sud du Mexique. J'adore voyager et prendre des photos de fêtes et de paysages. Tu connais le Mexique, oui ou non ?",
        "hint": "Oui ou non ? 😊 Réponds : « Sí » (Oui) ou « No, no conozco México » (Non, je ne connais pas le Mexique). Essaie !",
        "reveal": "Tu peux dire : « No, no conozco México » — alors je vais te le faire découvrir ! 🦋"
      },
      "sug": [
        "No, no conozco México.",
        "No conozco México, ¿cómo es Oaxaca?",
        "Sí, conozco México un poco, ¡me encanta!"
      ],
      "vocab": [
        {
          "es": "viajar",
          "fr": "voyager"
        },
        {
          "es": "tomar fotos",
          "fr": "prendre des photos"
        },
        {
          "es": "el paisaje",
          "fr": "le paysage"
        },
        {
          "es": "conocer",
          "fr": "connaître"
        }
      ]
    },
    {
      "fr": {
        "ask": "Órale (waouh) ! Tu sais ce que c'est, le Jour des Morts ? Les 1er et 2 novembre, au Mexique, nous faisons des autels avec des fleurs orange, le cempasúchil. Est-ce qu'en France il y a une fête qui ressemble ?",
        "hint": "Pense à la France... 🎃 Indice : « Sí, hay una fiesta: Halloween » (Oui, il y a une fête : Halloween) ou « la Toussaint ». Essaie !",
        "reveal": "En France, on fête la Toussaint, le 1er novembre — un peu pareil ! 🕯️"
      },
      "sug": [
        "Sí, hay una fiesta: la Toussaint.",
        "Sí, hay Halloween. ¿Hay dulces en México?",
        "En Francia tenemos la Toussaint, visito el cementerio con mi familia."
      ],
      "vocab": [
        {
          "es": "el Día de Muertos",
          "fr": "le Jour des Morts"
        },
        {
          "es": "el altar",
          "fr": "l'autel"
        },
        {
          "es": "el cempasúchil",
          "fr": "l'œillet d'Inde (fleur orange)"
        },
        {
          "es": "parecido / parecida",
          "fr": "semblable, qui ressemble"
        }
      ]
    },
    {
      "fr": {
        "ask": "Comme c'est intéressant ! 🦋 Moi, j'ai visité les montagnes où dorment les papillons monarques. Ils sont des millions et ils volent depuis le Canada. Tu aimes les animaux ?",
        "hint": "Tu les aimes ? 🦋 Réponds : « Sí, me gustan » (Oui, je les aime) ou « No, no me gustan » (Non, je ne les aime pas). Attention : gustan avec un N (pluriel) !",
        "reveal": "On dit : « Sí, me gustan los animales » (Oui, j'aime les animaux) — gustan, avec un N, car c'est pluriel. 😉"
      },
      "sug": [
        "Sí, me gustan los animales.",
        "Me encantan los animales, ¿son grandes las mariposas?",
        "Sí, me gustan mucho, tengo dos gatos."
      ],
      "vocab": [
        {
          "es": "la mariposa",
          "fr": "le papillon"
        },
        {
          "es": "la montaña",
          "fr": "la montagne"
        },
        {
          "es": "volar (vuelan)",
          "fr": "voler (ils volent)"
        },
        {
          "es": "dormir (duermen)",
          "fr": "dormir (ils dorment)"
        }
      ]
    },
    {
      "fr": {
        "ask": "La neta (franchement), mon plat préféré c'est le mole, une sauce avec du chocolat et du piment. Quel est ton plat préféré ?",
        "hint": "Ton plat préféré ? 🍽️ Écris : « Mi comida favorita es la pizza » (Mon plat préféré est la pizza), par exemple. Essaie !",
        "reveal": "Tu peux dire : « Mi comida favorita es la pasta » 🍝 (Mon plat préféré, ce sont les pâtes). Franchement, tout est bon !"
      },
      "sug": [
        "Mi comida favorita es la pizza.",
        "Me gusta la pasta, ¿pica mucho el mole?",
        "Mi comida favorita son las crepes de mi abuela."
      ],
      "vocab": [
        {
          "es": "la comida",
          "fr": "le plat, la nourriture"
        },
        {
          "es": "la salsa",
          "fr": "la sauce"
        },
        {
          "es": "el chile",
          "fr": "le piment"
        },
        {
          "es": "la neta",
          "fr": "franchement, la vérité (Mexique)"
        }
      ]
    },
    {
      "fr": {
        "ask": "Padrísimo (trop bien) ! Un jour, je veux voir le Machu Picchu, au Pérou. Et toi, quel pays veux-tu visiter ?",
        "hint": "Quel pays ? 🌎 Écris : « Quiero visitar España » (Je veux visiter l'Espagne), par exemple. Essaie !",
        "reveal": "Par exemple : « Quiero visitar México » 🇲🇽 (Je veux visiter le Mexique) — órale, bon choix !"
      },
      "sug": [
        "Quiero visitar España.",
        "Quiero visitar Perú, ¡como tú!",
        "Quiero visitar Japón con mi familia."
      ],
      "vocab": [
        {
          "es": "el país",
          "fr": "le pays"
        },
        {
          "es": "querer (quiero)",
          "fr": "vouloir (je veux)"
        },
        {
          "es": "visitar",
          "fr": "visiter"
        },
        {
          "es": "¡padrísimo!",
          "fr": "trop bien ! (Mexique)"
        }
      ]
    }
  ],
  "diego": [
    {
      "fr": {
        "ask": "Salut ! 🎨 Je suis Diego, de Séville. J'adore l'art, la musique et les légendes mystérieuses. Je te raconte une histoire ? Réponds : oui ou non.",
        "hint": "Oui ou non ? 🎨 Réponds simplement : « Sí » (Oui) ou « No » (Non). Essaie !",
        "reveal": "J'imagine que c'est oui... 😄 Je te la raconte !"
      },
      "sug": [
        "¡Vale, cuéntame!",
        "Sí, ¿es una historia de miedo?",
        "¡Sí! Me encantan las leyendas misteriosas."
      ],
      "vocab": [
        {
          "es": "la leyenda",
          "fr": "la légende"
        },
        {
          "es": "misterioso / misteriosa",
          "fr": "mystérieux / mystérieuse"
        },
        {
          "es": "contar (te cuento)",
          "fr": "raconter (je te raconte)"
        },
        {
          "es": "la historia",
          "fr": "l'histoire"
        }
      ]
    },
    {
      "fr": {
        "ask": "On raconte qu'au musée du Prado il y a un tableau très mystérieux : Les Ménines de Velázquez. Le peintre est À L'INTÉRIEUR de son propre tableau, en train de te regarder, toi... 👀 Tu trouves ça beau ou étrange ?",
        "hint": "Qu'est-ce que tu ressens ? 🎨 Réponds : « Me parece bonito » (Je trouve ça beau) ou « Me parece extraño » (Je trouve ça étrange). Essaie !",
        "reveal": "Tu peux dire : « Me parece misterioso » (Je trouve ça mystérieux) 👀. Moi aussi !"
      },
      "sug": [
        "Me parece bonito.",
        "Me parece extraño, ¿por qué está dentro?",
        "Me parece misterioso, ¡me gustan los misterios!"
      ],
      "vocab": [
        {
          "es": "el cuadro",
          "fr": "le tableau"
        },
        {
          "es": "el pintor",
          "fr": "le peintre"
        },
        {
          "es": "dentro de",
          "fr": "à l'intérieur de"
        },
        {
          "es": "extraño / extraña",
          "fr": "étrange"
        }
      ]
    },
    {
      "fr": {
        "ask": "Moi aussi ! Tu sais ce qui s'est passé ensuite ? Picasso a regardé Les Ménines et en a peint 58 versions ! Les artistes s'inspirent les uns des autres. Tu aimes dessiner ou peindre ?",
        "hint": "Réponds : « Sí, me gusta dibujar » (Oui, j'aime dessiner) ou « No, no me gusta » (Non, je n'aime pas). 🖌️ Essaie !",
        "reveal": "On dit : « Me gusta dibujar » (J'aime dessiner) — gustar + infinitif. 😉"
      },
      "sug": [
        "Sí, me gusta dibujar.",
        "Me gusta pintar, ¡pero dibujo muy mal!",
        "Me encanta dibujar manga en mi cuaderno."
      ],
      "vocab": [
        {
          "es": "el / la artista",
          "fr": "l'artiste"
        },
        {
          "es": "dibujar",
          "fr": "dessiner"
        },
        {
          "es": "pintar",
          "fr": "peindre"
        },
        {
          "es": "inspirarse",
          "fr": "s'inspirer"
        }
      ]
    },
    {
      "fr": {
        "ask": "Alors tu vas adorer cette histoire : en Espagne, le Ratoncito Pérez (le petit rat Pérez) prend les dents des enfants, comme la petite souris ! Qu'est-ce que tu ressens : de la surprise ou de la joie ?",
        "hint": "Surprise ou joie ? 🐭 Réponds : « Siento sorpresa » (Je ressens de la surprise) ou simplement « ¡Sorpresa! ». Essaie !",
        "reveal": "Tu peux dire : « ¡Qué sorpresa! » (Quelle surprise !) 😄"
      },
      "sug": [
        "¡Qué sorpresa!",
        "Siento alegría, ¿el ratoncito da dinero?",
        "Siento sorpresa, ¡es como en Francia!"
      ],
      "vocab": [
        {
          "es": "el diente",
          "fr": "la dent"
        },
        {
          "es": "el ratoncito",
          "fr": "le petit rat, la petite souris"
        },
        {
          "es": "la sorpresa",
          "fr": "la surprise"
        },
        {
          "es": "la alegría",
          "fr": "la joie"
        }
      ]
    },
    {
      "fr": {
        "ask": "Le flamenco, c'est de la joie et de la tristesse en même temps. Ma tante Carmen danse avec une magnifique robe rouge. Et toi, quelle musique écoutes-tu ?",
        "hint": "Ta musique ? 🎵 Écris : « Escucho pop » (J'écoute de la pop) ou « Escucho rap ». Essaie !",
        "reveal": "Par exemple : « Escucho pop » 🎧 (J'écoute de la pop). Bon choix !"
      },
      "sug": [
        "Escucho pop.",
        "Escucho rap, ¿es difícil el flamenco?",
        "Escucho de todo, ¡me encanta la música!"
      ],
      "vocab": [
        {
          "es": "la tristeza",
          "fr": "la tristesse"
        },
        {
          "es": "bailar",
          "fr": "danser"
        },
        {
          "es": "el vestido",
          "fr": "la robe"
        },
        {
          "es": "escuchar",
          "fr": "écouter"
        }
      ]
    }
  ],
  "lucia": [
    {
      "fr": {
        "ask": "Salut ! 💌 Je suis Lucía. J'habite à Madrid, mais ma famille est de Bogotá, en Colombie. Avec toi, je peux parler de TOUT : musique, jeux, séries, sport... Et toi, qu'est-ce que tu aimes ?",
        "hint": "Ce que tu veux ! 💌 Écris : « Me gusta la música » (J'aime la musique) ou « Me gustan los videojuegos » (J'aime les jeux vidéo). Essaie !",
        "reveal": "Par exemple : « Me gusta la música » 🎶 (J'aime la musique) — moi aussi !"
      },
      "sug": [
        "Me gusta la música.",
        "Me gustan los videojuegos, ¿y a ti?",
        "Me encanta el fútbol, juego los sábados."
      ],
      "vocab": [
        {
          "es": "vivo en",
          "fr": "j'habite à"
        },
        {
          "es": "la familia",
          "fr": "la famille"
        },
        {
          "es": "hablar de",
          "fr": "parler de"
        },
        {
          "es": "el deporte",
          "fr": "le sport"
        }
      ]
    },
    {
      "fr": {
        "ask": "Trop cool ! 😍 Moi, j'adore la musique, je chante dans une chorale. En été, à Bogotá, j'écoute du vallenato avec mes cousins. Et toi, quelle musique écoutes-tu ?",
        "hint": "🎵 Écris : « Escucho pop » (J'écoute de la pop) — ou rap, rock, reggaetón... Essaie !",
        "reveal": "Tu peux dire : « Escucho de todo » 🎧 (J'écoute de tout), comme moi !"
      },
      "sug": [
        "Escucho pop y rap.",
        "Escucho reggaetón, ¿qué es el vallenato?",
        "Escucho de todo, canto en la ducha."
      ],
      "vocab": [
        {
          "es": "el coro",
          "fr": "la chorale"
        },
        {
          "es": "cantar (canto)",
          "fr": "chanter (je chante)"
        },
        {
          "es": "el verano",
          "fr": "l'été"
        },
        {
          "es": "los primos",
          "fr": "les cousins"
        }
      ]
    },
    {
      "fr": {
        "ask": "Pas possible ! Moi aussi ! 😄 En Colombie, on dit « ¡qué chévere! », en Espagne ils disent « ¡qué guay! » (trop cool !). Tu préfères les jeux vidéo ou les séries ?",
        "hint": "Jeux vidéo ou séries ? 🎮 Réponds : « Prefiero los videojuegos » (Je préfère les jeux vidéo) ou « Prefiero las series » (Je préfère les séries). Essaie !",
        "reveal": "On dit : « Prefiero los videojuegos » (Je préfère les jeux vidéo) — préférer → preferir. 😉"
      },
      "sug": [
        "Prefiero los videojuegos.",
        "Prefiero las series, ¿cuál es tu serie favorita?",
        "Prefiero los videojuegos, juego a Mario Kart."
      ],
      "vocab": [
        {
          "es": "¡qué chévere!",
          "fr": "trop cool ! (Colombie)"
        },
        {
          "es": "¡qué guay!",
          "fr": "trop cool ! (Espagne)"
        },
        {
          "es": "preferir (prefiero)",
          "fr": "préférer (je préfère)"
        },
        {
          "es": "los videojuegos",
          "fr": "les jeux vidéo"
        }
      ]
    },
    {
      "fr": {
        "ask": "Moi, j'ai un perroquet qui s'appelle Kiwi 🦜 et il répète « ¡hola, hola! » toute la journée. Tu as un animal de compagnie, ou tu en veux un ?",
        "hint": "🐾 Réponds : « Tengo un gato » (J'ai un chat), « Quiero un perro » (Je veux un chien) ou « No tengo » (Je n'en ai pas). Essaie !",
        "reveal": "Tu peux dire : « Quiero un perro » 🐶 (Je veux un chien) — moi aussi j'en veux un autre !"
      },
      "sug": [
        "Sí, tengo un hámster.",
        "Quiero un perro, ¿Kiwi habla mucho?",
        "Tengo dos peces y quiero una tortuga."
      ],
      "vocab": [
        {
          "es": "el loro",
          "fr": "le perroquet"
        },
        {
          "es": "repetir (repite)",
          "fr": "répéter (il répète)"
        },
        {
          "es": "todo el día",
          "fr": "toute la journée"
        },
        {
          "es": "la mascota",
          "fr": "l'animal de compagnie"
        }
      ]
    },
    {
      "fr": {
        "ask": "Hahaha ! Raconte-moi : qu'est-ce que tu vas faire ce week-end ? Moi, je vais jouer au volley avec mes copines.",
        "hint": "Le futur proche : « Voy a + ... » (Je vais...) 😊 Exemple : « Voy a jugar al fútbol » (Je vais jouer au foot). Essaie !",
        "reveal": "Par exemple : « Voy a ver una serie » 📺 (Je vais regarder une série). Bon week-end !"
      },
      "sug": [
        "Voy a jugar al fútbol.",
        "Voy a ver una serie, ¿tú juegas bien al vóley?",
        "Voy a dormir mucho y a leer un manga."
      ],
      "vocab": [
        {
          "es": "el fin de semana",
          "fr": "le week-end"
        },
        {
          "es": "voy a + infinitif",
          "fr": "je vais + verbe (futur proche)"
        },
        {
          "es": "jugar al vóley",
          "fr": "jouer au volley"
        },
        {
          "es": "cuéntame",
          "fr": "raconte-moi"
        }
      ]
    }
  ]
};

{
  const MAP: Record<string, Quest> = {
    capitan: MISSION_QUEST,
    chispa: CHISPA_QUEST,
    mateo: MATEO_QUEST,
    valeria: VALERIA_QUEST,
    diego: DIEGO_QUEST,
    lucia: LUCIA_QUEST,
  };
  for (const [id, list] of Object.entries(EXISTING_AIDES)) {
    list.forEach((a, i) => {
      const step = MAP[id]?.steps[i];
      if (step) registerStepAides(step, a);
    });
  }
}

const STARTER_FR: Record<string, string> = {
  "capitan": "🧭 Bienvenue, agent ! Je suis le Capitán Misión. J'ai des missions secrètes pour toi : six épreuves qui mélangent culture, art, voyages et vie quotidienne... Tu es prêt ? Prête ? Choisis : 1️⃣ Opération Calavera · 2️⃣ Le tableau disparu · 3️⃣ Mission surprise",
  "chispa": "Salut ! ⚡ Je suis le Professeur Chispa. Je peux t'expliquer la grammaire en français, tout simplement, et te proposer des mini-défis en espagnol. Tu peux me demander par exemple : « c'est quoi la différence entre ser et estar ? » — ou dis « reto » (défi) pour un mini-défi. On commence ?",
  "mateo": "Salut ! 👋 Je suis Mateo, de Madrid. J'ai 13 ans et je suis en 2º de ESO (c'est comme la 4ème en France). Et toi ? Comment tu t'appelles ?",
  "valeria": "Salut, salut ! 🦋 Je suis Valeria, d'Oaxaca, dans le sud du Mexique. J'adore voyager et prendre des photos de fêtes et de paysages. Tu connais le Mexique, oui ou non ?",
  "diego": "Salut ! 🎨 Je suis Diego, de Séville. J'adore l'art, la musique et les légendes mystérieuses. Je te raconte une histoire ? Réponds : oui ou non.",
  "lucia": "Salut ! 💌 Je suis Lucía. J'habite à Madrid, mais ma famille est de Bogotá, en Colombie. Avec toi, je peux parler de TOUT : musique, jeux, séries, sport... Et toi, qu'est-ce que tu aimes ?"
};
for (const a of AGENTS) regFrag(a.starter, { fr: STARTER_FR[a.id] });

regFrag(QUESTS.mateo[0].final([]), { fr: "Trop cool de parler avec toi ! 😄 Maintenant je vais m'entraîner au foot. Écris-moi encore pour recommencer, ou parle avec Valeria, Diego ou Lucía. À plus ! ⚽ (En mode classe, la vraie IA fait continuer la conversation librement !)" });
regFrag(QUESTS.valeria[0].final([]), { fr: "Trop bien de parler avec toi ! 🦋 Je vais prendre des photos au marché. Écris-moi encore pour recommencer, ou parle avec un autre personnage. À bientôt ! (En mode classe, la vraie IA continue la conversation librement !)" });
regFrag(QUESTS.diego[0].final([]), { fr: "C'était génial, artiste ! 🎨 Je vais dessiner au bord du fleuve. Écris-moi encore pour recommencer, ou parle avec un autre personnage. À plus ! (En mode classe, la vraie IA invente de nouvelles histoires à chaque fois !)" });
regFrag(QUESTS.lucia[0].final([]), { fr: "Trop cool de parler avec toi ! 💌 Kiwi dit « ¡adiós, adiós! » (au revoir !) 🦜 Écris-moi encore pour recommencer, ou parle avec un autre personnage. (En mode classe, on peut parler de TOUT avec la vraie IA !)" });

regFrag("¡Has viajado, has hablado y has demostrado tu español, agente!", {
  fr: "Tu as voyagé, tu as parlé et tu as montré ton espagnol, agent !",
});
regFrag(
  "¿Otra misión, agente? Escríbeme (o elige: 1️⃣ Calavera · 2️⃣ Cuadro · 3️⃣ Sorpresa) y seguimos. (Mission de démonstration — en mode classe ou avec une clé API, les missions sont générées par l'IA.)",
  {
    fr: "Une autre mission, agent ? Écris-moi (ou choisis : 1️⃣ Calavera · 2️⃣ Cuadro · 3️⃣ Sorpresa) et on continue. (Mission de démonstration — en mode classe ou avec une clé API, les missions sont générées par l'IA.)",
  },
);
regFrag(
  "¿Otro reto? Escríbeme y te propongo un desafío diferente. ⚡ (En mode classe, les défis sont générés par l'IA et changent à chaque fois !)",
  {
    fr: "Un autre défi ? Écris-moi et je t'en propose un différent. ⚡ (En mode classe, les défis sont générés par l'IA et changent à chaque fois !)",
  },
);
