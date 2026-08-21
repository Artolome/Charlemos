-- ============================================================
-- ¡Charlemos! — schéma de la base Supabase
-- À coller intégralement dans : Supabase → SQL Editor → Run
-- ============================================================

-- Classes (une par professeur pour commencer)
create table public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text not null unique,
  teacher_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Profils (élèves et professeurs)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'student' check (role in ('student', 'teacher')),
  class_id uuid references public.classes(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Progression (une ligne par élève : XP, badges, carnet, notes)
create table public.progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  xp int not null default 0,
  streak int not null default 0,
  badges jsonb not null default '[]',
  msg_count int not null default 0,
  per_agent jsonb not null default '{}',
  missions_completed int not null default 0,
  best_mission int not null default 0,
  vocab jsonb not null default '[]',
  notes text not null default '',
  updated_at timestamptz not null default now()
);

-- Conversations (une ligne par élève et par personnage)
create table public.conversations (
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null,
  level text not null default 'auto',
  messages jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  primary key (user_id, agent_id)
);

-- Historique des rapports de mission (Capitán Misión)
create table public.mission_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  total int,
  comprension int,
  expresion int,
  lexico int,
  insignia text,
  consejo text,
  created_at timestamptz not null default now()
);

-- Journal d'appels IA (limitation de débit, accès service role uniquement)
create table public.usage_log (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  created_at timestamptz not null default now()
);
create index usage_log_user_time on public.usage_log (user_id, created_at);

-- ------------------------------------------------------------
-- Sécurité : Row Level Security
-- ------------------------------------------------------------
alter table public.classes enable row level security;
alter table public.profiles enable row level security;
alter table public.progress enable row level security;
alter table public.conversations enable row level security;
alter table public.mission_reports enable row level security;
alter table public.usage_log enable row level security; -- aucune policy : service role uniquement

-- Le professeur gère ses propres classes
create policy "prof gere ses classes" on public.classes
  for all using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

-- Recherche d'une classe par code (inscription élève), sans exposer la table
create or replace function public.class_by_code(code text)
returns table (id uuid, name text)
language sql
security definer
set search_path = public
as $$
  select id, name from public.classes where upper(join_code) = upper(trim(code));
$$;
grant execute on function public.class_by_code(text) to anon, authenticated;

-- L'utilisateur courant est-il le professeur de cet élève ?
-- (security definer : évite la récursion des policies sur profiles)
create or replace function public.is_my_student(student uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.classes c on c.id = p.class_id
    where p.id = student and c.teacher_id = auth.uid()
  );
$$;

-- Profils
create policy "voir son profil" on public.profiles
  for select using (id = auth.uid());
create policy "creer son profil" on public.profiles
  for insert with check (id = auth.uid());
create policy "modifier son profil" on public.profiles
  for update using (id = auth.uid());
create policy "prof voit ses eleves" on public.profiles
  for select using (public.is_my_student(id));

-- Progression
create policy "eleve gere sa progression" on public.progress
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "prof lit la progression" on public.progress
  for select using (public.is_my_student(user_id));

-- Conversations
create policy "eleve gere ses conversations" on public.conversations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "prof lit les conversations" on public.conversations
  for select using (public.is_my_student(user_id));

-- Rapports de mission
create policy "eleve gere ses rapports" on public.mission_reports
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "prof lit les rapports" on public.mission_reports
  for select using (public.is_my_student(user_id));
