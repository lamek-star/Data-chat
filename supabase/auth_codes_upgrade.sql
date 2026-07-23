-- DataChat username/password login and cloud Pro access codes.
-- Run once in the Supabase SQL Editor.

create extension if not exists pgcrypto;

alter table public.profiles add column if not exists username text;

update public.profiles p
set username = lower(
  coalesce(
    nullif((select u.raw_user_meta_data ->> 'username' from auth.users u where u.id = p.id), ''),
    regexp_replace(p.display_name, '[^a-zA-Z0-9._-]+', '', 'g') ||
      '-' || substr(replace(p.id::text, '-', ''), 1, 6)
  )
)
where username is null or btrim(username) = '';

alter table public.profiles alter column username set not null;
create unique index if not exists profiles_username_unique
  on public.profiles (lower(username));

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

create or replace function public.datachat_login_email(requested_username text)
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.email
  from public.profiles p
  join auth.users u on u.id = p.id
  where lower(p.username) = lower(btrim(requested_username))
  limit 1
$$;

revoke all on function public.datachat_login_email(text) from public;
grant execute on function public.datachat_login_email(text) to anon, authenticated;

create table if not exists public.datachat_admin_control (
  singleton boolean primary key default true check (singleton),
  username text not null unique,
  password_hash text not null,
  updated_at timestamptz not null default now()
);

alter table public.datachat_admin_control enable row level security;

create table if not exists public.pro_access_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  plan text not null default 'Pro' check (plan = 'Pro'),
  status text not null default 'available'
    check (status in ('available', 'used', 'revoked')),
  payment_method text not null default 'Cash',
  used_by uuid references auth.users(id) on delete set null,
  used_by_name text,
  used_by_email text,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.pro_access_codes enable row level security;

create or replace function public.configure_datachat_admin(
  requested_username text,
  requested_password text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  saved public.datachat_admin_control;
begin
  if lower(btrim(requested_username)) <> 'datachat-harmony' then
    raise exception 'Administrator username is incorrect';
  end if;
  if length(requested_password) < 12 then
    raise exception 'Administrator password must contain at least 12 characters';
  end if;

  insert into public.datachat_admin_control (singleton, username, password_hash)
  values (true, 'datachat-harmony', crypt(requested_password, gen_salt('bf', 12)))
  on conflict (singleton) do nothing;

  select * into saved from public.datachat_admin_control where singleton = true;
  if saved.password_hash <> crypt(requested_password, saved.password_hash) then
    raise exception 'Administrator credentials are incorrect';
  end if;
  return true;
end;
$$;

create or replace function public.create_datachat_pro_code(
  requested_username text,
  requested_password text,
  requested_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  saved public.datachat_admin_control;
  created public.pro_access_codes;
begin
  select * into saved from public.datachat_admin_control where singleton = true;
  if saved.username <> lower(btrim(requested_username))
     or saved.password_hash <> crypt(requested_password, saved.password_hash) then
    raise exception 'Administrator credentials are incorrect';
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

create or replace function public.list_datachat_pro_codes(
  requested_username text,
  requested_password text
)
returns setof jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  saved public.datachat_admin_control;
begin
  select * into saved from public.datachat_admin_control where singleton = true;
  if saved.username <> lower(btrim(requested_username))
     or saved.password_hash <> crypt(requested_password, saved.password_hash) then
    raise exception 'Administrator credentials are incorrect';
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

  return jsonb_build_object(
    'id', redeemed.id,
    'code', redeemed.code,
    'plan', redeemed.plan,
    'status', redeemed.status
  );
end;
$$;

revoke all on function public.configure_datachat_admin(text, text) from public;
revoke all on function public.create_datachat_pro_code(text, text, text) from public;
revoke all on function public.list_datachat_pro_codes(text, text) from public;
revoke all on function public.redeem_datachat_pro_code(text) from public;

grant execute on function public.configure_datachat_admin(text, text) to anon, authenticated;
grant execute on function public.create_datachat_pro_code(text, text, text) to anon, authenticated;
grant execute on function public.list_datachat_pro_codes(text, text) to anon, authenticated;
grant execute on function public.redeem_datachat_pro_code(text) to authenticated;
