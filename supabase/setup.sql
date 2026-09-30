-- =====================================================================
--  Innovations with AI — Grants Portal
--  Supabase setup script. Paste the whole file into the Supabase
--  SQL Editor and click "Run". Safe to re-run.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

-- One row per person who can sign in to the review platform.
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text not null default '',
  role         text not null default 'reviewer' check (role in ('admin','reviewer')),
  unit         text not null default '',          -- college/school the reviewer represents
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- De-identified proposals. Everything in this table can be seen by reviewers
-- once "released" is true, so nothing identifying belongs here.
create table if not exists public.proposals (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,                 -- e.g. "P-07"
  title       text not null default '',             -- short de-identified title
  tier        text not null default 'micro' check (tier in ('micro','midi')),
  pdf_path    text,
  pdf_name    text,
  released    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Coordinator-only information about each proposal (never visible to reviewers).
create table if not exists public.proposal_admin (
  proposal_id uuid primary key references public.proposals(id) on delete cascade,
  college     text not null default '',
  requested   numeric not null default 0,
  decision    text not null default '',             -- '', fund, partial, fund_micro, decline, hold
  awarded     numeric,
  notes       text not null default ''
);

-- One review per reviewer per proposal.
create table if not exists public.reviews (
  id              uuid primary key default gen_random_uuid(),
  proposal_id     uuid not null references public.proposals(id) on delete cascade,
  reviewer_id     uuid not null references public.profiles(id) on delete cascade,
  scores          jsonb not null default '{}'::jsonb,
  comments        jsonb not null default '{}'::jsonb,
  overall_comment text not null default '',
  status          text not null default 'draft' check (status in ('draft','submitted','recused')),
  coi_note        text not null default '',
  updated_at      timestamptz not null default now(),
  submitted_at    timestamptz,
  unique (proposal_id, reviewer_id)
);

-- Portal-wide settings (threshold, budget, rubric overrides, etc.).
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Hashed passwords that are never readable by anyone through the API.
create table if not exists public.secrets (
  key  text primary key,
  hash text not null
);

-- ---------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role = 'admin' and active);
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;

create or replace function public.reviews_open() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::boolean from public.settings
                   where key = 'reviews_open'), true);
$$;

create or replace function public.is_released(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select released from public.proposals where id = p), false);
$$;

-- Keep timestamps honest.
create or replace function public.touch_review() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status <> 'submitted') then
    new.submitted_at := now();
  elsif new.status <> 'submitted' then
    new.submitted_at := null;
  end if;
  return new;
end $$;

drop trigger if exists reviews_touch on public.reviews;
create trigger reviews_touch before insert or update on public.reviews
  for each row execute function public.touch_review();

-- Management-platform password (separate from review logins).
create or replace function public.check_mgmt_password(pw text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.secrets
                 where key = 'mgmt' and hash = extensions.crypt(pw, hash));
$$;

create or replace function public.set_mgmt_password(pw text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then raise exception 'Only the coordinator can do this'; end if;
  if length(coalesce(pw,'')) < 8 then raise exception 'Password must be at least 8 characters'; end if;
  insert into public.secrets(key, hash) values ('mgmt', extensions.crypt(pw, extensions.gen_salt('bf')))
  on conflict (key) do update set hash = excluded.hash;
end $$;

-- Coordinator resets a reviewer's password.
create or replace function public.admin_set_password(target uuid, pw text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if not public.is_admin() then raise exception 'Only the coordinator can do this'; end if;
  if length(coalesce(pw,'')) < 8 then raise exception 'Password must be at least 8 characters'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(pw, extensions.gen_salt('bf')),
         updated_at = now()
   where id = target;
  if not found then raise exception 'No such user'; end if;
end $$;

revoke all on function public.check_mgmt_password(text) from public;
revoke all on function public.set_mgmt_password(text) from public;
revoke all on function public.admin_set_password(uuid, text) from public;
grant execute on function public.check_mgmt_password(text) to anon, authenticated;
grant execute on function public.set_mgmt_password(text) to authenticated;
grant execute on function public.admin_set_password(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------

alter table public.profiles       enable row level security;
alter table public.proposals      enable row level security;
alter table public.proposal_admin enable row level security;
alter table public.reviews        enable row level security;
alter table public.settings       enable row level security;
alter table public.secrets        enable row level security;   -- no policies: locked

-- profiles: you see yourself; the coordinator sees and manages everyone.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- proposals: reviewers see released ones; the coordinator sees and manages all.
drop policy if exists proposals_select on public.proposals;
create policy proposals_select on public.proposals for select to authenticated
  using (public.is_admin() or (released and public.is_member()));
drop policy if exists proposals_admin_write on public.proposals;
create policy proposals_admin_write on public.proposals for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- proposal_admin: coordinator only.
drop policy if exists proposal_admin_all on public.proposal_admin;
create policy proposal_admin_all on public.proposal_admin for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- reviews: reviewers see and edit only their own, and only until submitted.
drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews for select to authenticated
  using (reviewer_id = auth.uid() or public.is_admin());

drop policy if exists reviews_insert_own on public.reviews;
create policy reviews_insert_own on public.reviews for insert to authenticated
  with check (reviewer_id = auth.uid() and public.is_member()
              and public.reviews_open() and public.is_released(proposal_id));

drop policy if exists reviews_update_own on public.reviews;
create policy reviews_update_own on public.reviews for update to authenticated
  using (reviewer_id = auth.uid() and status in ('draft','recused')
         and public.is_member() and public.reviews_open())
  with check (reviewer_id = auth.uid() and public.is_released(proposal_id));

drop policy if exists reviews_admin_all on public.reviews;
create policy reviews_admin_all on public.reviews for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- settings: any active member reads; coordinator writes.
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select to authenticated
  using (public.is_member());
drop policy if exists settings_admin_write on public.settings;
create policy settings_admin_write on public.settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- PDF storage (private bucket)
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('proposals', 'proposals', false)
on conflict (id) do nothing;

drop policy if exists "proposal pdfs: read" on storage.objects;
create policy "proposal pdfs: read" on storage.objects for select to authenticated
  using (bucket_id = 'proposals' and (
           public.is_admin()
           or (public.is_member() and exists (
                 select 1 from public.proposals p
                 where p.pdf_path = storage.objects.name and p.released))));

drop policy if exists "proposal pdfs: coordinator insert" on storage.objects;
create policy "proposal pdfs: coordinator insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'proposals' and public.is_admin());

drop policy if exists "proposal pdfs: coordinator update" on storage.objects;
create policy "proposal pdfs: coordinator update" on storage.objects for update to authenticated
  using (bucket_id = 'proposals' and public.is_admin());

drop policy if exists "proposal pdfs: coordinator delete" on storage.objects;
create policy "proposal pdfs: coordinator delete" on storage.objects for delete to authenticated
  using (bucket_id = 'proposals' and public.is_admin());

-- ---------------------------------------------------------------------
-- Defaults
-- ---------------------------------------------------------------------

insert into public.settings(key, value) values
  ('reviews_open', 'true'::jsonb),
  ('threshold', '31'::jsonb),
  ('threshold_includes_bonus', 'true'::jsonb),
  ('budget_cap', '35000'::jsonb),
  ('review_deadline', '""'::jsonb),
  ('disagreement_sd', '1'::jsonb)
on conflict (key) do nothing;

-- Initial Grants Management password. CHANGE IT from Settings after first sign-in.
insert into public.secrets(key, hash)
values ('mgmt', extensions.crypt('change-me-mgmt', extensions.gen_salt('bf')))
on conflict (key) do nothing;
