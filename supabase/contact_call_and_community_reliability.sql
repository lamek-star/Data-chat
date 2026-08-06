-- Reciprocal QR contacts and reliable community membership refresh.
-- Apply after message_controls_and_independent_communities.sql.

drop function if exists public.resolve_datachat_contact(uuid, text);
create function public.resolve_datachat_contact(
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
  phone text,
  plan text,
  status text
)
language sql
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.username, p.contact_code, p.country,
         p.avatar_url, p.phone, p.plan, p.status
  from public.profiles p
  where auth.uid() is not null
    and requested_contact_code is not null
    and p.contact_code = upper(trim(requested_contact_code))
    and (
      p.id = requested_user_id
      or (requested_user_id is null and p.visible_in_community = true)
    )
    and p.id <> auth.uid()
    and p.status = 'active'
  limit 1;
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
      and p.status = 'active'
  ) then
    raise exception 'Invalid or expired contact QR';
  end if;

  -- Sharing the exact account-bound QR is consent to establish the contact
  -- relationship. Both sides need the relationship so incoming messages can
  -- be rendered immediately, even when either profile is hidden in Community.
  insert into public.user_contacts(owner_id, contact_user_id, source)
  values
    (auth.uid(), requested_user_id, 'qr'),
    (requested_user_id, auth.uid(), 'qr')
  on conflict (owner_id, contact_user_id) do nothing;
  return true;
end;
$$;

revoke all on function public.resolve_datachat_contact(uuid, text) from public;
revoke all on function public.add_datachat_contact_by_qr(uuid, text) from public;
grant execute on function public.resolve_datachat_contact(uuid, text) to authenticated;
grant execute on function public.add_datachat_contact_by_qr(uuid, text) to authenticated;

-- Ensure both community tables remain available to Realtime. Duplicate-object
-- exceptions are intentionally ignored for projects where they are present.
do $$
begin
  alter publication supabase_realtime add table public.communities;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.community_memberships;
exception when duplicate_object then null;
end $$;
