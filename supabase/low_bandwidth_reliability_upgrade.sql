-- DataChat messaging/community reliability upgrade.
-- Apply after professional_mobile_upgrade.sql.

create or replace function public.request_datachat_community_join(
  requested_community_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.communities c where c.id = requested_community_id
  ) then raise exception 'Community not found'; end if;

  insert into public.community_memberships(
    community_id, user_id, status, role, requested_at, decided_at
  )
  values (
    requested_community_id, auth.uid(), 'pending', 'member', now(), null
  )
  on conflict (community_id, user_id) do update
  set status = case
        when community_memberships.status = 'approved' then 'approved'
        else 'pending'
      end,
      requested_at = case
        when community_memberships.status = 'approved'
          then community_memberships.requested_at
        else now()
      end,
      decided_at = case
        when community_memberships.status = 'approved'
          then community_memberships.decided_at
        else null
      end;
  return true;
end;
$$;

create or replace function public.decide_datachat_community_join(
  requested_community_id uuid,
  requested_user_id uuid,
  requested_approved boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.communities c
    where c.id = requested_community_id
      and c.owner_id = auth.uid()
      and c.is_admin_root = false
  ) then raise exception 'Only the community owner can decide this request'; end if;

  update public.community_memberships
  set status = case when requested_approved then 'approved' else 'declined' end,
      decided_at = now()
  where community_id = requested_community_id
    and user_id = requested_user_id
    and status = 'pending';
  if not found then raise exception 'Pending request not found'; end if;
  return true;
end;
$$;

create or replace function public.create_datachat_child_community(
  requested_name text,
  requested_location text,
  requested_purpose text,
  requested_parent_id uuid,
  requested_allow_subgroups boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare created_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.plan = 'Pro'
      and p.email_verified = true
      and p.status = 'active'
  ) then raise exception 'Verified Pro membership is required'; end if;
  if not exists (
    select 1
    from public.communities c
    join public.community_memberships m
      on m.community_id = c.id and m.user_id = auth.uid()
    where c.id = requested_parent_id
      and c.allow_subgroups = true
      and m.status = 'approved'
  ) then
    raise exception 'Join the parent community and wait for approval first';
  end if;

  insert into public.communities(
    name, location, purpose, parent_id, owner_id, is_admin_root,
    allow_subgroups, allow_invites
  )
  values (
    left(trim(requested_name), 80),
    left(trim(requested_location), 80),
    left(trim(requested_purpose), 500),
    requested_parent_id,
    auth.uid(),
    false,
    requested_allow_subgroups,
    true
  )
  returning id into created_id;

  insert into public.community_memberships(
    community_id, user_id, status, role, decided_at
  )
  values (created_id, auth.uid(), 'approved', 'owner', now())
  on conflict (community_id, user_id) do nothing;
  return created_id;
end;
$$;

create or replace function public.datachat_admin_community_requests(
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
    where a.singleton = true
      and a.username = lower(trim(requested_username))
      and a.password_hash = crypt(requested_password, a.password_hash)
  ) then raise exception 'Administrator credentials are incorrect'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'communityId', c.id,
      'communityName', c.name,
      'userId', m.user_id,
      'userName', p.display_name,
      'userEmail', u.email,
      'requestedAt', m.requested_at,
      'status', m.status
    ) order by m.requested_at asc)
    from public.community_memberships m
    join public.communities c on c.id = m.community_id
    join public.profiles p on p.id = m.user_id
    join auth.users u on u.id = m.user_id
    where c.is_admin_root = true and m.status = 'pending'
  ), '[]'::jsonb);
end;
$$;

create or replace function public.datachat_admin_decide_community_join(
  requested_username text,
  requested_password text,
  requested_community_id uuid,
  requested_user_id uuid,
  requested_approved boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not exists (
    select 1 from public.datachat_admin_control a
    where a.singleton = true
      and a.username = lower(trim(requested_username))
      and a.password_hash = crypt(requested_password, a.password_hash)
  ) then raise exception 'Administrator credentials are incorrect'; end if;
  if not exists (
    select 1 from public.communities c
    where c.id = requested_community_id and c.is_admin_root = true
  ) then raise exception 'Administrator approval applies only to root communities'; end if;

  update public.community_memberships
  set status = case when requested_approved then 'approved' else 'declined' end,
      decided_at = now()
  where community_id = requested_community_id
    and user_id = requested_user_id
    and status = 'pending';
  if not found then raise exception 'Pending request not found'; end if;
  return true;
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
    where a.singleton = true
      and a.username = lower(trim(requested_username))
      and a.password_hash = crypt(requested_password, a.password_hash)
  ) then raise exception 'Invalid administrator credentials'; end if;

  return jsonb_build_object(
    'contactRequests', (select count(*) from public.contact_requests),
    'communityRequests', (
      select count(*)
      from public.community_memberships m
      join public.communities c on c.id = m.community_id
      where c.is_admin_root = true and m.status = 'pending'
    ),
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

do $$
begin
  alter publication supabase_realtime add table public.community_memberships;
exception when duplicate_object then null;
end $$;

drop policy if exists "community owners view applicants" on public.profiles;
create policy "community owners view applicants"
  on public.profiles for select to authenticated
  using (
    exists (
      select 1
      from public.community_memberships m
      join public.communities c on c.id = m.community_id
      where m.user_id = profiles.id
        and c.owner_id = auth.uid()
    )
  );

revoke all on function public.request_datachat_community_join(uuid) from public;
revoke all on function public.decide_datachat_community_join(uuid,uuid,boolean) from public;
revoke all on function public.create_datachat_child_community(text,text,text,uuid,boolean) from public;
revoke all on function public.datachat_admin_community_requests(text,text) from public;
revoke all on function public.datachat_admin_decide_community_join(text,text,uuid,uuid,boolean) from public;
revoke all on function public.datachat_admin_operational_snapshot(text,text) from public;
grant execute on function public.request_datachat_community_join(uuid) to authenticated;
grant execute on function public.decide_datachat_community_join(uuid,uuid,boolean) to authenticated;
grant execute on function public.create_datachat_child_community(text,text,text,uuid,boolean) to authenticated;
grant execute on function public.datachat_admin_community_requests(text,text) to anon, authenticated;
grant execute on function public.datachat_admin_decide_community_join(text,text,uuid,uuid,boolean) to anon, authenticated;
grant execute on function public.datachat_admin_operational_snapshot(text,text) to anon, authenticated;
