# 🦜 ¡Charlemos! — Conversation en espagnol pour collégiens

Application web gamifiée d'entraînement à l'espagnol (CECRL A1 → B1, cycle 4) : les
élèves discutent à l'écrit **et à l'oral** (dictée vocale + prononciation audio) avec
6 personnages IA complémentaires, gagnent des XP, remplissent leur carnet de mots et
relèvent les missions d'évaluation du Capitán Misión.

## Les 6 personnages

| Personnage | Thème | Niveau | Rôle |
|---|---|---|---|
| 👦 **Mateo** (Madrid) | École & vie quotidienne | A1 · A1+ | Dialogue entre pairs : collège, famille, routine, loisirs |
| 🦋 **Valeria** (Oaxaca) | Voyages & traditions | A2 | Anecdotes culturelles (Día de Muertos, gastronomie...) + questions ouvertes |
| 🎨 **Diego** (Séville) | Arts, contes & légendes | A2 · B1- | Micro-récits, œuvres célèbres, expression des goûts et émotions |
| 💌 **Lucía** (Madrid/Bogotá) | Conversation libre | Adaptatif | Correspondante ouverte à tous les sujets, s'ajuste au niveau de l'élève |
| 🧙 **Profesor Chispa** | Grammaire & vocabulaire | Adaptatif | Explications simples (en français si besoin) + mini-défis ciblés |
| 🧭 **Capitán Misión** | Bilan transversal | A1+ → B1- | Missions secrètes en 6 étapes + rapport de compétences (score /12) |

Chaque message IA propose 3 aides : 🌐 traduction française, 📖 vocabulaire clé
(ajoutable au carnet, avec audio), 💡 3 suggestions de réponses pour débloquer l'élève.
Les erreurs sont corrigées par **reformulation bienveillante** (recast) avec un badge
discret « 💡 Astuce ».

## Démarrage rapide

