-- Personal data and sync: isolation, last-writer-wins, conflict copies,
-- tombstones and paging. Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(46);

insert into auth.users (id, email, aud, role) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.com', 'authenticated', 'authenticated');

-- ── structure ────────────────────────────────────────────────────────────
select ok(
  (select bool_and(relrowsecurity) from pg_class where oid in (
    'public.user_books'::regclass, 'public.user_shelves'::regclass, 'public.shelf_items'::regclass,
    'public.reading_positions'::regclass, 'public.bookmarks'::regclass, 'public.annotations'::regclass,
    'public.reader_settings'::regclass, 'public.reading_days'::regclass, 'public.sync_state'::regclass)),
  'row level security is on for every personal table');

-- ── anonymous visitors ───────────────────────────────────────────────────
set local role anon;
select throws_ok($$ select public.sync_push('[]'::jsonb) $$, '42501', null, 'anon cannot push');
select throws_ok($$ select public.sync_pull(0) $$, '42501', null, 'anon cannot pull');
select throws_ok($$ select count(*) from public.annotations $$, '42501', null, 'anon cannot read annotations');
reset role;

-- ── reader A pushes ──────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  public.sync_push($$[
    {"t":"bookmarks","id":"bm1","u":1000,"r":{"work_slug":"devdas","cfi":"epubcfi(/6/4!/4/2)","fraction":0.1,"excerpt":"পার্বতী","created_at":1000}},
    {"t":"annotations","id":"n1","u":1000,"r":{"work_slug":"devdas","cfi":"epubcfi(/6/4!/4/2,/1:0,/1:5)","quote":"দেবদাস","color":"yellow","style":"highlight","note":"first","fraction":0.1}}
  ]$$::jsonb) ->> 'version',
  '1', 'the first push is version 1');

select is((public.sync_pull(0) -> 'rows')::jsonb ->> 0 is not null, true, 'pull returns rows');
select is(jsonb_array_length(public.sync_pull(0) -> 'rows'), 2, 'pull since 0 returns both rows');
select is((public.sync_pull(0) ->> 'version')::bigint, 1::bigint, 'pull reports the version reached');
select is(jsonb_array_length(public.sync_pull(1) -> 'rows'), 0, 'nothing after version 1');
select is((select count(*)::int from public.annotations), 1, 'A reads own annotations');
select throws_ok(
  $$ insert into public.annotations (user_id, id, updated_at, version) values ('11111111-1111-1111-1111-111111111111', 'x', 1, 1) $$,
  '42501', null, 'no direct writes, even to own rows');
select throws_ok(
  $$ update public.annotations set note = 'sneaky' $$,
  '42501', null, 'no direct updates');

-- user_id in a pushed row is ignored: rows always belong to the caller
select public.sync_push($$[{"t":"bookmarks","id":"bm-inject","u":1000,"r":{"user_id":"22222222-2222-2222-2222-222222222222","work_slug":"x"}}]$$::jsonb);

-- last writer wins
select public.sync_push($$[{"t":"bookmarks","id":"bm1","u":900,"r":{"work_slug":"devdas","excerpt":"older"}}]$$::jsonb);
select is((select excerpt from public.bookmarks where id = 'bm1'), 'পার্বতী', 'an older change is ignored');
select public.sync_push($$[{"t":"bookmarks","id":"bm1","u":1000,"r":{"work_slug":"devdas","excerpt":"same time"}}]$$::jsonb);
select is((select excerpt from public.bookmarks where id = 'bm1'), 'পার্বতী', 'a tie changes nothing');
select public.sync_push($$[{"t":"bookmarks","id":"bm1","u":1100,"r":{"work_slug":"devdas","excerpt":"newer"}}]$$::jsonb);
select is((select excerpt from public.bookmarks where id = 'bm1'), 'newer', 'a newer change wins');
select is((select version from public.bookmarks where id = 'bm1'), 5::bigint, 'the row carries the version that changed it');
select is(
  (select array_agg(r ->> 'id') from jsonb_to_recordset(public.sync_pull(4) -> 'rows') as x(t text, r jsonb)),
  array['bm1'], 'pull since 4 returns only what changed after it');

