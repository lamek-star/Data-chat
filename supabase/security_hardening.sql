-- DataChat security hardening.
-- Run once in the Supabase SQL Editor, AFTER schema.sql, realtime_chat.sql,
-- production_upgrade.sql and auth_codes_upgrade.sql. Safe to re-run.
--
-- What it fixes:
--   1. Plan and role no longer come from user_metadata (which every user can
--      edit). They live in datachat_entitlements, which users can read but
--      never write. Only the payment server (service_role), the cash-code
--      redeem function and administrators can change them.
--   2. The fixed-username admin password functions are removed. Administrators
--      are normal Supabase accounts with role = 'admin' in datachat_entitlements.
--   3. Username -> email lookup is no longer callable by the public; only the
--      server (service_role) uses it to log a user in.
--   4. Other members can no longer read phone numbers, and nobody can change
--      their own contact code.
--   5. Message recipients can only set read_at, not rewrite a message.
--
-- After running it, make yourself administrator (replace the email):
--   insert into public.datachat_entitlements (user_id, role, source)
--   select id, 'admin', 'bootstrap' from auth.users where email = 'you@example.com'
--   on conflict (user_id) do update set role = 'admin', updated_at = now();

create extension if not exists pgcrypto;

-- 1. Entitlements -----------------------------------------------------------

create table if not exists public.datachat_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'Free' check (plan in ('Free', 'Pro')),
  role text not null default 'user' check (role in ('user', 'admin')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  source text,
  reference text,
  updated_at timestamptz not null default now()
);

alter table public.datachat_entitlements enable row level security;

drop policy if exists "users read own entitlement" on public.datachat_entitlements;
create policy "users read own entitlement" on public.datachat_entitlements
  for select to authenticated using (auth.uid() = user_id);

-- No insert/update/delete policies, and no write grants: users cannot write rows.
revoke insert, update, delete, truncate on public.datachat_entitlements from anon, authenticated;

create or replace function public.is_datachat_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.datachat_entitlements
    where user_id = auth.uid() and role = 'admin' and status = 'active'
  )
$$;

revoke all on function public.is_datachat_admin() from public;
grant execute on function public.is_datachat_admin() to authenticated;

