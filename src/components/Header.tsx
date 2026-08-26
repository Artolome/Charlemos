import type { ReactNode } from "react";
import {
  ArrowLeft,
  BarChart3,
  ClipboardList,
  Flame,
  LogOut,
  Moon,
  Settings,
  Sparkles,
  Sun,
  Users,
} from "lucide-react";
import { useApp, type Route } from "../lib/context";
import { levelInfo } from "../lib/gamification";
import { agentById } from "../lib/agents";
import { useSession } from "../lib/supabase";

export function Header({ route }: { route: Route }) {
  const { settings, updateSettings, progress, openSettings, navigate } = useApp();
  const { profile, signOut } = useSession();
  const lvl = levelInfo(progress.xp);
  const inChat = route.name === "chat";
  const agent = inChat ? agentById(route.agentId) : null;

  return (
    <header className="sticky top-0 z-30 border-b border-orange-100 bg-white/80 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/80">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-2 sm:gap-2 sm:px-4">
        {inChat ? (
          <button
            onClick={() => navigate({ name: "hub" })}
            className="flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-sm font-bold text-slate-600 hover:bg-orange-100 dark:text-slate-300 dark:hover:bg-slate-800"
            title="Retour aux personnages"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Personajes</span>
          </button>
        ) : (
          <button
            onClick={() => navigate({ name: "hub" })}
            className="flex items-center gap-2"
            title="Accueil"
          >
            <span className="text-2xl">🦜</span>
            <span className="hidden font-display text-lg font-extrabold tracking-tight text-transparent bg-gradient-to-r from-orange-500 via-rose-500 to-violet-600 bg-clip-text sm:inline">
              ¡Charlemos!
            </span>
          </button>
        )}

        {agent && (
          <div className="flex min-w-0 items-center gap-2 pl-1">
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-lg ${agent.color.grad}`}
            >
              {agent.emoji}
            </span>
            <div className="min-w-0 leading-tight">
              <div className="truncate font-display text-sm font-bold">{agent.nombre}</div>
              <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                {agent.flag} {agent.ciudad}
              </div>
            </div>
          </div>
        )}

        <div className="flex-1" />

        {!inChat && (
          <nav className="mr-1 flex items-center gap-1">
            <NavButton
              active={route.name === "hub"}
              onClick={() => navigate({ name: "hub" })}
              icon={<Users className="h-4 w-4" />}
              label="Personajes"
            />
            <NavButton
              active={route.name === "progress"}
              onClick={() => navigate({ name: "progress" })}
              icon={<BarChart3 className="h-4 w-4" />}
              label="Mes progrès"
            />
            {profile?.role === "teacher" && (
              <NavButton
                active={route.name === "teacher"}
                onClick={() => navigate({ name: "teacher" })}
                icon={<ClipboardList className="h-4 w-4" />}
                label="Ma classe"
              />
            )}
          </nav>
        )}

        {progress.streakCount > 0 && (
          <span
            className="flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-xs font-extrabold text-orange-600 dark:bg-orange-950/60 dark:text-orange-300"
            title={`${progress.streakCount} jour(s) d'affilée !`}
          >
            <Flame className="h-3.5 w-3.5" />
            {progress.streakCount}
          </span>
        )}

        <button
          onClick={() => navigate({ name: "progress" })}
          className="flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-extrabold text-violet-700 hover:bg-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:hover:bg-violet-900/60"
          title={`${progress.xp} XP — niveau ${lvl.level}`}
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span className="hidden xs:inline sm:inline">{progress.xp} XP</span>
          <span>· N{lvl.level}</span>
        </button>

        <button
          onClick={() =>
            updateSettings({ theme: settings.theme === "dark" ? "light" : "dark" })
          }
          className="hidden rounded-xl p-2 text-slate-500 hover:bg-orange-100 sm:block dark:text-slate-400 dark:hover:bg-slate-800"
          title={settings.theme === "dark" ? "Mode clair" : "Mode sombre"}
        >
          {settings.theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <button
          onClick={openSettings}
          className="rounded-xl p-2 text-slate-500 hover:bg-orange-100 dark:text-slate-400 dark:hover:bg-slate-800"
          title="Réglages"
        >
          <Settings className="h-4 w-4" />
        </button>

        {profile && (
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 rounded-xl px-2 py-2 text-slate-500 hover:bg-orange-100 dark:text-slate-400 dark:hover:bg-slate-800"
            title={`Se déconnecter (${profile.display_name})`}
          >
            <span className="hidden max-w-24 truncate text-xs font-bold md:inline">
              {profile.display_name}
            </span>
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </div>
    </header>
  );
}

function NavButton({
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
      title={label}
      className={`flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-sm font-bold transition-colors md:px-3 ${
        active
          ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
          : "text-slate-600 hover:bg-orange-100 dark:text-slate-300 dark:hover:bg-slate-800"
      }`}
    >
      {icon}
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}
