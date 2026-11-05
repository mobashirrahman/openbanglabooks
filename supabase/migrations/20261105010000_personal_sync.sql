-- OpenBanglaBooks — personal reading data and sync
--
-- Everything a reader creates (library, shelves, positions, bookmarks,
-- highlights and notes, settings, reading time) is written on the device
-- first (IndexedDB) and synced here. Rows are never written directly by
-- clients: devices call sync_push(changes) and sync_pull(since).
--
-- Every row carries:
--   updated_at  client time of the last change, in ms (last writer wins)
--   deleted     tombstone, so deletions reach the other devices
--   version     the per-user push counter value that last changed the row
--
-- Ordering: each push takes the next per-user version under a row lock on
-- sync_state, so a user's pushes commit in version order. A device that has
-- pulled everything up to version N can never later miss a change ≤ N.

create schema if not exists sync;
revoke all on schema sync from public;

create table public.sync_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- ── Personal tables ───────────────────────────────────────────────────────
-- Content columns are nullable: a tombstone keeps only its identity.

create table public.user_books (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  updated_at bigint not null,
  deleted boolean not null default false,
  version bigint not null,
  synced_at timestamptz not null default now(),
  work_slug text check (length(work_slug) <= 200),
  status text check (status in ('want', 'reading', 'finished', 'dnf')),
  favourite boolean,
  rating smallint check (rating between 1 and 5),
  reflection text check (length(reflection) <= 20000),
  added_at bigint,
  started_at bigint,
  finished_at bigint,
  work jsonb check (pg_column_size(work) <= 4096),
  primary key (user_id, id)
);

create table public.user_shelves (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  updated_at bigint not null,
  deleted boolean not null default false,
  version bigint not null,
  synced_at timestamptz not null default now(),
  name text check (length(btrim(name)) between 1 and 80),
  position int,
  created_at bigint,
  primary key (user_id, id)
);

create table public.shelf_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 420),
  updated_at bigint not null,
  deleted boolean not null default false,
  version bigint not null,
  synced_at timestamptz not null default now(),
  shelf_id text check (length(shelf_id) <= 200),
  work_slug text check (length(work_slug) <= 200),
  added_at bigint,
  work jsonb check (pg_column_size(work) <= 4096),
  primary key (user_id, id)
);

-- one row per device and book: devices never overwrite each other's place
create table public.reading_positions (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 300),
  updated_at bigint not null,
  deleted boolean not null default false,
  version bigint not null,
  synced_at timestamptz not null default now(),
  device_id text check (length(device_id) <= 64),
  device_label text check (length(device_label) <= 100),
  work_slug text check (length(work_slug) <= 200),
  file_sha text check (file_sha ~ '^[0-9a-f]{64}$'),
  cfi text check (length(cfi) <= 2000),
  fraction real check (fraction between 0 and 1),
  chapter text check (length(chapter) <= 500),
  finished boolean,
  opened_at bigint,
  work jsonb check (pg_column_size(work) <= 4096),
  primary key (user_id, id)
);

create table public.bookmarks (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  updated_at bigint not null,
  deleted boolean not null default false,
  version bigint not null,
  synced_at timestamptz not null default now(),
  work_slug text check (length(work_slug) <= 200),
  file_sha text check (file_sha ~ '^[0-9a-f]{64}$'),
  cfi text check (length(cfi) <= 2000),
  fraction real check (fraction between 0 and 1),
  chapter text check (length(chapter) <= 500),
  excerpt text check (length(excerpt) <= 1000),
  created_at bigint,
  work jsonb check (pg_column_size(work) <= 4096),
  primary key (user_id, id)
);

create table public.annotations (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  updated_at bigint not null,
  deleted boolean not null default false,
  version bigint not null,
  synced_at timestamptz not null default now(),
  work_slug text check (length(work_slug) <= 200),
  -- the anchor: a range CFI valid for this exact file, plus the quoted text
  -- with context, for re-anchoring when the book's file changes
  file_sha text check (file_sha ~ '^[0-9a-f]{64}$'),
  cfi text check (length(cfi) <= 2000),
  quote text check (length(quote) <= 5000),
  prefix text check (length(prefix) <= 200),
  suffix text check (length(suffix) <= 200),
  color text check (color in ('yellow', 'green', 'blue', 'pink', 'purple')),
  style text check (style in ('highlight', 'underline')),
  note text check (length(note) <= 10000),
  chapter text check (length(chapter) <= 500),
  fraction real check (fraction between 0 and 1),
  created_at bigint,
  -- the passage could not be found in a newer file of the book
  orphaned boolean,
  -- set on a copy kept when two devices changed the same note
  conflict_of text check (length(conflict_of) <= 200),
  work jsonb check (pg_column_size(work) <= 4096),
  primary key (user_id, id)
);

create table public.reader_settings (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 100),
  updated_at bigint not null,
  deleted boolean not null default false,
  version bigint not null,
  synced_at timestamptz not null default now(),
  value jsonb check (pg_column_size(value) <= 8192),
  primary key (user_id, id)
);