-- Called only by the payment server with the service_role key after Stripe
-- confirms payment. Idempotent.
create or replace function public.grant_datachat_pro(
  target_user uuid,
  grant_source text,
  grant_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not exists (select 1 from auth.users where id = target_user) then
    raise exception 'Unknown user';
  end if;
  insert into public.datachat_entitlements (user_id, plan, source, reference)
  values (target_user, 'Pro', grant_source, grant_reference)
  on conflict (user_id) do update
    set plan = 'Pro',
        source = excluded.source,
        reference = excluded.reference,
        updated_at = now();
  return jsonb_build_object('userId', target_user, 'plan', 'Pro');
end;
$$;

revoke all on function public.grant_datachat_pro(uuid, text, text) from public, anon, authenticated;
grant execute on function public.grant_datachat_pro(uuid, text, text) to service_role;

-- Cash codes: redeeming now records Pro server-side.
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
begin
  if auth.uid() is null then
    raise exception 'Sign in before redeeming a code';
  end if;

  select p.display_name, u.email
  into member_name, member_email
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = auth.uid();

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

  insert into public.datachat_entitlements (user_id, plan, source, reference)
  values (auth.uid(), 'Pro', 'cash_code', redeemed.id::text)
  on conflict (user_id) do update
    set plan = 'Pro', source = 'cash_code', reference = redeemed.id::text, updated_at = now();

  return jsonb_build_object(
    'id', redeemed.id,
    'code', redeemed.code,
    'plan', redeemed.plan,
    'status', redeemed.status
  );
end;
$$;

revoke all on function public.redeem_datachat_pro_code(text) from public, anon;
grant execute on function public.redeem_datachat_pro_code(text) to authenticated;

-- Backfill: members who already redeemed a cash code keep Pro.
insert into public.datachat_entitlements (user_id, plan, source, reference)
select distinct on (c.used_by) c.used_by, 'Pro', 'cash_code', c.id::text
from public.pro_access_codes c
where c.status = 'used' and c.used_by is not null
order by c.used_by, c.used_at desc
on conflict (user_id) do update set plan = 'Pro', updated_at = now();

-- 2. Administrator functions (Supabase login + admin role) -------------------

drop function if exists public.configure_datachat_admin(text, text);
drop function if exists public.create_datachat_pro_code(text, text, text);
drop function if exists public.list_datachat_pro_codes(text, text);
drop table if exists public.datachat_admin_control;

create or replace function public.admin_create_pro_code(requested_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  created public.pro_access_codes;
begin
  if not public.is_datachat_admin() then
    raise exception 'Administrator access required';
  end if;
  if length(btrim(requested_code)) < 12 then
    raise exception 'Access codes must contain at least 12 characters';
  end if;

  insert into public.pro_access_codes (code)
  values (upper(btrim(requested_code)))
  returning * into created;

  return jsonb_build_object(
    'id', created.id,
    'code', created.code,
    'plan', created.plan,
    'status', created.status,
    'paymentMethod', created.payment_method,
    'createdAt', created.created_at
  );
end;
$$;

create or replace function public.admin_list_pro_codes()
returns setof jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_datachat_admin() then
    raise exception 'Administrator access required';
  end if;

  return query
  select jsonb_build_object(
    'id', c.id,
    'code', c.code,
    'plan', c.plan,
    'status', c.status,
    'paymentMethod', c.payment_method,
    'usedById', c.used_by,
    'usedByName', c.used_by_name,
    'usedBy', c.used_by_email,
    'usedAt', c.used_at,
    'createdAt', c.created_at
  )
  from public.pro_access_codes c
  order by c.created_at desc;
end;
$$;

create or replace function public.admin_set_user_plan(target_user uuid, new_plan text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_datachat_admin() then
    raise exception 'Administrator access required';
  end if;
  if new_plan not in ('Free', 'Pro') then
    raise exception 'Unknown plan';
  end if;
  if not exists (select 1 from auth.users where id = target_user) then
    raise exception 'Unknown user';
  end if;
  insert into public.datachat_entitlements (user_id, plan, source, reference)
  values (target_user, new_plan, 'admin', auth.uid()::text)
  on conflict (user_id) do update
    set plan = excluded.plan, source = 'admin', reference = auth.uid()::text, updated_at = now();
  return jsonb_build_object('userId', target_user, 'plan', new_plan);
end;
$$;

revoke all on function public.admin_create_pro_code(text) from public, anon;
revoke all on function public.admin_list_pro_codes() from public, anon;
revoke all on function public.admin_set_user_plan(uuid, text) from public, anon;
grant execute on function public.admin_create_pro_code(text) to authenticated;
grant execute on function public.admin_list_pro_codes() to authenticated;
grant execute on function public.admin_set_user_plan(uuid, text) to authenticated;

-- 3. Username login: server only --------------------------------------------

revoke all on function public.datachat_login_email(text) from public, anon, authenticated;
grant execute on function public.datachat_login_email(text) to service_role;

-- 4. Profiles: hide phone numbers, lock contact codes ------------------------

revoke select, insert, update on public.profiles from anon, authenticated;
grant select (id, display_name, username, contact_code, country, avatar_url, created_at, updated_at)
  on public.profiles to authenticated;
grant update (display_name, country, avatar_url, updated_at)
  on public.profiles to authenticated;
-- Profiles are created by the create_datachat_profile trigger on sign-up.
-- Usernames change through auth metadata (same trigger), so they stay unique.

-- Re-assert the final sign-up trigger. realtime_chat.sql defines an older
-- version without username; re-running it after auth_codes_upgrade.sql would
-- otherwise break every sign-up (profiles.username is NOT NULL).
create or replace function public.create_datachat_profile()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, username, contact_code, country, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), 'DataChat member'),
    lower(coalesce(
      nullif(new.raw_user_meta_data ->> 'username', ''),
      split_part(new.email, '@', 1) || '-' || substr(replace(new.id::text, '-', ''), 1, 6)
    )),
    upper(substr(replace(new.id::text, '-', ''), 1, 12)),
    coalesce(new.raw_user_meta_data ->> 'country', 'Global'),
    coalesce(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (id) do update set
    display_name = excluded.display_name,
    username = excluded.username,
    phone = excluded.phone,
    updated_at = now();
  return new;
end;
$$;
revoke all on function public.create_datachat_profile() from public, anon, authenticated;

-- 5. Messages: recipients may only mark as read -----------------------------

revoke update on public.direct_messages from anon, authenticated;
grant update (read_at) on public.direct_messages to authenticated;
