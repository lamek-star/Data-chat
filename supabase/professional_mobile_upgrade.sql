-- DataChat professional mobile/data-integrity upgrade.
-- Apply after final_reliability_upgrade.sql.

create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists visible_in_community boolean not null default false;

create table if not exists public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> recipient_id),
  unique (requester_id, recipient_id)
);

create table if not exists public.user_contacts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  contact_user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'request'
    check (source in ('request', 'qr', 'admin')),
  created_at timestamptz not null default now(),
  primary key (owner_id, contact_user_id),
  check (owner_id <> contact_user_id)
);

create table if not exists public.customer_ratings (
  owner_id uuid not null references auth.users(id) on delete cascade,
  rated_user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, rated_user_id),
  check (owner_id <> rated_user_id)
);

create table if not exists public.voice_messages (
  id uuid primary key,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  object_path text not null unique,
  mime_type text not null,
  byte_size integer not null check (byte_size > 0 and byte_size <= 1500000),
  duration_ms integer,
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);

alter table public.contact_requests enable row level security;
alter table public.user_contacts enable row level security;
alter table public.customer_ratings enable row level security;
alter table public.voice_messages enable row level security;

drop policy if exists "community-safe profile discovery" on public.profiles;
drop policy if exists "authenticated users discover profiles" on public.profiles;
create policy "community-safe profile discovery"
  on public.profiles for select to authenticated
  using (
    auth.uid() = id
    or visible_in_community = true
    or exists (
      select 1 from public.user_contacts c
      where c.owner_id = auth.uid() and c.contact_user_id = profiles.id
    )
    or exists (
      select 1 from public.contact_requests r
      where (r.requester_id = auth.uid() and r.recipient_id = profiles.id)
         or (r.recipient_id = auth.uid() and r.requester_id = profiles.id)
    )
  );

drop policy if exists "participants view contact requests" on public.contact_requests;
create policy "participants view contact requests"
  on public.contact_requests for select to authenticated
  using (auth.uid() = requester_id or auth.uid() = recipient_id);

drop policy if exists "users create contact requests" on public.contact_requests;
create policy "users create contact requests"
  on public.contact_requests for insert to authenticated
  with check (
    auth.uid() = requester_id
    and status = 'pending'
    and exists (
      select 1 from public.profiles p
      where p.id = recipient_id and p.visible_in_community = true
    )
    and not exists (
      select 1 from public.user_contacts c
      where c.owner_id = auth.uid() and c.contact_user_id = recipient_id
    )
  );

drop policy if exists "requesters cancel requests" on public.contact_requests;
create policy "requesters cancel requests"
  on public.contact_requests for update to authenticated
  using (auth.uid() = requester_id and status = 'pending')
  with check (auth.uid() = requester_id and status = 'cancelled');

drop policy if exists "users view own contacts" on public.user_contacts;
create policy "users view own contacts"
  on public.user_contacts for select to authenticated
  using (auth.uid() = owner_id);

drop policy if exists "users delete own contacts" on public.user_contacts;
create policy "users delete own contacts"
  on public.user_contacts for delete to authenticated
  using (auth.uid() = owner_id);

drop policy if exists "users manage own ratings" on public.customer_ratings;
create policy "users manage own ratings"
  on public.customer_ratings for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "voice participants view metadata" on public.voice_messages;
create policy "voice participants view metadata"
  on public.voice_messages for select to authenticated
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

drop policy if exists "voice senders create metadata" on public.voice_messages;
create policy "voice senders create metadata"
  on public.voice_messages for insert to authenticated
  with check (auth.uid() = sender_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voice-messages',
  'voice-messages',
  false,
  1500000,
  array['audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/mpeg']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "voice senders upload own audio" on storage.objects;
create policy "voice senders upload own audio"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'voice-messages'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "voice participants read audio" on storage.objects;
create policy "voice participants read audio"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'voice-messages'
    and exists (
      select 1 from public.voice_messages v
      where v.object_path = name
        and (v.sender_id = auth.uid() or v.recipient_id = auth.uid())
    )
  );

create or replace function public.resolve_datachat_contact(
  requested_user_id uuid default null,
  requested_contact_code text default null
)
returns table (
  id uuid,
  display_name text,
  username text,
  contact_code text,
  country text,
  avatar_url text,
  plan text,
  status text
)
language sql
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.username, p.contact_code, p.country,
         p.avatar_url, p.plan, p.status
  from public.profiles p
  where auth.uid() is not null
    and (
      (
        requested_user_id is not null
        and requested_contact_code is not null
        and p.id = requested_user_id
        and p.contact_code = upper(trim(requested_contact_code))
      )
      or
      (
        requested_user_id is null
        and
        requested_contact_code is not null
        and p.contact_code = upper(trim(requested_contact_code))
        and p.visible_in_community = true
      )
    )
    and p.id <> auth.uid()
  limit 1;
$$;