-- clocks: a change may not claim to be far in the future
select public.sync_push($$[{"t":"reader_settings","id":"goal-minutes","u":9000000000000000,"r":{"value":20}}]$$::jsonb);
select ok(
  (select updated_at from public.reader_settings where id = 'goal-minutes') <= (extract(epoch from clock_timestamp()) * 1000)::bigint + 300000
  and (select updated_at from public.reader_settings where id = 'goal-minutes') > (extract(epoch from now()) * 1000)::bigint,
  'future timestamps are clamped to five minutes ahead');

-- validation
select throws_ok($$ select public.sync_push('[{"t":"profiles","id":"x","u":1}]'::jsonb) $$, '22023', null, 'unknown tables are refused');
select throws_ok($$ select public.sync_push('[{"t":"bookmarks","id":"x"}]'::jsonb) $$, '22023', null, 'a change needs a timestamp');
select throws_ok($$ select public.sync_push('{"t":"bookmarks"}'::jsonb) $$, '22023', null, 'a push is an array');
select throws_ok(
  $$ select public.sync_push((select jsonb_agg(jsonb_build_object('t','bookmarks','id','b'||g,'u',1)) from generate_series(1,501) g)) $$,
  '22023', null, 'at most 500 changes per push');
select throws_ok(
  format($$ select public.sync_push('[{"t":"annotations","id":"long","u":1,"r":{"note":"%s"}}]'::jsonb) $$, repeat('ক', 10001)),
  '23514', null, 'notes are limited to 10,000 characters');
select throws_ok(
  $$ select public.sync_push('[{"t":"annotations","id":"bad","u":1,"r":{"color":"red"}}]'::jsonb) $$,
  '23514', null, 'highlight colours are checked');

-- ── two devices, one note ────────────────────────────────────────────────
-- device 2 had seen n1 (base 1000) and changes the note: no conflict
select public.sync_push($$[{"t":"annotations","id":"n1","u":2000,"b":1000,"r":{"work_slug":"devdas","quote":"দেবদাস","color":"yellow","style":"highlight","note":"second"}}]$$::jsonb);
select is((select note from public.annotations where id = 'n1'), 'second', 'an edit on top of the latest version just wins');
select is((select count(*)::int from public.annotations where conflict_of = 'n1'), 0, 'no copy without a conflict');

-- device 1 also had base 1000 and wrote a different note, at an older time
select public.sync_push($$[{"t":"annotations","id":"n1","u":1500,"b":1000,"r":{"work_slug":"devdas","quote":"দেবদাস","color":"green","style":"highlight","note":"third"}}]$$::jsonb);
select is((select note from public.annotations where id = 'n1'), 'second', 'the newer note stays on the highlight');
select is((select note from public.annotations where conflict_of = 'n1'), 'third', 'the older conflicting note is kept as a copy');

-- device 1 again from base 1000, now newer than the server
select public.sync_push($$[{"t":"annotations","id":"n1","u":3000,"b":1000,"r":{"work_slug":"devdas","quote":"দেবদাস","color":"blue","style":"highlight","note":"fourth"}}]$$::jsonb);
select is((select note from public.annotations where id = 'n1'), 'fourth', 'a newer conflicting note wins');
select is(
  (select array_agg(note order by note) from public.annotations where conflict_of = 'n1'),
  array['second', 'third'], 'and the note it replaced is kept as a copy');

-- a colour change from a stale device is not a note conflict: plain last-writer-wins
select public.sync_push($$[{"t":"annotations","id":"n1","u":3500,"b":1000,"r":{"work_slug":"devdas","quote":"দেবদাস","color":"pink","style":"highlight","note":"fourth"}}]$$::jsonb);
select is((select count(*)::int from public.annotations where conflict_of = 'n1'), 2, 'same note, no new copy');
select is((select color from public.annotations where id = 'n1'), 'pink', 'the newer colour wins');

-- delete from a device that never saw the latest note: the note survives
create temp table stale_delete as
  select (public.sync_push($$[{"t":"annotations","id":"n1","u":9000,"b":1000,"d":true}]$$::jsonb) ->> 'version')::bigint as v;
