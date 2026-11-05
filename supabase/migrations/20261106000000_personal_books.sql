-- OpenBanglaBooks — the reader's own books (personal EPUB import)
--
-- A reader can add their own EPUB files. A file is checked and cleaned in
-- the browser and stays on that device: nothing about it (file, title,
-- highlights) leaves the device. Only if the reader chooses "keep in my
-- account" is the file uploaded to a private, per-reader bucket, and the
-- book's record (personal_books) and its reading data sync like the rest.

-- Personal books are "mine-<hash>"; catalogue slugs can never look like one.
alter table public.works add constraint works_slug_not_personal check (slug !~ '^mine-');

create table public.personal_books (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null check (id ~ '^mine-[0-9a-f]{24}$'),
  updated_at bigint not null,
  deleted boolean not null default false,
  version bigint not null,
  synced_at timestamptz not null default now(),
  file_sha text check (file_sha ~ '^[0-9a-f]{64}$'),
  title text check (length(title) <= 500),
  author text check (length(author) <= 500),
  language text check (length(language) <= 35),
  bytes bigint check (bytes between 0 and 52428800),
  added_at bigint,
  uploaded_at bigint,
  primary key (user_id, id)
);

create index personal_books_version on public.personal_books (user_id, version);
alter table public.personal_books enable row level security;
revoke all on public.personal_books from anon, authenticated;
grant select on public.personal_books to authenticated;
create policy "own rows are readable" on public.personal_books for select to authenticated using (user_id = (select auth.uid()));

-- ── Sync: personal_books joins the pushed and pulled tables ───────────────

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
    elsif tbl in ('user_books', 'user_shelves', 'shelf_items', 'reading_positions', 'bookmarks', 'reader_settings', 'reading_days', 'personal_books') then
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
  union all
  select 'personal_books', x.version, to_jsonb(x) - 'user_id' - 'synced_at' from public.personal_books x where x.user_id = uid and x.version > since
$$;

-- ── Storage: one private folder per reader ────────────────────────────────
-- <user id>/<sha256>.epub. Only the reader can read, add or remove their
-- files; files are never replaced (the name is the content hash). Limits:
-- 50 MB a file, 200 files and 1 GB in all per reader.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('personal-books', 'personal-books', false, 52428800, array['application/epub+zip'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.personal_books_room()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) < 200 and coalesce(sum((o.metadata ->> 'size')::bigint), 0) < 1073741824
    from storage.objects o
   where o.bucket_id = 'personal-books' and (storage.foldername(o.name))[1] = (select auth.uid())::text
$$;
revoke execute on function public.personal_books_room() from public, anon;
grant execute on function public.personal_books_room() to authenticated;

create policy "readers add their own books" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'personal-books'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f]{64}\.epub$'
    and (select public.personal_books_room())
  );
create policy "readers read their own books" on storage.objects for select to authenticated
  using (bucket_id = 'personal-books' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "readers remove their own books" on storage.objects for delete to authenticated
  using (bucket_id = 'personal-books' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ── Deleting an account: files first ──────────────────────────────────────
-- Stored files can only be removed through the Storage API (a database
-- delete would orphan the bytes), so the app removes them before deleting
-- the account, and the account is not deleted while any remain.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if exists (select 1 from storage.objects o where o.bucket_id = 'personal-books' and (storage.foldername(o.name))[1] = uid::text) then
    raise exception 'personal book files remain' using errcode = '55000', hint = 'remove them through the Storage API first';
  end if;
  delete from auth.users where id = uid;
end;
$$;
