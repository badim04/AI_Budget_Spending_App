-- Finlo — Supabase schema, auth, sync and receipt storage.
--
-- Paste this whole file into the Supabase SQL editor and run it once. It is
-- written to be re-runnable: every object is created "if not exists" or dropped
-- and recreated, so running it again after an edit does not error.
--
-- The security model is Row-Level Security, not application code. Every table is
-- readable and writable ONLY by the user who owns the row (user_id = auth.uid()).
-- That is why the anon key is safe to ship in the app: it can do nothing on its
-- own — a request only ever sees the signed-in user's own rows. Do NOT ship the
-- service_role key anywhere near the app; it bypasses RLS.

-- ---------------------------------------------------------------- extensions
create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ------------------------------------------------------------------ profiles
-- One row per user. Holds nothing sensitive today; exists so recovery and
-- account-level flags have somewhere to live, and so a user is a real object in
-- the schema rather than only an auth.users id.
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles are private to their owner" on public.profiles;
create policy "profiles are private to their owner"
  on public.profiles for all
  using (id = auth.uid())
  with check (id = auth.uid());

-- Create the profile automatically the first time a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------- sync_items
-- One generic table for every synced entity, keyed by (user, entity, id).
--
-- Why generic instead of one table per entity: the local model in src/core
-- evolves, and a JSONB payload keeps THIS schema stable while still allowing
-- per-row conflict detection. `version` increments on each local edit; `deleted`
-- is a soft delete so a delete on one device propagates instead of being
-- silently resurrected by a stale row from another.
create table if not exists public.sync_items (
  user_id            uuid        not null references auth.users (id) on delete cascade,
  entity             text        not null,   -- 'transaction' | 'account' | 'category' | 'budget' | 'goal'
  entity_id          text        not null,   -- the local id
  updated_at         timestamptz not null,   -- the LOCAL clock, for conflict detection
  deleted            boolean     not null default false,
  version            bigint      not null default 1,
  payload            jsonb       not null,
  server_updated_at  timestamptz not null default now(),  -- for "pull everything since"
  primary key (user_id, entity, entity_id)
);

-- Pull query: "give me everything that changed on the server since I last looked".
create index if not exists sync_items_pull_idx
  on public.sync_items (user_id, server_updated_at);

alter table public.sync_items enable row level security;

drop policy if exists "sync rows are private to their owner" on public.sync_items;
create policy "sync rows are private to their owner"
  on public.sync_items for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Keep server_updated_at honest: stamp it on every write, server-side, so a
-- device with a wrong clock cannot poison the "changed since" cursor.
create or replace function public.touch_server_updated_at()
returns trigger language plpgsql as $$
begin
  new.server_updated_at := now();
  return new;
end;
$$;

drop trigger if exists sync_items_touch on public.sync_items;
create trigger sync_items_touch
  before insert or update on public.sync_items
  for each row execute function public.touch_server_updated_at();

-- ---------------------------------------------------------- receipt storage
-- A PRIVATE bucket. Files live under a folder named for the user's id, and the
-- policy below is what makes that folder private: a user can only touch objects
-- whose first path segment is their own auth.uid().
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

drop policy if exists "receipts are private to their owner" on storage.objects;
create policy "receipts are private to their owner"
  on storage.objects for all
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ------------------------------------------------------- delete my account
-- The user-facing half of "delete my account": removes everything RLS lets the
-- caller own — their sync rows, their profile, their receipt files. It runs as
-- SECURITY DEFINER so it can reach storage.objects, but it only ever deletes
-- rows belonging to auth.uid(), so it cannot be turned against another user.
--
-- Removing the auth.users row itself needs the service role and is done from a
-- small Edge Function (see docs/ACCOUNTS_AND_BACKEND.md step 5) — never from the
-- app, which must never hold the service key.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  delete from public.sync_items where user_id = uid;
  delete from storage.objects
    where bucket_id = 'receipts'
      and (storage.foldername(name))[1] = uid::text;
  delete from public.profiles where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
