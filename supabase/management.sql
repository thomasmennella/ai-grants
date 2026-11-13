-- =====================================================================
--  Innovations with AI — Grants Portal
--  GRANTS MANAGEMENT add-on. Run this once in the Supabase SQL Editor
--  AFTER setup.sql (paste the whole file, click Run). Safe to re-run.
--  It does not change anything on the review side.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Second lock: an unlock record per coordinator, created only by
-- unlock_mgmt() with the correct management password. Every management
-- table requires BOTH a coordinator login AND an unexpired unlock.
-- ---------------------------------------------------------------------
create table if not exists public.mgmt_unlocks (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  expires_at timestamptz not null
);
alter table public.mgmt_unlocks enable row level security;   -- no policies: functions only

create or replace function public.mgmt_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() and exists (
    select 1 from public.mgmt_unlocks where user_id = auth.uid() and expires_at > now());
$$;

create or replace function public.unlock_mgmt(pw text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then return false; end if;
  if not exists (select 1 from public.secrets where key = 'mgmt' and hash = extensions.crypt(pw, hash)) then
    return false;
  end if;
  insert into public.mgmt_unlocks(user_id, expires_at) values (auth.uid(), now() + interval '12 hours')
  on conflict (user_id) do update set expires_at = excluded.expires_at;
  return true;
end $$;

create or replace function public.lock_mgmt() returns void
language sql security definer set search_path = public as $$
  delete from public.mgmt_unlocks where user_id = auth.uid();
$$;

revoke all on function public.mgmt_ok() from public;
revoke all on function public.unlock_mgmt(text) from public;
revoke all on function public.lock_mgmt() from public;
revoke all on function public.mgmt_ok() from anon;
revoke all on function public.unlock_mgmt(text) from anon;
revoke all on function public.lock_mgmt() from anon;
grant execute on function public.mgmt_ok() to authenticated;
grant execute on function public.unlock_mgmt(text) to authenticated;
grant execute on function public.lock_mgmt() to authenticated;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.mgmt_awards (
  id              uuid primary key default gen_random_uuid(),
  proposal_id     uuid unique references public.proposals(id) on delete set null,
  code            text not null default '',
  title           text not null default '',
  tier            text not null default 'micro' check (tier in ('micro','midi')),
  college         text not null default '',
  department      text not null default '',
  award_total     numeric not null default 0,
  status          text not null default 'active' check (status in ('active','complete','withdrawn')),
  course_info     text not null default '',
  domains         int[] not null default '{1}',
  students_planned int,
  students_reached int,
  repository_url  text not null default '',
  repository_done boolean not null default false,
  ambassador_done boolean not null default false,
  ambassador_note text not null default '',
  waivers         jsonb not null default '{}'::jsonb,
  notes           text not null default '',
  created_at      timestamptz not null default now()
);

create table if not exists public.mgmt_people (
  id         uuid primary key default gen_random_uuid(),
  award_id   uuid not null references public.mgmt_awards(id) on delete cascade,
  name       text not null default '',
  email      text not null default '',
  department text not null default '',
  role       text not null default 'lead' check (role in ('lead','co-lead','member')),
  created_at timestamptz not null default now()
);

create table if not exists public.mgmt_sessions (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null default 'other' check (kind in ('convening','training','lightning','watch','other')),
  title        text not null default '',
  session_date date,
  start_time   text not null default '',
  location     text not null default '',
  counts_cop   boolean not null default false,
  notes        text not null default '',
  sort         int not null default 0,
  created_at   timestamptz not null default now()
);

create table if not exists public.mgmt_attendance (
  session_id uuid not null references public.mgmt_sessions(id) on delete cascade,
  award_id   uuid not null references public.mgmt_awards(id) on delete cascade,
  attended   boolean not null default false,
  presented  boolean not null default false,
  primary key (session_id, award_id)
);

create table if not exists public.mgmt_milestones (
  id        uuid primary key default gen_random_uuid(),
  title     text not null default '',
  due_date  date,
  done      boolean not null default false,
  notes     text not null default '',
  sort      int not null default 0
);

create table if not exists public.mgmt_budget_lines (
  id             uuid primary key default gen_random_uuid(),
  award_id       uuid not null references public.mgmt_awards(id) on delete cascade,
  category       text not null default 'stipend' check (category in ('stipend','software','equipment','materials','speaker','other')),
  description    text not null default '',
  amount         numeric not null default 0,
  person_id      uuid references public.mgmt_people(id) on delete set null,
  stipend_status text not null default 'pending' check (stipend_status in ('pending','approved','sent','paid')),
  status_date    date,
  notes          text not null default '',
  created_at     timestamptz not null default now()
);

create table if not exists public.mgmt_expenses (
  id          uuid primary key default gen_random_uuid(),
  award_id    uuid not null references public.mgmt_awards(id) on delete cascade,
  line_id     uuid references public.mgmt_budget_lines(id) on delete set null,
  spent_on    date,
  vendor      text not null default '',
  description text not null default '',
  amount      numeric not null default 0,
  reference   text not null default '',
  file_path   text,
  file_name   text,
  created_at  timestamptz not null default now()
);

create table if not exists public.mgmt_assessments (
  id         uuid primary key default gen_random_uuid(),
  award_id   uuid not null references public.mgmt_awards(id) on delete cascade,
  domain     int not null default 1 check (domain between 1 and 6),
  instrument text not null default '',
  scale_max  numeric,
  n_pre      int, mean_pre numeric, sd_pre numeric,
  n_post     int, mean_post numeric, sd_post numeric,
  notes      text not null default '',
  file_path  text,
  file_name  text,
  created_at timestamptz not null default now()
);

create table if not exists public.mgmt_surveys (
  id       uuid primary key default gen_random_uuid(),
  name     text not null default '',
  due_date date,
  link     text not null default '',
  sort     int not null default 0
);

create table if not exists public.mgmt_survey_done (
  survey_id    uuid not null references public.mgmt_surveys(id) on delete cascade,
  award_id     uuid not null references public.mgmt_awards(id) on delete cascade,
  completed_on date,
  primary key (survey_id, award_id)
);

create table if not exists public.mgmt_testimonials (
  id          uuid primary key default gen_random_uuid(),
  award_id    uuid references public.mgmt_awards(id) on delete set null,
  quote       text not null default '',
  attribution text not null default '',
  kind        text not null default 'student' check (kind in ('student','faculty','other')),
  featured    boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.mgmt_deliverables (
  id          uuid primary key default gen_random_uuid(),
  award_id    uuid not null references public.mgmt_awards(id) on delete cascade,
  kind        text not null default 'other' check (kind in ('final_report','syllabus','assignment','assessment_data','other')),
  file_path   text,
  file_name   text,
  url         text not null default '',
  received_on date,
  notes       text not null default '',
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Row-level security: coordinator login AND management unlock
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['mgmt_awards','mgmt_people','mgmt_sessions','mgmt_attendance','mgmt_milestones',
    'mgmt_budget_lines','mgmt_expenses','mgmt_assessments','mgmt_surveys','mgmt_survey_done',
    'mgmt_testimonials','mgmt_deliverables']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists mgmt_all on public.%I', t);
    execute format('create policy mgmt_all on public.%I for all to authenticated using (public.mgmt_ok()) with check (public.mgmt_ok())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Private file storage for management documents
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('management', 'management', false)
on conflict (id) do nothing;

drop policy if exists "management files: coordinator" on storage.objects;
create policy "management files: coordinator" on storage.objects for all to authenticated
  using (bucket_id = 'management' and public.mgmt_ok())
  with check (bucket_id = 'management' and public.mgmt_ok());
