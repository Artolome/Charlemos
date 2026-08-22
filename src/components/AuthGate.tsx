// Porte d'entrée du mode « classe » : connexion / création de compte.
// Si Supabase n'est pas configuré (src/config.ts vide), rend directement
// l'application en mode local, comme avant.
//
// - Élève : prénom + code de classe + mot de passe. Le compte est créé par
//   le serveur (fonction Edge), déjà confirmé — pas d'e-mail nécessaire.
// - Professeur : e-mail + mot de passe, avec confirmation par e-mail.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { GraduationCap, KeyRound, Loader2, School, UserRound } from "lucide-react";
import App from "../App";
import {
  callPublicFunction,
  getSupabase,
  SessionContext,
  slugName,
  studentEmail,
  supabaseEnabled,
  type Profile,
} from "../lib/supabase";
import { setStorageNamespace } from "../lib/storage";
import { initSync, pullAll, stopSync } from "../lib/sync";

type Phase = "loading" | "anon" | "ready";

export function AuthGate() {
  const [phase, setPhase] = useState<Phase>(supabaseEnabled ? "loading" : "ready");
  const [profile, setProfile] = useState<Profile | null>(null);

  const enterSession = useCallback(async (userId: string): Promise<boolean> => {
    const sb = getSupabase();
    if (!sb) return false;
    let { data } = await sb
      .from("profiles")
      .select("id, display_name, role, class_id")
      .eq("id", userId)
      .maybeSingle();

    // Professeur qui vient de confirmer son e-mail : le profil n'a pas pu
    // être créé à l'inscription (pas de session avant confirmation).
    if (!data) {
      const { data: u } = await sb.auth.getUser();
      const meta = (u.user?.user_metadata ?? {}) as { display_name?: string; role?: string };
      if (meta.role === "teacher") {
        const display_name =
          meta.display_name?.trim() || u.user?.email?.split("@")[0] || "Professeur";
        const { error } = await sb
          .from("profiles")
          .insert({ id: userId, display_name, role: "teacher", class_id: null });
        if (!error) data = { id: userId, display_name, role: "teacher", class_id: null };
      }
    }
    if (!data) return false;

    setStorageNamespace(userId);
    try {
      await pullAll(sb, userId);
    } catch {
      // hors connexion : on continue avec les données locales du compte
    }
    initSync(sb, userId);
    setProfile(data as Profile);
    setPhase("ready");
    return true;
  }, []);

  const signOut = useCallback(() => {
    const sb = getSupabase();
    stopSync();
    setStorageNamespace("");
    setProfile(null);
    setPhase(supabaseEnabled ? "anon" : "ready");
    void sb?.auth.signOut();
  }, []);

  useEffect(() => {
    if (!supabaseEnabled) return;
    const sb = getSupabase()!;
    let cancelled = false;
    void sb.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      const uid = data.session?.user.id;
      if (!uid) {
        setPhase("anon");
        return;
      }
      const ok = await enterSession(uid);
      if (!ok && !cancelled) {
        await sb.auth.signOut();
        setPhase("anon");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enterSession]);

  if (phase === "loading") {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3">
        <span className="animate-float text-5xl">🦜</span>
        <Loader2 className="h-5 w-5 animate-spin text-orange-400" />
      </div>
    );
  }

  if (phase === "anon") {
    return <AuthScreens onSignedIn={enterSession} />;
  }

  return (
    <SessionContext.Provider value={{ profile, signOut }}>
      <App key={profile?.id ?? "local"} />
    </SessionContext.Provider>
  );
}

// ---------------------------------------------------------------

