# 🚀 Mise en service du mode classe (comptes élèves) et de GitHub Pages

Ce guide se fait une seule fois, en ~20 minutes. À la fin :
- chaque élève a un **compte** (prénom + code de classe + mot de passe) et retrouve
  ses conversations, XP et carnet depuis n'importe quel poste ;
- tu as un **tableau de bord professeur** (« Ma classe ») : suivi des élèves,
  lecture des conversations, rapports de mission, export CSV ;
- la **clé API Anthropic reste secrète sur le serveur** : plus rien à saisir sur
  les postes élèves ;
- l'application est **en ligne** sur une URL GitHub Pages.

---

## Partie 1 — Supabase (base de données + comptes + proxy IA)

### 1. Créer le projet
1. Va sur **supabase.com** → *Start your project* → crée un compte (gratuit).
2. *New project* : nom `charlemos`, région **West EU (Paris/Frankfurt)**, note le
   mot de passe de base de données quelque part (il ne resservira pas au quotidien).

### 2. Créer les tables et la sécurité
1. Menu **SQL Editor** → *New query*.
2. Ouvre le fichier `supabase/setup.sql` de ce projet, copie **tout** son contenu,
   colle-le, puis clique **Run**. Tu dois voir « Success ».

### 3. Autoriser les comptes sans confirmation d'e-mail
Les élèves n'ont pas de vraie adresse e-mail (l'application fabrique un identifiant
technique invisible) :
1. Menu **Authentication** → **Sign In / Providers** → **Email**.
2. Désactive **« Confirm email »** → *Save*.

### 4. Déployer la fonction IA (le proxy qui garde ta clé)
1. Menu **Edge Functions** → *Deploy a new function* → **Via Editor**.
2. Nom de la fonction : `charlemos-ia` (exactement).
3. Dans l'éditeur : remplace le contenu de `index.ts` par celui du fichier
   `supabase/functions/charlemos-ia/index.ts` de ce projet.
4. Ajoute un second fichier nommé `prompts.ts` (bouton « + » / *Add file*) et
   colle le contenu de `supabase/functions/charlemos-ia/prompts.ts`.
5. Clique **Deploy**.

> Alternative pour les à-l'aise en ligne de commande : `npx supabase functions deploy charlemos-ia`.

### 5. Donner la clé API au serveur (et à lui seul)
1. Sur **console.anthropic.com** : crée une clé API dédiée « charlemos-classe »
   (et fixe une limite de dépense dans Settings → Limits, par prudence).
2. Dans Supabase : **Edge Functions** → **Secrets** → *Add new secret* :
   - Nom : `ANTHROPIC_API_KEY`
   - Valeur : ta clé `sk-ant-...`
3. C'est le seul endroit où la clé existe. Les élèves ne la voient jamais.

### 6. Brancher l'application
1. Dans Supabase : **Project Settings** → **API** (ou *Data API*) : copie
   **Project URL** et la clé **anon public**.
2. Dans le projet, ouvre `src/config.ts` et remplis :
   ```ts
   export const SUPABASE_URL = "https://TON-PROJET.supabase.co";
   export const SUPABASE_ANON_KEY = "eyJ...";
   ```
   (Ces deux valeurs sont publiques par conception — la sécurité vient des règles
   RLS installées à l'étape 2 et du secret de l'étape 5.)

### 7. Premier lancement
1. Lance l'application (`LANCER-CHARLEMOS.bat`) : un écran de connexion apparaît.
2. Onglet **Professeur** → « Créer un compte professeur » (ton e-mail + mot de passe).
3. Menu **Ma classe** → crée ta classe : un **code à 6 caractères** est généré.
4. Les élèves : onglet **Élève** → « Crée ton compte » → prénom + code + mot de passe.
   (Deux élèves avec le même prénom dans la classe : le second ajoute une initiale,
   ex. « Léa B ».)

---

## Partie 2 — GitHub Pages (mise en ligne)

Le dépôt local est déjà prêt (git + workflow de déploiement automatique).

1. Crée un compte sur **github.com** si besoin.
2. Crée un dépôt **public** nommé exactement `charlemos` (bouton « + » → *New
   repository*, sans README ni .gitignore — le projet les a déjà).
3. Dans un terminal, pousse le projet (remplace `TONPSEUDO`) :
   ```
   cd C:\Users\ameli\dev\charlemos
   git remote add origin https://github.com/TONPSEUDO/charlemos.git
   git push -u origin main
   ```
   (Une fenêtre GitHub s'ouvre pour t'authentifier la première fois.)
4. Sur GitHub : **Settings** → **Pages** → *Source* : **GitHub Actions**.
5. Attends ~2 minutes (onglet *Actions* montre le déploiement), puis l'application
   est en ligne sur :
   `https://TONPSEUDO.github.io/charlemos/`
6. À chaque modification future : `git add -A && git commit -m "maj" && git push`
   → le site se met à jour tout seul.

> ⚠️ Le dépôt public ne doit JAMAIS contenir ta clé API Anthropic. Avec cette
> architecture elle n'est que dans les Secrets Supabase — c'est justement le but.
> Les valeurs de `src/config.ts` (URL + clé anon), elles, peuvent être publiques.

---

## Notes utiles

- **RGPD / bon sens** : seuls des prénoms (ou pseudos) sont collectés, les écrits
  des élèves sont visibles de toi seule. Informe les familles de l'usage de l'outil,
  comme pour tout service numérique ; en cas de doute, vois le DPD de l'académie.
- **Limite de débit** : chaque compte est limité à 60 appels IA par 10 minutes
  (modifiable dans `index.ts`, constante `RATE_LIMIT`).
- **Coûts** : surveille l'usage sur console.anthropic.com ; le modèle se choisit
  dans les réglages de l'appli (Haiku 4.5 = le plus économique pour la classe).
- **Ménage de fin d'année** : Supabase → Table Editor permet de vider les tables ;
  révoque la clé API et régénère un code de classe pour la rentrée suivante.
- **Mode local** : si `src/config.ts` est vide, l'application fonctionne comme
  avant (clé saisie dans les réglages, données sur le poste) — pratique pour tester.