-- reading time per device and day; a day's total is the sum over devices
create table public.reading_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 100),
  updated_at bigint not null,
  deleted boolean not null default false,
  version bigint not null,
  synced_at timestamptz not null default now(),
  device_id text check (length(device_id) <= 64),
  day date,
  seconds int check (seconds between 0 and 86400),
  primary key (user_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['user_books','user_shelves','shelf_items','reading_positions','bookmarks','annotations','reader_settings','reading_days']
  loop
    execute format('create index %1$s_version on public.%1$I (user_id, version)', t);
    execute format('alter table public.%I enable row level security', t);
    -- readers may read their own rows; every write goes through sync_push
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy "own rows are readable" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
  end loop;
end $$;

alter table public.sync_state enable row level security;
revoke all on public.sync_state from anon, authenticated;

-- ── Push ──────────────────────────────────────────────────────────────────
-- A change is {t: table, id, u: updated_at ms, d: deleted, b: base, r: row}.
-- `b` is the updated_at of the server version the device last saw for this
-- row (absent for rows it created): it tells "changed elsewhere since" apart
-- from "older". `r` holds the row's columns by name.

-- Clients' clocks drift: a change may not claim to be more than five minutes
-- in the future, or one fast clock would win every conflict for good.
create or replace function sync.clamp(u bigint)
returns bigint
language sql
volatile
set search_path = ''
as $$
  select least(u, (extract(epoch from clock_timestamp()) * 1000)::bigint + 300000)
$$;

-- Last writer wins: insert, or overwrite an older row (a tie changes nothing).
create or replace function sync.upsert(tbl text, uid uuid, v bigint, item jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  cols text;
  sets text;
  rec jsonb;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum),
         string_agg(format('%1$I = excluded.%1$I', attname), ', ' order by attnum)
           filter (where attname not in ('user_id', 'id'))
    into cols, sets
    from pg_attribute
   where attrelid = format('public.%I', tbl)::regclass and attnum > 0 and not attisdropped and attname <> 'synced_at';
  -- identity and bookkeeping come from the server, never from the client's row
  rec := coalesce(item -> 'r', '{}'::jsonb) || jsonb_build_object(
    'user_id', uid, 'id', item ->> 'id', 'updated_at', sync.clamp((item ->> 'u')::bigint), 'deleted', false, 'version', v);
  execute format(
    'insert into public.%1$I as x (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1)
     on conflict (user_id, id) do update set %3$s, synced_at = now() where x.updated_at < excluded.updated_at',
    tbl, cols, sets)
  using rec;
end;
$$;

-- A deletion: applies if it is newer, or if the device had seen the latest
-- version when it deleted. Text a reader wrote is cleared from tombstones.
create or replace function sync.tombstone(tbl text, uid uuid, v bigint, item jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  u bigint := sync.clamp((item ->> 'u')::bigint);
  base bigint := coalesce((item ->> 'b')::bigint, 0);
  clear text := case tbl
    when 'annotations' then ', quote = null, prefix = null, suffix = null, note = null, chapter = null'
    when 'bookmarks' then ', excerpt = null, chapter = null'
    when 'user_books' then ', reflection = null, rating = null'
    when 'reader_settings' then ', value = null'
    else '' end;
begin
  execute format(
    'update public.%1$I set deleted = true, updated_at = greatest(updated_at, $3), version = $4, synced_at = now()%2$s
      where user_id = $1 and id = $2 and not deleted and (updated_at < $3 or updated_at <= $5)',
    tbl, clear)
  using uid, item ->> 'id', u, v, base;
end;
$$;

-- Highlights and notes: like everything else, except a note is never lost.
-- * two devices changed the same note → the newer wins, the other is kept
--   as a copy (conflict_of = the original's id)
-- * a note changed on one device while another deleted the highlight →
--   the note survives
create or replace function sync.push_annotation(uid uuid, v bigint, item jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  u bigint := sync.clamp((item ->> 'u')::bigint);
  base bigint := coalesce((item ->> 'b')::bigint, 0);
  note text := nullif(btrim(item -> 'r' ->> 'note'), '');
  ex public.annotations;
begin
  select * into ex from public.annotations where user_id = uid and id = item ->> 'id' for update;

  if coalesce((item ->> 'd')::boolean, false) then
    if not found or ex.deleted then
      return; -- never synced, or already gone
    end if;
    if ex.updated_at > base and nullif(btrim(ex.note), '') is not null then
      -- its note changed elsewhere after this device last saw it: keep the
      -- highlight, and send it to every device again (the deleting one too)
      update public.annotations set version = v, synced_at = now() where user_id = uid and id = ex.id;
      return;
    end if;
    perform sync.tombstone('annotations', uid, v, item);
    return;
  end if;

  if not found then
    perform sync.upsert('annotations', uid, v, item);
  elsif ex.deleted then
    if note is not null and ex.updated_at > base then
      -- deleted elsewhere while this device was writing the note: bring it back
      perform sync.upsert('annotations', uid, v, item || jsonb_build_object('u', greatest(u, ex.updated_at + 1)));
    else
      perform sync.upsert('annotations', uid, v, item);
    end if;
  elsif ex.updated_at > base and note is not null and nullif(btrim(ex.note), '') is not null
        and ex.note is distinct from (item -> 'r' ->> 'note') then
    if u > ex.updated_at then
      -- this edit wins; the note it replaces is kept as a copy
      perform sync.upsert('annotations', uid, v, jsonb_build_object(
        'id', gen_random_uuid()::text, 'u', ex.updated_at,
        'r', to_jsonb(ex) || jsonb_build_object('conflict_of', ex.id)));
      perform sync.upsert('annotations', uid, v, item);
    else
      -- the other edit is newer; this one is kept as a copy
      perform sync.upsert('annotations', uid, v, jsonb_build_object(
        'id', gen_random_uuid()::text, 'u', u,
        'r', (item -> 'r') || jsonb_build_object('conflict_of', ex.id)));
    end if;
  else
    perform sync.upsert('annotations', uid, v, item);
  end if;
end;
$$;

create or replace function public.sync_push(changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v bigint;
  item jsonb;
  tbl text;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if jsonb_typeof(changes) is distinct from 'array' or jsonb_array_length(changes) > 500 then
    raise exception 'a push is an array of at most 500 changes' using errcode = '22023';
  end if;

  -- the per-user counter; its row lock orders this user's pushes
  insert into public.sync_state as s (user_id, version) values (uid, 1)
  on conflict (user_id) do update set version = s.version + 1, updated_at = now()
  returning version into v;

  for item in select value from jsonb_array_elements(changes) loop
    tbl := item ->> 't';
    if tbl is null or item ->> 'id' is null or jsonb_typeof(item -> 'u') is distinct from 'number' then
      raise exception 'malformed change' using errcode = '22023';
    end if;
    if tbl = 'annotations' then
      perform sync.push_annotation(uid, v, item);
    elsif tbl in ('user_books', 'user_shelves', 'shelf_items', 'reading_positions', 'bookmarks', 'reader_settings', 'reading_days') then
      if coalesce((item ->> 'd')::boolean, false) then
        perform sync.tombstone(tbl, uid, v, item);
      else
        perform sync.upsert(tbl, uid, v, item);
      end if;
    else
      raise exception 'unknown table %', tbl using errcode = '22023';
    end if;
  end loop;

  return jsonb_build_object('version', v);
end;
$$;

-- ── Pull ──────────────────────────────────────────────────────────────────

create or replace function sync.changes(uid uuid, since bigint)
returns table (t text, version bigint, r jsonb)
language sql
stable
set search_path = ''
as $$
  select 'user_books', x.version, to_jsonb(x) - 'user_id' - 'synced_at' from public.user_books x where x.user_id = uid and x.version > since
  union all
  select 'user_shelves', x.version, to_jsonb(x) - 'user_id' - 'synced_at' from public.user_shelves x where x.user_id = uid and x.version > since
  union all
  select 'shelf_items', x.version, to_jsonb(x) - 'user_id' - 'synced_at' from public.shelf_items x where x.user_id = uid and x.version > since
  union all
  select 'reading_positions', x.version, to_jsonb(x) - 'user_id' - 'synced_at' from public.reading_positions x where x.user_id = uid and x.version > since
  union all
  select 'bookmarks', x.version, to_jsonb(x) - 'user_id' - 'synced_at' from public.bookmarks x where x.user_id = uid and x.version > since
  union all
  select 'annotations', x.version, to_jsonb(x) - 'user_id' - 'synced_at' from public.annotations x where x.user_id = uid and x.version > since
  union all
  select 'reader_settings', x.version, to_jsonb(x) - 'user_id' - 'synced_at' from public.reader_settings x where x.user_id = uid and x.version > since
  union all
  select 'reading_days', x.version, to_jsonb(x) - 'user_id' - 'synced_at' from public.reading_days x where x.user_id = uid and x.version > since
$$;

-- Changes after `since`, oldest first, in whole versions: a page never ends
-- halfway through a push, so `version` is always a safe cursor.
create or replace function public.sync_pull(since bigint default 0, max_rows int default 2000)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  total int;
  lo bigint;
  hi bigint;
  cut bigint;
  rows jsonb;
  top bigint;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  max_rows := least(greatest(coalesce(max_rows, 2000), 1), 5000);

  select count(*), min(p.version), max(p.version) into total, lo, hi
    from (select c.version from sync.changes(uid, coalesce(since, 0)) c order by c.version limit max_rows + 1) p;

  if total > max_rows then
    -- leave out the last version, which may be cut short; unless the page is
    -- all one version, which is then sent whole
    cut := case when lo = hi then hi + 1 else hi end;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('t', c.t, 'r', c.r) order by c.version), '[]'::jsonb), max(c.version)
    into rows, top
    from sync.changes(uid, coalesce(since, 0)) c
   where cut is null or c.version < cut;

  return jsonb_build_object('rows', rows, 'version', coalesce(top, since, 0), 'more', total > max_rows);
end;
$$;

revoke execute on all functions in schema sync from public, anon, authenticated;
revoke execute on function public.sync_push(jsonb) from public, anon;
revoke execute on function public.sync_pull(bigint, int) from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;
grant execute on function public.sync_pull(bigint, int) to authenticated;