function AuthScreens({
  onSignedIn,
}: {
  onSignedIn: (userId: string) => Promise<boolean>;
}) {
  const [tab, setTab] = useState<"student" | "teacher">("student");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [prenom, setPrenom] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const fail = (msg: string) => {
    setError(msg);
    setBusy(false);
  };

  const submit = async () => {
    if (busy) return;
    setError("");
    setInfo("");
    const sb = getSupabase();
    if (!sb) return;
    if (password.length < 6) {
      fail("Le mot de passe doit faire au moins 6 caractères.");
      return;
    }
    setBusy(true);

    try {
      // ----- Élève -----
      if (tab === "student") {
        if (!prenom.trim() || slugName(prenom).length < 2) {
          fail("Écris ton prénom (lettres uniquement).");
          return;
        }
        if (!code.trim()) {
          fail("Il faut le code de classe donné par ton professeur.");
          return;
        }
        if (mode === "signup") {
          const r = await callPublicFunction({
            op: "signup_student",
            prenom: prenom.trim(),
            code: code.trim(),
            password,
          });
          if (!r.ok) {
            fail(r.error ?? "Inscription impossible, réessaie.");
            return;
          }
        }
        const { data, error: err } = await sb.auth.signInWithPassword({
          email: studentEmail(prenom, code),
          password,
        });
        if (err || !data.user) {
          fail(
            mode === "signup"
              ? "Compte créé, mais la connexion a échoué : réessaie avec « Se connecter »."
              : "Connexion refusée : vérifie ton prénom (écrit exactement pareil), le code de classe et ton mot de passe — ou crée ton compte.",
          );
          return;
        }
        const ok = await onSignedIn(data.user.id);
        if (!ok) fail("Compte trouvé mais profil manquant : recrée ton compte.");
        return;
      }

      // ----- Professeur -----
      if (!email.trim()) {
        fail("Indique ton adresse e-mail.");
        return;
      }
      if (mode === "signup") {
        const { data, error: err } = await sb.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { display_name: email.trim().split("@")[0], role: "teacher" },
          },
        });
        if (err) {
          fail(
            /already|registered/i.test(err.message)
              ? "Un compte existe déjà avec cette adresse : connecte-toi."
              : `Création impossible : ${err.message}`,
          );
          return;
        }
        if (!data.session || !data.user) {
          // Confirmation par e-mail activée (recommandé) : le profil sera
          // créé automatiquement à la première connexion.
          setBusy(false);
          setMode("login");
          setInfo(
            `📧 Un e-mail de confirmation vient d'être envoyé à ${email.trim()} (regarde aussi les spams). Clique sur le lien qu'il contient, puis reviens ici pour te connecter.`,
          );
          return;
        }
        await onSignedIn(data.user.id);
        return;
      }
      const { data, error: err } = await sb.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (err || !data.user) {
        fail(
          /not confirmed/i.test(err?.message ?? "")
            ? "📧 Confirme d'abord ton adresse : clique sur le lien reçu par e-mail, puis réessaie."
            : "Connexion refusée : e-mail ou mot de passe incorrect.",
        );
        return;
      }
      const ok = await onSignedIn(data.user.id);
      if (!ok) fail("Profil introuvable pour ce compte.");
    } catch {
      fail("Le serveur ne répond pas. Vérifie la connexion Internet.");
    }
  };

  const input =
    "w-full rounded-xl border border-orange-200 bg-white px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 dark:border-slate-700 dark:bg-slate-900";

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl ring-1 ring-orange-100 dark:bg-slate-900 dark:ring-slate-800"
      >
        <div className="text-center">
          <span className="text-5xl">🦜</span>
          <h1 className="mt-1 font-display text-3xl font-extrabold text-transparent bg-gradient-to-r from-orange-500 via-rose-500 to-violet-600 bg-clip-text">
            ¡Charlemos!
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Connecte-toi pour retrouver tes conversations, tes XP et ton carnet.
          </p>
        </div>

        <div className="mt-5 flex gap-1 rounded-xl bg-orange-100/70 p-1 dark:bg-slate-800">
          <TabBtn
            active={tab === "student"}
            onClick={() => {
              setTab("student");
              setError("");
              setInfo("");
            }}
            icon={<UserRound className="h-4 w-4" />}
            label="Élève"
          />
          <TabBtn
            active={tab === "teacher"}
            onClick={() => {
              setTab("teacher");
              setError("");
              setInfo("");
            }}
            icon={<GraduationCap className="h-4 w-4" />}
            label="Professeur"
          />
        </div>

        <div className="mt-4 space-y-2.5">
          {tab === "student" ? (
            <>
              <input
                className={input}
                placeholder="Ton prénom (ex. Léa)"
                value={prenom}
                onChange={(e) => setPrenom(e.target.value)}
                maxLength={30}
              />
              <div className="relative">
                <School className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  className={`${input} pl-9 uppercase tracking-widest`}
                  placeholder="CODE CLASSE"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  maxLength={8}
                />
              </div>
            </>
          ) : (
            <input
              className={input}
              type="email"
              placeholder="Adresse e-mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className={`${input} pl-9`}
              type="password"
              placeholder="Mot de passe"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
            />
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900">
            {error}
          </p>
        )}
        {info && (
          <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold leading-relaxed text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900">
            {info}
          </p>
        )}

        <button
          onClick={() => void submit()}
          disabled={busy}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 py-2.5 font-display text-sm font-extrabold text-white shadow hover:bg-orange-600 disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {mode === "login" ? "Se connecter" : "Créer mon compte"}
        </button>

        <button
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError("");
            setInfo("");
          }}
          className="mt-2.5 w-full text-center text-xs font-bold text-slate-500 underline underline-offset-2 hover:text-slate-700 dark:text-slate-400"
        >
          {mode === "login"
            ? tab === "student"
              ? "Première fois ? Crée ton compte avec le code de ta classe"
              : "Première fois ? Créer un compte professeur"
            : "J'ai déjà un compte : me connecter"}
        </button>

        {tab === "student" ? (
          <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
            Ton professeur te donne le code de classe. N'utilise que ton prénom —
            jamais ton nom complet.
          </p>
        ) : (
          <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
            Les comptes professeur sont confirmés par e-mail.
          </p>
        )}
      </motion.div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold transition-colors ${
        active
          ? "bg-white text-slate-800 shadow-sm dark:bg-slate-900 dark:text-white"
          : "text-slate-500 hover:text-slate-700 dark:text-slate-400"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
