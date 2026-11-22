-- Prepify's user list: one row per person who sets up Prepify (their name and email from the welcome screen).
-- Run this once in your Supabase project: Dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- The app only ever ADDS rows, with the public (anon / publishable) key that ships inside Prepify.
-- Row level security below allows exactly that and nothing else, so nobody can use that key to read,
-- change or delete the list. You see the rows in the Supabase dashboard (Table Editor).

create table if not exists public.prepify_users (
  id           bigint generated always as identity primary key,
  name         text not null check (char_length(name) between 1 and 80),
  email        text not null check (char_length(email) <= 254 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'),
  app_version  text check (app_version is null or char_length(app_version) <= 20),
  created_at   timestamptz not null default now()
);

-- one row per email (signing up again from another PC is not a new person)
create unique index if not exists prepify_users_email_key on public.prepify_users (lower(email));

alter table public.prepify_users enable row level security;

drop policy if exists "Prepify app can add users" on public.prepify_users;
create policy "Prepify app can add users"
  on public.prepify_users for insert
  to anon, authenticated
  with check (true);

-- No select, update or delete policies: with row level security on, those are refused for the public key.
-- Belt and braces: the public roles may only insert.
revoke all on public.prepify_users from anon, authenticated;
grant insert on public.prepify_users to anon, authenticated;