create or replace function public.datachat_admin_snapshot(
  requested_username text,
  requested_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  saved public.datachat_admin_control;
begin
  select * into saved from public.datachat_admin_control where singleton = true;
  if saved.username <> lower(btrim(requested_username))
     or saved.password_hash <> crypt(requested_password, saved.password_hash) then
    raise exception 'Administrator credentials are incorrect';
  end if;

  return jsonb_build_object(
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.display_name,
        'username', p.username,
        'email', u.email,
        'phone', p.phone,
        'country', p.country,
        'plan', p.plan,
        'status', p.status,
        'emailVerified', p.email_verified,
        'visibleInCommunity', p.visible_in_community,
        'createdAt', u.created_at,
        'lastSignInAt', u.last_sign_in_at
      ) order by u.created_at desc)
      from public.profiles p join auth.users u on u.id = p.id
    ), '[]'::jsonb),
    'communities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'location', c.location,
        'purpose', c.purpose,
        'parentId', c.parent_id,
        'createdBy', c.owner_id,
        'ownerName', p.display_name,
        'isAdminRoot', c.is_admin_root,
        'allowSubgroups', c.allow_subgroups,
        'allowInvites', c.allow_invites,
        'createdAt', c.created_at
      ) order by c.created_at desc)
      from public.communities c
      left join public.profiles p on p.id = c.owner_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.add_datachat_contact_by_qr(
  requested_user_id uuid,
  requested_contact_code text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = requested_user_id
      and p.contact_code = upper(trim(requested_contact_code))
      and p.id <> auth.uid()
  ) then
    raise exception 'Invalid contact QR';
  end if;

  insert into public.user_contacts(owner_id, contact_user_id, source)
  values (auth.uid(), requested_user_id, 'qr')
  on conflict (owner_id, contact_user_id) do nothing;
  return true;
end;
$$;

create or replace function public.respond_datachat_contact_request(
  requested_request_id uuid,
  requested_accept boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  item public.contact_requests%rowtype;
begin
  select * into item from public.contact_requests
  where id = requested_request_id and recipient_id = auth.uid()
  for update;
  if item.id is null then raise exception 'Request not found'; end if;
  if item.status <> 'pending' then return item.status = 'accepted'; end if;

  update public.contact_requests
  set status = case when requested_accept then 'accepted' else 'rejected' end,
      responded_at = now()
  where id = item.id;

  if requested_accept then
    insert into public.user_contacts(owner_id, contact_user_id, source)
    values
      (item.requester_id, item.recipient_id, 'request'),
      (item.recipient_id, item.requester_id, 'request')
    on conflict (owner_id, contact_user_id) do nothing;
  end if;
  return requested_accept;
end;
$$;

create or replace function public.request_datachat_contact(
  requested_recipient_id uuid
)
returns public.contact_requests
language plpgsql
security definer
set search_path = public
as $$
declare item public.contact_requests;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if requested_recipient_id = auth.uid() then
    raise exception 'You cannot add your own account';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = requested_recipient_id
      and p.visible_in_community = true
      and p.status = 'active'
  ) then raise exception 'This member is not available in Community'; end if;
  if exists (
    select 1 from public.user_contacts c
    where c.owner_id = auth.uid()
      and c.contact_user_id = requested_recipient_id
  ) then raise exception 'This member is already a contact'; end if;

  insert into public.contact_requests(
    requester_id, recipient_id, status, created_at, responded_at
  )
  values (
    auth.uid(), requested_recipient_id, 'pending', now(), null
  )
  on conflict (requester_id, recipient_id) do update
  set status = 'pending', created_at = now(), responded_at = null
  returning * into item;
  return item;
end;
$$;

create or replace function public.datachat_admin_operational_snapshot(
  requested_username text,
  requested_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if not exists (
    select 1 from public.datachat_admin_control a
    where a.username = lower(trim(requested_username))
      and a.password_hash = crypt(requested_password, a.password_hash)
  ) then raise exception 'Invalid administrator credentials'; end if;

  return jsonb_build_object(
    'contactRequests', (select count(*) from public.contact_requests),
    'contacts', (select count(*) from public.user_contacts),
    'ratings', (select count(*) from public.customer_ratings),
    'transactions', (
      select count(*) from public.app_data
      where app_id = 'datachat' and entity_type = 'transaction'
    ),
    'messages', (select count(*) from public.direct_messages),
    'voiceMessages', (select count(*) from public.voice_messages),
    'backups', (
      select count(*) from storage.objects where bucket_id = 'private-backups'
    ),
    'profileImages', (
      select count(*) from storage.objects where bucket_id = 'profile-images'
    )
  );
end;
$$;

create index if not exists contact_requests_recipient_status
  on public.contact_requests(recipient_id, status, created_at desc);
create index if not exists user_contacts_contact_lookup
  on public.user_contacts(contact_user_id, owner_id);
create index if not exists voice_messages_participants_time
  on public.voice_messages(sender_id, recipient_id, created_at desc);

do $$
begin
  alter publication supabase_realtime add table public.contact_requests;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.user_contacts;
exception when duplicate_object then null;
end $$;

revoke all on function public.resolve_datachat_contact(uuid, text) from public;
revoke all on function public.add_datachat_contact_by_qr(uuid, text) from public;
revoke all on function public.respond_datachat_contact_request(uuid, boolean) from public;
revoke all on function public.request_datachat_contact(uuid) from public;
revoke all on function public.datachat_admin_operational_snapshot(text, text) from public;
revoke all on function public.datachat_admin_snapshot(text, text) from public;
grant execute on function public.resolve_datachat_contact(uuid, text) to authenticated;
grant execute on function public.add_datachat_contact_by_qr(uuid, text) to authenticated;
grant execute on function public.respond_datachat_contact_request(uuid, boolean) to authenticated;
grant execute on function public.request_datachat_contact(uuid) to authenticated;
grant execute on function public.datachat_admin_operational_snapshot(text, text) to anon, authenticated;
grant execute on function public.datachat_admin_snapshot(text, text) to anon, authenticated;
