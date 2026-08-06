-- Atomic QR contact connection and WhatsApp-style read receipts.

create or replace function public.connect_datachat_contact_by_qr(
  requested_user_id uuid,
  requested_contact_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  peer public.profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into peer
  from public.profiles p
  where p.id = requested_user_id
    and p.contact_code = upper(trim(requested_contact_code))
    and p.id <> auth.uid()
    and p.status = 'active';
  if peer.id is null then raise exception 'Invalid or expired DataChat contact QR'; end if;

  insert into public.user_contacts(owner_id, contact_user_id, source)
  values
    (auth.uid(), peer.id, 'qr'),
    (peer.id, auth.uid(), 'qr')
  on conflict (owner_id, contact_user_id) do nothing;

  return jsonb_build_object(
    'id', peer.id,
    'display_name', peer.display_name,
    'username', peer.username,
    'contact_code', peer.contact_code,
    'country', peer.country,
    'phone', peer.phone,
    'avatar_url', peer.avatar_url,
    'plan', peer.plan,
    'status', peer.status
  );
end;
$$;

create or replace function public.mark_datachat_conversation_read(
  requested_sender_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare changed integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.direct_messages
  set read_at = coalesce(read_at, now())
  where recipient_id = auth.uid()
    and sender_id = requested_sender_id
    and read_at is null;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.connect_datachat_contact_by_qr(uuid,text) from public;
revoke all on function public.mark_datachat_conversation_read(uuid) from public;
grant execute on function public.connect_datachat_contact_by_qr(uuid,text) to authenticated;
grant execute on function public.mark_datachat_conversation_read(uuid) to authenticated;

create table if not exists public.call_signals (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('offer','answer','ice','end','decline')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists call_signals_recipient_created_idx
  on public.call_signals(recipient_id, created_at desc);
alter table public.call_signals enable row level security;
drop policy if exists "call participants read signals" on public.call_signals;
create policy "call participants read signals" on public.call_signals
  for select to authenticated using (auth.uid() in (sender_id, recipient_id));
drop policy if exists "contacts send call signals" on public.call_signals;
create policy "contacts send call signals" on public.call_signals
  for insert to authenticated with check (
    auth.uid() = sender_id
    and sender_id <> recipient_id
    and exists (
      select 1 from public.user_contacts c
      where c.owner_id = auth.uid() and c.contact_user_id = recipient_id
    )
  );
do $$ begin
  alter publication supabase_realtime add table public.call_signals;
exception when duplicate_object then null;
end $$;
