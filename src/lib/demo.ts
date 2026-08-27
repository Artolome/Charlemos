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
//
// Limite connue : les conversations démo enregistrées AVANT cette version
// peuvent se rejouer différemment ; il suffit de réinitialiser la
// conversation (bouton corbeille).

import type { AgentDef, ChatMessage } from "./types";

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

/**
 * Rejoue de façon déterministe tous les messages de l'élève pour retrouver
 * l'état de la quête, et renvoie la réponse au dernier message.
 */
function runQuest(quest: Quest, userMessages: string[]): string {
  let pos = quest.firstAskIsStarter ? 0 : -1;
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
      if (step.scored !== false) results.push(attempts === 0 ? 2 : 1);
      pos++;
      attempts = 0;
      const next = pos < quest.steps.length ? quest.steps[pos].ask : quest.final(results);
      reply = [step.success, next].filter(Boolean).join("\n\n");
    } else if (attempts === 0) {
      attempts = 1;
      reply = foreign ? `${FOREIGN_NUDGE[foreign]}\n\n${step.hint}` : step.hint;
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
      success: "",
      scored: false,
    },
    {
      ask: "¡Genial! 😃 ¡Mucho gusto! Mi asignatura favorita es Educación Física. ¿Cuál es tu asignatura favorita?",
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

const QUESTS: Record<string, Quest> = {
  capitan: MISSION_QUEST,
  chispa: CHISPA_QUEST,
  mateo: MATEO_QUEST,
  valeria: VALERIA_QUEST,
  diego: DIEGO_QUEST,
  lucia: LUCIA_QUEST,
};

// ---------------------------------------------------------------
// Point d'entrée du moteur démo
// ---------------------------------------------------------------

/** Calcule la réponse démo (exposé séparément pour les tests) */
export function demoReplyFor(agent: AgentDef, history: ChatMessage[]): string {
  const userMessages = history.filter((m) => m.role === "user").map((m) => m.content);
  const quest = QUESTS[agent.id] ?? QUESTS.mateo;
  return runQuest(quest, userMessages);
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
