-- Permission and behaviour tests for supabase/*.sql.
-- Run by tests/sql/run.sh after all migrations are applied. Any failure
-- raises an exception and stops psql (ON_ERROR_STOP).

create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

-- Run sql as the current role; pass if it raises one of the listed errors.
create or replace function tests.expect_error(label text, sql text, expected text default 'insufficient_privilege|raise_exception')
returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if sqlstate in ('42501') and expected like '%insufficient_privilege%' then
      raise notice 'PASS  %', label; return;
    elsif sqlstate = 'P0001' and expected like '%raise_exception%' then
      raise notice 'PASS  %  (%)', label, sqlerrm; return;
    elsif sqlstate = '42883' and expected like '%undefined_function%' then
      raise notice 'PASS  %', label; return;
    end if;
    raise exception 'FAIL  %: unexpected error % %', label, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL  %: statement succeeded but should have been refused', label;
end $$;

create or replace function tests.expect_eq(label text, actual text, expected text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL  %: expected %, got %', label, expected, actual;
  end if;
  raise notice 'PASS  %', label;
end $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- Fixture: Alice (member), Bob (admin), Carol (member with a legacy code).
\set alice '''7f3c1a52-9d0e-4b8a-a1f2-0c5d6e7f8a91'''
\set bob   '''2b9e4c7d-1a3f-4e5b-8c6d-7e8f9a0b1c2d'''
\set carol '''c4d5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f'''

insert into public.datachat_entitlements (user_id, role, source)
values (:bob, 'admin', 'bootstrap')
on conflict (user_id) do update set role = 'admin';

insert into public.direct_messages (id, sender_id, recipient_id, payload)
values ('11111111-1111-4111-8111-111111111111', :alice, :carol, '{"text":"hello carol"}'),
       ('22222222-2222-4222-8222-222222222222', :bob, :carol, '{"text":"private bob to carol"}');

-- ---------------------------------------------------------------- anon --
begin;
set local role anon;
select tests.expect_error('anon cannot look up emails by username',
  $$select public.datachat_login_email('alice')$$);
select tests.expect_error('anon cannot list access codes',
  $$select public.admin_list_pro_codes()$$);
select tests.expect_error('anon cannot create access codes',
  $$select public.admin_create_pro_code('ANON-CODE-123456')$$);
select tests.expect_error('anon cannot grant Pro',
  $$select public.grant_datachat_pro('7f3c1a52-9d0e-4b8a-a1f2-0c5d6e7f8a91', 'x', 'y')$$);
select tests.expect_error('anon cannot read profiles',
  $$select display_name from public.profiles$$);
select tests.expect_error('old admin setup function is gone',
  $$select public.configure_datachat_admin('datachat-harmony', 'x')$$, 'undefined_function');
rollback;

-- -------------------------------------------------------------- alice --
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :alice, true);

select tests.expect_eq('member starts on Free (no entitlement row)',
  (select count(*)::text from public.datachat_entitlements), '0');
select tests.expect_error('member cannot insert own entitlement',
  $$insert into public.datachat_entitlements (user_id, plan) values (auth.uid(), 'Pro')$$);
select tests.expect_error('member cannot update entitlements',
  $$update public.datachat_entitlements set plan = 'Pro'$$);
select tests.expect_error('member cannot grant themselves Pro',
  $$select public.grant_datachat_pro(auth.uid(), 'self', 'self')$$);
select tests.expect_error('member cannot look up emails by username',
  $$select public.datachat_login_email('bob')$$);
select tests.expect_error('member cannot list access codes',
  $$select public.admin_list_pro_codes()$$);
select tests.expect_error('member cannot create access codes',
  $$select public.admin_create_pro_code('SELF-MADE-CODE-1234')$$);
select tests.expect_error('member cannot change another plan',
  $$select public.admin_set_user_plan(auth.uid(), 'Pro')$$);
select tests.expect_eq('member is not admin',
  public.is_datachat_admin()::text, 'false');

select tests.expect_eq('member can read public profile columns',
  (select count(*)::text from public.profiles where display_name is not null), '3');
select tests.expect_error('member cannot read phone numbers',
  $$select phone from public.profiles$$);
select tests.expect_error('member cannot select * from profiles',
  $$select * from public.profiles$$);
select tests.expect_error('member cannot change own contact code',
  $$update public.profiles set contact_code = 'VANITY000001' where id = auth.uid()$$);
select tests.expect_error('member cannot change own username directly',
  $$update public.profiles set username = 'bob2' where id = auth.uid()$$);
update public.profiles set display_name = 'Alice A.' where id = auth.uid();
select tests.expect_eq('member can change own display name',
  (select display_name from public.profiles where id = auth.uid()), 'Alice A.');
update public.profiles set display_name = 'Hacked' where id <> auth.uid();
select tests.expect_eq('member cannot change other profiles (RLS)',
  (select count(*)::text from public.profiles where display_name = 'Hacked'), '0');

select tests.expect_eq('member sees only own conversations',
  (select count(*)::text from public.direct_messages), '1');
select tests.expect_error('member cannot send as someone else',
  $$insert into public.direct_messages (sender_id, recipient_id, payload)
    values ('2b9e4c7d-1a3f-4e5b-8c6d-7e8f9a0b1c2d', 'c4d5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f', '{}')$$,
  'insufficient_privilege');
rollback;

-- ------------------------------------------------------- carol (recipient) --
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :carol, true);
select tests.expect_eq('legacy cash-code redeemer was backfilled to Pro',
  (select plan from public.datachat_entitlements where user_id = auth.uid()), 'Pro');
select tests.expect_error('recipient cannot rewrite a received message',
  $$update public.direct_messages set payload = '{"text":"forged"}' where id = '11111111-1111-4111-8111-111111111111'$$);
update public.direct_messages set read_at = now() where id = '11111111-1111-4111-8111-111111111111';
select tests.expect_eq('recipient can mark a message read',
  (select (read_at is not null)::text from public.direct_messages where id = '11111111-1111-4111-8111-111111111111'), 'true');
rollback;

-- ---------------------------------------------------------- bob (admin) --
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :bob, true);
select tests.expect_eq('admin is recognised', public.is_datachat_admin()::text, 'true');
select tests.expect_error('admin code must be at least 12 characters',
  $$select public.admin_create_pro_code('SHORT')$$);
select tests.expect_eq('admin creates an access code',
  public.admin_create_pro_code('dcp-test-0001-abcd') ->> 'code', 'DCP-TEST-0001-ABCD');
select tests.expect_eq('admin lists access codes',
  (select count(*)::text from public.admin_list_pro_codes()), '2');
select tests.expect_error('admin still cannot write entitlements directly',
  $$update public.datachat_entitlements set plan = 'Pro'$$);
commit;

-- ------------------------------------------------- alice redeems the code --
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :alice, true);
select tests.expect_eq('member redeems a valid code',
  public.redeem_datachat_pro_code(' dcp-test-0001-abcd ') ->> 'status', 'used');
select tests.expect_eq('redeeming records Pro server-side',
  (select plan from public.datachat_entitlements where user_id = auth.uid()), 'Pro');
select tests.expect_error('a code cannot be redeemed twice',
  $$select public.redeem_datachat_pro_code('DCP-TEST-0001-ABCD')$$);
select tests.expect_error('unknown code is refused',
  $$select public.redeem_datachat_pro_code('NOT-A-REAL-CODE')$$);
commit;

begin;
set local role anon;
select tests.expect_error('anon cannot redeem codes',
  $$select public.redeem_datachat_pro_code('ANY-CODE-AT-ALL')$$);
rollback;

-- ------------------------------------------------- admin changes a plan --
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :bob, true);
select tests.expect_eq('admin downgrades a member',
  public.admin_set_user_plan('7f3c1a52-9d0e-4b8a-a1f2-0c5d6e7f8a91', 'Free') ->> 'plan', 'Free');
select tests.expect_error('admin cannot set an unknown plan',
  $$select public.admin_set_user_plan('7f3c1a52-9d0e-4b8a-a1f2-0c5d6e7f8a91', 'Gold')$$);
select tests.expect_error('admin cannot target a missing user',
  $$select public.admin_set_user_plan('99999999-9999-4999-8999-999999999999', 'Pro')$$);
commit;

-- -------------------------------------------------------- service role --
begin;
set local role service_role;
select tests.expect_eq('server resolves username to email',
  public.datachat_login_email(' Alice '), 'alice@example.test');
select tests.expect_eq('server returns null for unknown username',
  coalesce(public.datachat_login_email('nobody'), '<null>'), '<null>');
select tests.expect_eq('server grants Pro after payment',
  public.grant_datachat_pro('7f3c1a52-9d0e-4b8a-a1f2-0c5d6e7f8a91', 'stripe', 'cs_test_1') ->> 'plan', 'Pro');
select tests.expect_eq('granting twice is idempotent',
  public.grant_datachat_pro('7f3c1a52-9d0e-4b8a-a1f2-0c5d6e7f8a91', 'stripe', 'cs_test_1') ->> 'plan', 'Pro');
select tests.expect_error('server cannot grant Pro to a missing user',
  $$select public.grant_datachat_pro('99999999-9999-4999-8999-999999999999', 'stripe', 'cs_x')$$);
rollback;

-- ------------------------------------- per-user records and backups --
insert into public.app_data (app_id, user_id, entity_type, entity_id, payload)
values ('datachat', :bob, 'record', 'TXN-B1', '{"amount": 500, "key": "123456"}');
insert into storage.objects (bucket_id, name) values ('private-backups', '2b9e4c7d-1a3f-4e5b-8c6d-7e8f9a0b1c2d/bob.dcbackup');

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :alice, true);
select tests.expect_eq('member cannot read another member''s records',
  (select count(*)::text from public.app_data), '0');
select tests.expect_error('member cannot write records for someone else',
  $$insert into public.app_data (app_id, user_id, entity_type, entity_id) values ('datachat', '2b9e4c7d-1a3f-4e5b-8c6d-7e8f9a0b1c2d', 'record', 'X')$$);
insert into public.app_data (app_id, user_id, entity_type, entity_id) values ('datachat', auth.uid(), 'record', 'TXN-A1');
select tests.expect_eq('member can write own records',
  (select count(*)::text from public.app_data), '1');
select tests.expect_eq('member cannot see another member''s backups',
  (select count(*)::text from storage.objects where bucket_id = 'private-backups'), '0');
select tests.expect_error('member cannot upload into another member''s backup folder',
  $$insert into storage.objects (bucket_id, name) values ('private-backups', '2b9e4c7d-1a3f-4e5b-8c6d-7e8f9a0b1c2d/evil.dcbackup')$$);
rollback;

-- ------------------------------------------------- sign-up still works --
insert into auth.users (email, raw_user_meta_data)
values ('dave@example.test', '{"name":"Dave","username":"dave","phone":"+444"}');
select tests.expect_eq('sign-up trigger creates a profile with username',
  (select username from public.profiles p join auth.users u on u.id = p.id where u.email = 'dave@example.test'), 'dave');

\echo 'ALL SQL ASSERTIONS PASSED'
