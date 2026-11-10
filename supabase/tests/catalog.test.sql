-- The catalog: what visitors may see, who may change it, and the admin
-- functions' all-or-nothing edits. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(37);

insert into auth.users (id, email, aud, role) values
  ('33333333-3333-3333-3333-333333333333', 'reader@example.com', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-4444-444444444444', 'editor@example.com', 'authenticated', 'authenticated');
update public.profiles set role = 'editor' where id = '44444444-4444-4444-4444-444444444444';

-- fixtures (as the table owner): one published and one draft work
insert into public.authors (id, slug, name_bn, name_en, died_year, status) values
  ('a0000000-0000-0000-0000-000000000001', 't-author', 'পরীক্ষক', 'Tester', 1900, 'published'),
  ('a0000000-0000-0000-0000-000000000002', 't-draft-author', 'খসড়া', 'Draft', 1900, 'draft');
insert into public.works (id, slug, title_bn, title_en, title_latn, form, status, rights_basis, rights_verified_at) values
  ('b0000000-0000-0000-0000-000000000001', 't-published', 'প্রকাশিত', 'Published', 'prokashito', 'novel', 'published', 'test', now()),
  ('b0000000-0000-0000-0000-000000000002', 't-draft', 'খসড়া বই', 'Draft', 'khosra', 'novel', 'draft', null, null);
insert into public.editions (id, work_id, source_name, source_url, license, status) values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'test', 'https://example.org', 'PD', 'published'),
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'test', 'https://example.org', 'PD', 'published');
insert into public.book_files (edition_id, storage_path, sha256, bytes) values
  ('e0000000-0000-0000-0000-000000000001', 'x.epub', repeat('1', 64), 10),
  ('e0000000-0000-0000-0000-000000000002', 'y.epub', repeat('2', 64), 10);
insert into public.genres (id, slug, name_bn, name_en) values ('c0000000-0000-0000-0000-000000000001', 't-genre', 'ধারা', 'Genre');

-- ── constraints ──────────────────────────────────────────────────────────
select lives_ok(
  $$ update public.works set rights_basis = null where id = 'b0000000-0000-0000-0000-000000000001' $$,
  'a published work may omit a rights basis');

-- ── visitors ─────────────────────────────────────────────────────────────
set local role anon;
select is((select count(*)::int from public.works where slug like 't-%'), 1, 'visitors see published works only');
select is((select count(*)::int from public.authors where slug like 't-%'), 1, 'visitors see published authors only');
select is((select count(*)::int from public.editions where id::text like 'e0000000%'), 1, 'editions of drafts are hidden');
select is((select count(*)::int from public.book_files where sha256 in (repeat('1', 64), repeat('2', 64))), 1, 'files of drafts are hidden');
select is((select count(*)::int from public.genres where slug = 't-genre'), 1, 'genres are public');
select throws_ok($$ insert into public.works (slug, title_bn, title_en, title_latn, form) values ('t-x', 'x', 'x', 'x', 'novel') $$,
  '42501', null, 'visitors cannot add works');
select throws_ok($$ select public.admin_save_work('{}'::jsonb) $$, '42501', null, 'visitors cannot call admin functions');
reset role;

-- ── a reader ─────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated","email":"reader@example.com"}';
select is((select count(*)::int from public.works where slug like 't-%'), 1, 'readers see published works only');
select throws_ok($$ insert into public.works (slug, title_bn, title_en, title_latn, form) values ('t-x', 'x', 'x', 'x', 'novel') $$,
  '42501', null, 'readers cannot add works');
select is_empty($$ update public.works set title_bn = 'hacked' where slug = 't-published' returning id $$, 'readers cannot change works');
select is_empty($$ delete from public.genres where slug = 't-genre' returning id $$, 'readers cannot delete genres');
select throws_ok($$ update public.profiles set role = 'admin' where id = '33333333-3333-3333-3333-333333333333' $$,
  '42501', null, 'readers cannot promote themselves');
select lives_ok($$ update public.profiles set display_name = 'Reader' where id = '33333333-3333-3333-3333-333333333333' $$,
  'readers may change their display name');
select throws_ok(
  $$ select public.admin_save_work('{"slug":"t-new","title_bn":"ক","title_en":"k","title_latn":"k","form":"novel","status":"draft","authors":[{"id":"a0000000-0000-0000-0000-000000000001"}]}'::jsonb) $$,
  '42501', 'editors only', 'readers cannot save works through the admin function');
select throws_ok($$ select public.admin_make_file_current(gen_random_uuid()) $$, '42501', 'editors only', 'nor switch files');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('books', 'evil.epub') $$,
  '42501', null, 'readers cannot upload book files');
reset role;

