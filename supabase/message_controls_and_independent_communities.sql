-- DataChat message controls and independent user communities.
-- Apply after low_bandwidth_reliability_upgrade.sql.

create or replace function public.edit_datachat_direct_message(
  requested_message_id uuid,
  requested_content text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare updated_payload jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if length(trim(coalesce(requested_content, ''))) = 0 then
    raise exception 'Message cannot be empty';
  end if;

  update public.direct_messages
  set payload = payload
    || jsonb_build_object(
      'content', left(trim(requested_content), 4000),
      'edited', true,
      'editedAt', now()
    )
  where id = requested_message_id
    and sender_id = auth.uid()
    and coalesce((payload->>'deleted')::boolean, false) = false
    and not (payload ? 'transaction')
    and not (payload ? 'voicePath')
  returning payload into updated_payload;

  if updated_payload is null then
    raise exception 'Only your text messages can be edited';
  end if;
  return updated_payload;
end;
$$;

create or replace function public.delete_datachat_direct_message(
  requested_message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare updated_payload jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  update public.direct_messages
  set payload = jsonb_build_object(
    'version', 2,
    'content', 'This message was deleted',
    'deleted', true,
    'deletedAt', now(),
    'time', payload->>'time'
  )
  where id = requested_message_id
    and sender_id = auth.uid()
  returning payload into updated_payload;

  if updated_payload is null then
    raise exception 'Only the sender can delete this message';
  end if;
  return updated_payload;
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

  if requested_parent_id is not null and not exists (
    select 1
    from public.communities c
    join public.community_memberships m
      on m.community_id = c.id and m.user_id = auth.uid()
    where c.id = requested_parent_id
      and c.is_admin_root = false
      and c.allow_subgroups = true
      and m.status = 'approved'
  ) then
    raise exception 'You need approved membership in a community that allows subgroups';
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
  on conflict (community_id, user_id) do update
    set status = 'approved', role = 'owner', decided_at = now();
  return created_id;
end;
$$;

revoke all on function public.edit_datachat_direct_message(uuid,text) from public;
revoke all on function public.delete_datachat_direct_message(uuid) from public;
revoke all on function public.create_datachat_child_community(text,text,text,uuid,boolean) from public;
grant execute on function public.edit_datachat_direct_message(uuid,text) to authenticated;
grant execute on function public.delete_datachat_direct_message(uuid) to authenticated;
grant execute on function public.create_datachat_child_community(text,text,text,uuid,boolean) to authenticated;
