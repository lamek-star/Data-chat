-- DataChat final reliability upgrade.
-- Adds authoritative subscription state, optional app-level email verification,
-- and password-protected administrator customer/community visibility.

alter table public.profiles
  add column if not exists plan text not null default 'Free',
  add column if not exists status text not null default 'active',
  add column if not exists email_verified boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

alter table public.communities alter column owner_id drop not null;

update public.profiles p
set plan = coalesce(nullif(d.payload ->> 'plan', ''), p.plan),
    status = coalesce(nullif(d.payload ->> 'status', ''), p.status),
    updated_at = now()
from public.app_data d
where d.user_id = p.id
  and d.app_id = 'datachat'
  and d.entity_type = 'profile'
  and d.entity_id = p.id::text;

create or replace function public.mark_datachat_email_verified()
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  update public.profiles
  set email_verified = true, updated_at = now()
  where id = auth.uid();
  return true;
end;
$$;

create or replace function public.redeem_datachat_pro_code(requested_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  redeemed public.pro_access_codes;
  member_name text;
  member_email text;
  verified boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in before redeeming a code';
  end if;

  select p.display_name, u.email, p.email_verified
  into member_name, member_email, verified
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = auth.uid();

  if coalesce(verified, false) is not true then
    raise exception 'Verify your email in Settings before activating Pro';
  end if;

  update public.pro_access_codes
  set status = 'used',
      used_by = auth.uid(),
      used_by_name = coalesce(member_name, 'DataChat member'),
      used_by_email = member_email,
      used_at = now()
  where code = upper(btrim(requested_code))
    and status = 'available'
  returning * into redeemed;

  if redeemed.id is null then
    raise exception 'Code not found, expired, or already used';
  end if;

  update public.profiles
  set plan = 'Pro', updated_at = now()
  where id = auth.uid();

  return jsonb_build_object(
    'id', redeemed.id,
    'code', redeemed.code,
    'plan', redeemed.plan,
    'status', redeemed.status
  );
end;
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

create or replace function public.datachat_admin_update_user(
  requested_username text,
  requested_password text,
  requested_user_id uuid,
  requested_plan text,
  requested_status text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare saved public.datachat_admin_control;
begin
  select * into saved from public.datachat_admin_control where singleton = true;
  if saved.username <> lower(btrim(requested_username))
     or saved.password_hash <> crypt(requested_password, saved.password_hash) then
    raise exception 'Administrator credentials are incorrect';
  end if;
  if requested_plan not in ('Free', 'Pro') then raise exception 'Invalid plan'; end if;
  if requested_status not in ('active', 'pending', 'suspended') then raise exception 'Invalid status'; end if;
  update public.profiles set plan=requested_plan, status=requested_status, updated_at=now()
  where id=requested_user_id;
  return found;
end;
$$;

create or replace function public.datachat_admin_delete_user(
  requested_username text,
  requested_password text,
  requested_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare saved public.datachat_admin_control;
begin
  select * into saved from public.datachat_admin_control where singleton = true;
  if saved.username <> lower(btrim(requested_username))
     or saved.password_hash <> crypt(requested_password, saved.password_hash) then
    raise exception 'Administrator credentials are incorrect';
  end if;
  delete from auth.users where id=requested_user_id;
  return found;
end;
$$;

create or replace function public.datachat_admin_create_root_community(
  requested_username text,
  requested_password text,
  requested_name text,
  requested_location text,
  requested_purpose text,
  requested_parent_id uuid,
  requested_allow_subgroups boolean,
  requested_allow_invites boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  saved public.datachat_admin_control;
  created_id uuid;
begin
  select * into saved from public.datachat_admin_control where singleton = true;
  if saved.username <> lower(btrim(requested_username))
     or saved.password_hash <> crypt(requested_password, saved.password_hash) then
    raise exception 'Administrator credentials are incorrect';
  end if;
  insert into public.communities (
    name, location, purpose, parent_id, owner_id, is_admin_root,
    allow_subgroups, allow_invites
  ) values (
    requested_name, requested_location, requested_purpose, requested_parent_id,
    null, true, requested_allow_subgroups, requested_allow_invites
  ) returning id into created_id;
  return created_id;
end;
$$;

drop policy if exists "pro users create child communities" on public.communities;
drop policy if exists "users create child communities" on public.communities;
create policy "pro users create child communities"
  on public.communities for insert to authenticated
  with check (
    auth.uid() = owner_id
    and is_admin_root = false
    and parent_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.plan = 'Pro' and p.email_verified = true
    )
  );

drop policy if exists "community creators add owner membership" on public.community_memberships;
create policy "community creators add owner membership"
  on public.community_memberships for insert to authenticated
  with check (
    auth.uid() = user_id
    and role = 'owner'
    and status = 'approved'
    and exists (
      select 1 from public.communities c
      where c.id = community_id and c.owner_id = auth.uid()
    )
  );

revoke all on function public.mark_datachat_email_verified() from public;
revoke all on function public.datachat_admin_snapshot(text,text) from public;
revoke all on function public.datachat_admin_update_user(text,text,uuid,text,text) from public;
revoke all on function public.datachat_admin_delete_user(text,text,uuid) from public;
revoke all on function public.datachat_admin_create_root_community(text,text,text,text,text,uuid,boolean,boolean) from public;
grant execute on function public.mark_datachat_email_verified() to authenticated;
grant execute on function public.datachat_admin_snapshot(text,text) to anon, authenticated;
grant execute on function public.datachat_admin_update_user(text,text,uuid,text,text) to anon, authenticated;
grant execute on function public.datachat_admin_delete_user(text,text,uuid) to anon, authenticated;
grant execute on function public.datachat_admin_create_root_community(text,text,text,text,text,uuid,boolean,boolean) to anon, authenticated;