-- ── an editor ────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated","email":"editor@example.com"}';
select is((select count(*)::int from public.works where slug like 't-%'), 2, 'editors see drafts');
select is((select count(*)::int from public.book_files where sha256 in (repeat('1', 64), repeat('2', 64))), 2, 'and their files');
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('books', 'pgtap-test.epub') $$, 'editors can store book files');
select is((select count(*)::int from storage.objects where bucket_id = 'books' and name = 'pgtap-test.epub'), 1, 'and read them back (needed for upserts)');

create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;
insert into ids values ('work', public.admin_save_work($$
  {"slug":"t-new","title_bn":"নতুন বই","title_en":"New","title_latn":"notun boi","form":"novel","status":"draft",
   "cover_variant":7,"authors":[{"id":"a0000000-0000-0000-0000-000000000001","role":"author"},{"id":"a0000000-0000-0000-0000-000000000002","role":"translator"}],
   "genres":["c0000000-0000-0000-0000-000000000001"],"collections":[]}
$$::jsonb));
select is((select title_bn from public.works where id = (select v from ids where k = 'work')), 'নতুন বই', 'an editor creates a work');
select is((select count(*)::int from public.work_authors where work_id = (select v from ids where k = 'work')), 2, 'with its credits');
select is((select role::text from public.work_authors where work_id = (select v from ids where k = 'work') and position = 1), 'translator', 'in order, with roles');
select is((select count(*)::int from public.work_genres where work_id = (select v from ids where k = 'work')), 1, 'and its genre');

select throws_ok(
  format($$ select public.admin_save_work('{"id":"%s","slug":"t-new","title_bn":"নতুন বই","title_en":"New","title_latn":"n","form":"novel","status":"published","authors":[{"id":"a0000000-0000-0000-0000-000000000001"}]}'::jsonb) $$,
    (select v from ids where k = 'work')),
  '23514', null, 'publishing needs verified rights');
select is((select count(*)::int from public.work_authors where work_id = (select v from ids where k = 'work')), 2,
  'a failed save changes nothing (credits intact)');
select throws_ok(
  format($$ select public.admin_save_work('{"id":"%s","slug":"t-new","title_bn":"x","title_en":"x","title_latn":"x","form":"novel","status":"draft","authors":[{"id":"%s"}]}'::jsonb) $$,
    (select v from ids where k = 'work'), gen_random_uuid()),
  '23503', null, 'an unknown author is refused');
select is((select title_bn from public.works where id = (select v from ids where k = 'work')), 'নতুন বই', 'and the title is unchanged');
select throws_ok(
  format($$ select public.admin_save_work('{"id":"%s","slug":"t-new","title_bn":"x","title_en":"x","title_latn":"x","form":"novel","status":"draft","authors":[]}'::jsonb) $$,
    (select v from ids where k = 'work')),
  '22023', null, 'a work needs an author');

select lives_ok(
  format($$ select public.admin_save_work('{"id":"%s","slug":"t-new","title_bn":"নতুন বই","title_en":"New","title_latn":"n","form":"novel","status":"published","authors":[{"id":"a0000000-0000-0000-0000-000000000001"}]}'::jsonb) $$,
    (select v from ids where k = 'work')),
  'a work publishes without a rights record');
select is((select status from public.works where id = (select v from ids where k = 'work')), 'published', 'and stays published');

-- editions and files
insert into ids values ('edition', public.admin_save_edition(format(
  '{"work_id":"%s","source_name":"test","source_url":"https://example.org","license":"PD","is_primary":true,"status":"published"}',
  (select v from ids where k = 'work'))::jsonb));
insert into ids values ('file1', public.admin_add_book_file((select v from ids where k = 'edition'), repeat('a', 64), 100, '3.0', '{}', '[{"label":"এক","href":"1.xhtml"}]', 1));
insert into ids values ('file2', public.admin_add_book_file((select v from ids where k = 'edition'), repeat('b', 64), 120, '3.0', '{}', '[{"label":"এক","href":"1.xhtml"},{"label":"দুই","href":"2.xhtml"}]', 2));
select is(
  (select array_agg(sha256 order by sha256) from public.book_files where edition_id = (select v from ids where k = 'edition') and is_current),
  array[repeat('b', 64)], 'a new file becomes the only current one');
select is((select chapter_count from public.editions where id = (select v from ids where k = 'edition')), 2, 'and brings its table of contents');
select lives_ok(format($$ select public.admin_make_file_current('%s') $$, (select v from ids where k = 'file1')), 'an earlier file can be made current again');
select is(
  (select array_agg(sha256) from public.book_files where edition_id = (select v from ids where k = 'edition') and is_current),
  array[repeat('a', 64)], 'and is then the only current one');
select throws_ok(
  format($$ select public.admin_add_book_file('%s', repeat('1', 64), 10, '3.0', '{}', '[]', 0) $$, (select v from ids where k = 'edition')),
  '23505', null, 'a file cannot be claimed from another edition');
reset role;

select * from finish();
rollback;
