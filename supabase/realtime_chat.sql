create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'DataChat member',
  contact_code text not null unique,
  country text not null default 'Global',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "authenticated users discover profiles" on public.profiles;
create policy "authenticated users discover profiles"
  on public.profiles for select to authenticated using (true);

drop policy if exists "users create own profile" on public.profiles;
create policy "users create own profile"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint different_message_participants check (sender_id <> recipient_id)
);

alter table public.direct_messages enable row level security;

drop policy if exists "participants read direct messages" on public.direct_messages;
create policy "participants read direct messages"
  on public.direct_messages for select to authenticated
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

drop policy if exists "users send direct messages" on public.direct_messages;
create policy "users send direct messages"
  on public.direct_messages for insert to authenticated
  with check (auth.uid() = sender_id);

drop policy if exists "recipients mark messages read" on public.direct_messages;
create policy "recipients mark messages read"
  on public.direct_messages for update to authenticated
  using (auth.uid() = recipient_id) with check (auth.uid() = recipient_id);

create index if not exists direct_messages_sender_time
  on public.direct_messages (sender_id, created_at desc);
create index if not exists direct_messages_recipient_time
  on public.direct_messages (recipient_id, created_at desc);

create or replace function public.create_datachat_profile()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, contact_code, country)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), 'DataChat member'),
    upper(substr(replace(new.id::text, '-', ''), 1, 12)),
    coalesce(new.raw_user_meta_data ->> 'country', 'Global')
  )
  on conflict (id) do update set
    display_name = excluded.display_name,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists create_datachat_profile_after_signup on auth.users;
create trigger create_datachat_profile_after_signup
  after insert or update of raw_user_meta_data on auth.users
  for each row execute function public.create_datachat_profile();

insert into public.profiles (id, display_name, contact_code, country)
select
  id,
  coalesce(raw_user_meta_data ->> 'name', split_part(email, '@', 1), 'DataChat member'),
  upper(substr(replace(id::text, '-', ''), 1, 12)),
  coalesce(raw_user_meta_data ->> 'country', 'Global')
from auth.users
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'direct_messages'
  ) then
    alter publication supabase_realtime add table public.direct_messages;
  end if;
end $$;
