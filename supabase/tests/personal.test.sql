-- A reader's own books: the synced record, the private storage folder, and
-- deleting an account that keeps files. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(17);

insert into auth.users (id, email, aud, role) values
  ('33333333-3333-3333-3333-333333333333', 'own-a@example.com', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-4444-444444444444', 'own-b@example.com', 'authenticated', 'authenticated');

select ok((select relrowsecurity from pg_class where oid = 'public.personal_books'::regclass), 'row level security is on for personal_books');
select is((select public from storage.buckets where id = 'personal-books'), false, 'the personal-books bucket is private');

-- catalogue slugs can never look like a reader's own book
select throws_ok(
  $$ insert into public.works (slug, title_bn, title_en, title_latn, form) values ('mine-0123456789abcdef01234567', 'x', 'x', 'x', 'novel') $$,
  '23514', null, 'a catalogue slug cannot start with mine-');

-- ── reader A keeps a book in the account ─────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select lives_ok(
  $$ select public.sync_push('[{"t":"personal_books","id":"mine-0123456789abcdef01234567","u":1000,"r":{"file_sha":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","title":"আমার বই","author":"কেউ","bytes":1234,"added_at":900,"uploaded_at":1000}}]'::jsonb) $$,
  'a book record is pushed');
select is((select title from public.personal_books where id = 'mine-0123456789abcdef01234567'), 'আমার বই', 'and stored');
select is(
  (select count(*)::int from jsonb_array_elements(public.sync_pull(0) -> 'rows') r where r ->> 't' = 'personal_books'),
  1, 'and pulled by the reader''s other devices');
select throws_ok(
  $$ select public.sync_push('[{"t":"personal_books","id":"devdas","u":1000,"r":{"title":"x"}}]'::jsonb) $$,
  '23514', null, 'only mine- ids are personal books');

-- the private folder
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('personal-books', '33333333-3333-3333-3333-333333333333/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.epub', '33333333-3333-3333-3333-333333333333') $$,
  'a reader stores a file in their own folder');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('personal-books', '44444444-4444-4444-4444-444444444444/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.epub') $$,
  '42501', null, 'but never in someone else''s');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('personal-books', '33333333-3333-3333-3333-333333333333/notes.txt') $$,
  '42501', null, 'and only as <sha256>.epub');
select is((select count(*)::int from storage.objects where bucket_id = 'personal-books'), 1, 'A sees their own file');

-- deleting the account while a file remains would orphan its bytes
select throws_ok($$ select public.delete_my_account() $$, '55000', null, 'the account is not deleted while files remain');

-- ── reader B sees none of it ─────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select is((select count(*)::int from public.personal_books), 0, 'B reads none of A''s books');
select is((select count(*)::int from storage.objects where bucket_id = 'personal-books'), 0, 'B sees none of A''s files');
select is(
  (select count(*)::int from jsonb_array_elements(public.sync_pull(0) -> 'rows')),
  0, 'B pulls nothing of A''s');

-- anonymous visitors
reset role;
set local role anon;
select is((select count(*)::int from storage.objects where bucket_id = 'personal-books'), 0, 'anonymous visitors see no personal files');

-- once the files are gone (through the Storage API in the app), the account can go
reset role;
set local storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id = 'personal-books' and name like '33333333-3333-3333-3333-333333333333/%';
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select lives_ok($$ select public.delete_my_account() $$, 'with no files left, the account is deleted');

select * from finish();
rollback;