select is((select deleted from public.annotations where id = 'n1'), false, 'deleting a highlight whose note changed elsewhere keeps it');
select is(
  (select version from public.annotations where id = 'n1'), (select v from stale_delete),
  'the kept highlight is sent to every device again');

-- delete from a device that had the latest version: gone, text cleared
select public.sync_push($$[{"t":"annotations","id":"n1","u":9100,"b":3500,"d":true}]$$::jsonb);
select is((select deleted from public.annotations where id = 'n1'), true, 'an informed delete applies');
select is((select note is null and quote is null from public.annotations where id = 'n1'), true, 'a tombstone keeps no text');

-- a note written while another device deleted the highlight brings it back
select public.sync_push($$[{"t":"annotations","id":"n2","u":4000,"r":{"work_slug":"devdas","quote":"পারু","color":"yellow","style":"highlight"}}]$$::jsonb);
select public.sync_push($$[{"t":"annotations","id":"n2","u":5000,"b":4000,"d":true}]$$::jsonb);
select public.sync_push($$[{"t":"annotations","id":"n2","u":4500,"b":4000,"r":{"work_slug":"devdas","quote":"পারু","color":"yellow","style":"highlight","note":"keep me"}}]$$::jsonb);
select is(
  (select row(deleted, note, updated_at > 5000)::text from public.annotations where id = 'n2'),
  '(f,"keep me",t)', 'the note wins over a concurrent delete');

-- deleting something the server never had is a no-op
select public.sync_push($$[{"t":"bookmarks","id":"never-synced","u":1,"d":true}]$$::jsonb);
select is((select count(*)::int from public.bookmarks where id = 'never-synced'), 0, 'no tombstone for a row the server never had');

-- ── paging in whole versions ─────────────────────────────────────────────
create temp table cursor_at as
  select (public.sync_push($$[{"t":"reading_days","id":"d:2026-11-01","u":1,"r":{"device_id":"d","day":"2026-11-01","seconds":60}},
                              {"t":"reading_days","id":"d:2026-11-02","u":1,"r":{"device_id":"d","day":"2026-11-02","seconds":60}}]$$::jsonb) ->> 'version')::bigint - 1 as v;
select public.sync_push($$[{"t":"reading_days","id":"d:2026-11-03","u":1,"r":{"device_id":"d","day":"2026-11-03","seconds":60}},
                           {"t":"reading_days","id":"d:2026-11-04","u":1,"r":{"device_id":"d","day":"2026-11-04","seconds":60}}]$$::jsonb);
select is(
  (select jsonb_array_length(public.sync_pull(v, 3) -> 'rows') from cursor_at), 2,
  'a page leaves out a version that would be cut short');
select is((select (public.sync_pull(v, 3) ->> 'more')::boolean from cursor_at), true, 'and says there is more');
select is(
  (select jsonb_array_length(public.sync_pull((public.sync_pull(v, 3) ->> 'version')::bigint, 3) -> 'rows') from cursor_at), 2,
  'the next page continues at the cursor');
select is(
  (select jsonb_array_length(public.sync_pull(v + 1, 1) -> 'rows') from cursor_at), 2,
  'a version bigger than a page is sent whole');

-- ── reader B sees none of it ─────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(jsonb_array_length(public.sync_pull(0) -> 'rows'), 0, 'B pulls nothing of A''s');
select is((select count(*)::int from public.bookmarks), 0, 'B reads none of A''s rows');

-- ── deleting the account removes everything ──────────────────────────────
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.delete_my_account();
reset role;
select is(
  (select count(*)::int from public.bookmarks where user_id = '11111111-1111-1111-1111-111111111111')
  + (select count(*)::int from public.annotations where user_id = '11111111-1111-1111-1111-111111111111')
  + (select count(*)::int from public.sync_state where user_id = '11111111-1111-1111-1111-111111111111'),
  0, 'deleting the account deletes all personal rows');
select is((select count(*)::int from public.bookmarks where id = 'bm-inject'), 0, 'the injected row belonged to A, and went with A');

select * from finish();
rollback;
