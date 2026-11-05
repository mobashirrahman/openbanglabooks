-- Connections to other services: tokens are reachable only through the
-- definer functions, only for their owner. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(18);

insert into auth.users (id, email, aud, role) values
  ('55555555-5555-5555-5555-555555555555', 'conn-a@example.com', 'authenticated', 'authenticated'),
  ('66666666-6666-6666-6666-666666666666', 'conn-b@example.com', 'authenticated', 'authenticated');

select ok((select relrowsecurity from pg_class where oid = 'public.connections'::regclass), 'row level security is on');
select is((select count(*)::int from pg_policies where tablename = 'connections'), 0, 'and there is no policy: no direct access at all');

-- ── reader A connects ────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';

select throws_ok($$ select * from public.connections $$, '42501', null, 'the table cannot be read directly');
select throws_ok(
  $$ insert into public.connections (user_id, provider, secret) values ('55555555-5555-5555-5555-555555555555', 'readwise', 'v1.AAAAAAAAAAAAAAAAAAAAAAAA') $$,
  '42501', null, 'nor written');

select throws_ok($$ select public.connection_save('readwise', 'plain-token-1234567890', null, null) $$, '23514', null, 'only ciphertext is stored');
select lives_ok($$ select public.connection_save('readwise', 'v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAA', null, null) $$, 'a sealed token is saved');
select lives_ok($$ select public.connection_save('hardcover', 'v1.BBBBBBBBBBBBBBBBBBBBBBBBBBBB', 'reader_a', now() + interval '7 days') $$, 'and another');
select is((select array_agg(provider || ':' || coalesce(account_label, '-')) from public.connection_list()), array['hardcover:reader_a', 'readwise:-'], 'the list names them, without secrets');
select is((select secret from public.connection_secret('readwise')), 'v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'the owner gets the ciphertext back');

-- one refresh at a time
select is((select count(*)::int from public.connection_lease('hardcover')), 1, 'the first request takes the refresh lease');
select is((select count(*)::int from public.connection_lease('hardcover')), 0, 'a second does not');
select ok(not public.connection_rotate('hardcover', 999, 'v1.CCCCCCCCCCCCCCCCCCCCCCCCCCCC', now()), 'tokens from a stale version are not stored');
select ok(public.connection_rotate('hardcover', (select version from public.connection_secret('hardcover')), 'v1.CCCCCCCCCCCCCCCCCCCCCCCCCCCC', now() + interval '7 days'), 'the leased version stores the new pair');
select is((select leased from public.connection_secret('hardcover')), false, 'and frees the lease');

-- ── reader B sees none of it ─────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';
select is((select count(*)::int from public.connection_list()), 0, 'B lists nothing of A''s');
select is((select count(*)::int from public.connection_secret('readwise')), 0, 'and gets no secret');

-- anonymous visitors cannot call the functions at all
reset role;
set local role anon;
select throws_ok($$ select * from public.connection_list() $$, '42501', null, 'anonymous visitors are refused');

-- deleting the account removes its connections
reset role;
delete from auth.users where id = '55555555-5555-5555-5555-555555555555';
select is((select count(*)::int from public.connections where user_id = '55555555-5555-5555-5555-555555555555'), 0, 'connections go with the account');

select * from finish();
rollback;