Prérequis : [Node.js](https://nodejs.org) 20+ (installé : ✔) et Chrome ou Edge
(recommandé pour la dictée vocale).

```bash
cd C:\Users\ameli\dev\charlemos
npm run dev
```

Puis ouvrir **http://localhost:5173**.

> ⚠️ Le projet vit sur `C:\Users\ameli\dev\charlemos` (disque local) et non dans le
> dossier Google Drive : le dossier `node_modules` (des milliers de petits fichiers)
> est incompatible avec la synchronisation Drive. Une archive des sources peut être
> conservée dans Drive en sauvegarde.

## Configurer l'accès à l'IA (professeur)

1. Créer un compte sur **console.anthropic.com**, ajouter un petit crédit prépayé
   (Billing), puis générer une clé dans **API Keys**.
2. Dans l'application : ⚙️ Réglages → coller la clé. Elle est stockée **uniquement
   dans le navigateur de l'appareil** (localStorage), jamais envoyée ailleurs qu'à
   l'API Anthropic.
3. Choisir le modèle :
   - **Claude Opus 5** (par défaut) — qualité maximale ;
   - **Claude Sonnet 5** — très bon et moins coûteux ;
   - **Claude Haiku 4.5** — le plus économique, largement suffisant pour des
     dialogues A1/A2 : conseillé pour un usage en classe entière.

Ordre de grandeur : un échange de dialogue consomme quelques centaines de tokens ;
même une séance de classe entière revient à quelques dizaines de centimes avec Haiku
(voir les tarifs actuels sur anthropic.com/pricing).

**Mode démo** (⚙️ Réglages) : sans clé, les personnages répondent avec des messages
préenregistrés — idéal pour découvrir l'interface ou projeter une démonstration.

## Idées de mise en œuvre en classe

- **Différenciation** : le sélecteur de niveau (A1 → B1 / Auto) en haut du chat adapte
  la complexité des réponses de l'IA — même activité, exigence différente par îlot.
- **Rituel de début d'heure** : 5 minutes avec Mateo (routine, date, météo, week-end).
- **Séquence culture** : Valeria ou Diego en salle info, puis mise en commun des
  anecdotes récoltées ; le carnet de mots se copie en un clic pour le cahier.
- **Remédiation** : Profesor Chispa en autonomie sur une notion vue en cours
  (ser/estar, gustar, passé composé vs passé simple espagnol).
- **Évaluation formative ludique** : mission du Capitán en fin de séquence ; le rapport
  final donne un score par compétence (compréhension / expression / lexique) et un
  conseil de révision personnalisé.
- Les élèves saisissent **uniquement leur prénom** ; conversations, XP et carnet
  restent sur le poste (pensez à « Tout effacer » entre deux classes, ou attribuez un
  poste par élève).

## Sécurité, cadre et RGPD

- Les system prompts imposent un **cadre scolaire strict** : recentrage automatique en
  cas de dérive, refus des données personnelles, orientation vers un adulte de
  confiance (et le 3018) si un élève exprime un mal-être. Une supervision de
  l'enseignant reste bien sûr nécessaire, comme pour tout outil numérique.
- Aucune donnée n'est stockée sur un serveur de l'application (il n'y en a pas) :
  tout est local à l'appareil ; seuls les messages du chat transitent vers l'API
  Anthropic pour générer les réponses.
- Sur un poste partagé : retirer la clé API après le cours (⚙️) ; révoquer les clés en
  fin d'année sur console.anthropic.com.

## Personnaliser les personnages

Chaque personnage est un simple fichier dans `src/lib/agents/` (mateo.ts, valeria.ts,
diego.ts, lucia.ts, chispa.ts, capitan.ts) : identité, thèmes, vocabulaire cible,
message d'accueil... Modifiez le texte `persona` pour l'aligner sur vos séquences
(par exemple vos 6 unités A1 et vos documents authentiques). Les règles communes
(recast, niveaux CECRL, sécurité) sont dans `src/lib/agents/index.ts`, les badges dans
`src/lib/gamification.ts`.

## Architecture technique

- **Vite + React + TypeScript**, styles **Tailwind CSS v4**, animations
  **Framer Motion**, icônes **Lucide**.
- **SDK officiel `@anthropic-ai/sdk`** appelé directement depuis le navigateur
  (streaming des réponses en temps réel, cache du system prompt, fallbacks de
  sécurité serveur sur Opus 5).
- **Web Speech API** : synthèse vocale espagnole (es-ES / es-MX selon le personnage,
  débit ralenti) et reconnaissance vocale es-ES.
- **localStorage** : conversations par personnage, niveau choisi, carnet de mots,
  bloc-notes, XP / série / badges, réglages.

```
src/
  lib/
    agents/        ← les 6 personnages + règles pédagogiques communes
    api.ts         ← moteur IA (streaming, traduction, vocabulaire, suggestions)
    demo.ts        ← mode démo hors connexion
    gamification.ts, speech.ts, storage.ts, markers.ts, types.ts, context.ts
  components/      ← Hub, Chat, MessageBubble, SidePanel, Mission, Dashboard...
```

## Commandes

```bash
npm run dev       # serveur de développement (http://localhost:5173)
npm run build     # vérification TypeScript + build de production dans dist/
npm run preview   # prévisualiser le build
```

Pour déployer : `npm run build` puis héberger le dossier `dist/` (Netlify Drop,
Vercel...). Chaque utilisateur saisit sa clé dans ses réglages ; ne publiez jamais une
clé API dans le code.

## Dépannage

- **Le micro ne fonctionne pas** : utiliser Chrome ou Edge, autoriser le micro pour
  localhost ; la reconnaissance vocale nécessite une connexion Internet.
- **Pas de voix espagnole** : Windows → Paramètres → Heure et langue → Voix → ajouter
  une voix espagnole (ou utiliser Chrome, qui embarque des voix Google).
- **« Clé API invalide »** : vérifier la clé dans ⚙️ ; **« crédit épuisé »** :
  recharger sur console.anthropic.com → Billing.
