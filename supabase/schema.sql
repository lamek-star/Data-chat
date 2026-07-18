create extension if not exists pgcrypto;
create table if not exists public.app_data (
  id uuid primary key default gen_random_uuid(),
  app_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (app_id, user_id, entity_type, entity_id)
);
alter table public.app_data enable row level security;
create policy "users read own app data" on public.app_data for select using (auth.uid() = user_id);
create policy "users insert own app data" on public.app_data for insert with check (auth.uid() = user_id);
create policy "users update own app data" on public.app_data for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users delete own app data" on public.app_data for delete using (auth.uid() = user_id);
create index if not exists app_data_lookup on public.app_data (user_id, app_id, entity_type);
insert into storage.buckets (id, name, public) values ('private-backups','private-backups',false) on conflict (id) do nothing;
create policy "users manage own backups" on storage.objects for all using (bucket_id='private-backups' and (storage.foldername(name))[1]=auth.uid()::text) with check (bucket_id='private-backups' and (storage.foldername(name))[1]=auth.uid()::text);
