create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  country text not null default 'Kenya',
  region text,
  keywords text[] not null default array[]::text[],
  companies text[] not null default array[]::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

grant select, insert, update on public.user_preferences to authenticated;
revoke all on public.user_preferences from anon;

create index if not exists user_preferences_country_idx on public.user_preferences (country);
create index if not exists user_preferences_keywords_gin_idx on public.user_preferences using gin (keywords);
create index if not exists user_preferences_companies_gin_idx on public.user_preferences using gin (companies);

drop policy if exists "user_preferences_select_own" on public.user_preferences;
drop policy if exists "user_preferences_insert_own" on public.user_preferences;
drop policy if exists "user_preferences_update_own" on public.user_preferences;

create policy "user_preferences_select_own"
on public.user_preferences
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "user_preferences_insert_own"
on public.user_preferences
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "user_preferences_update_own"
on public.user_preferences
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
