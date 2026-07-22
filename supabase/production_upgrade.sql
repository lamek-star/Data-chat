-- Run once in Supabase SQL Editor after realtime_chat.sql.
alter table public.profiles add column if not exists phone text not null default '';
alter table public.profiles add column if not exists avatar_url text;

insert into storage.buckets (id, name, public)
values ('profile-images', 'profile-images', true)
on conflict (id) do update set public = true;

drop policy if exists "public profile images are readable" on storage.objects;
create policy "public profile images are readable" on storage.objects
  for select using (bucket_id = 'profile-images');
drop policy if exists "users upload own profile images" on storage.objects;
create policy "users upload own profile images" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists "users update own profile images" on storage.objects;
create policy "users update own profile images" on storage.objects
  for update to authenticated using (
    bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'profile-images' and (storage.foldername(name))[1] = auth.uid()::text
  );

create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text not null,
  purpose text not null,
  parent_id uuid references public.communities(id) on delete set null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  is_admin_root boolean not null default false,
  allow_subgroups boolean not null default false,
  allow_invites boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.community_memberships (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  role text not null default 'member' check (role in ('owner','moderator','member')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  primary key (community_id, user_id)
);
alter table public.communities enable row level security;
alter table public.community_memberships enable row level security;
drop policy if exists "members discover communities" on public.communities;
create policy "members discover communities" on public.communities for select to authenticated using (true);
drop policy if exists "users create child communities" on public.communities;
create policy "users create child communities" on public.communities for insert to authenticated with check (
  auth.uid() = owner_id and is_admin_root = false and parent_id is not null
);
drop policy if exists "users request membership" on public.community_memberships;
create policy "users request membership" on public.community_memberships for insert to authenticated with check (
  auth.uid() = user_id and role = 'member' and status = 'pending'
);
drop policy if exists "participants view memberships" on public.community_memberships;
create policy "participants view memberships" on public.community_memberships for select to authenticated using (
  auth.uid() = user_id or exists (select 1 from public.communities c where c.id = community_id and c.owner_id = auth.uid())
);
drop policy if exists "owners approve memberships" on public.community_memberships;
create policy "owners approve memberships" on public.community_memberships for update to authenticated using (
  exists (select 1 from public.communities c where c.id = community_id and c.owner_id = auth.uid())
) with check (
  exists (select 1 from public.communities c where c.id = community_id and c.owner_id = auth.uid())
);

