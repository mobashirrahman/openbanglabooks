-- OpenBanglaBooks — public catalog
-- Works (the literary work) are separated from editions (a specific text/source)
-- and book_files (an EPUB built from an edition). Everything public is read-only
-- to clients and only visible once published; writes go through editors.

create extension if not exists pg_trgm with schema extensions;

-- ── Helpers ────────────────────────────────────────────────────────────────

-- Normalises Bengali/Latin text for search: NFC, strip ZWJ/ZWNJ/ZWSP and
-- hasanta-joiner variants, lower-case Latin, collapse whitespace and
-- punctuation. Kept in sync with src/lib/bn/normalize.ts.
create or replace function public.normalize_search(input text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select trim(regexp_replace(
    regexp_replace(
      lower(normalize(coalesce(input, ''), NFC)),
      '[​‌‍﻿]', '', 'g'),
    '[[:space:][:punct:]।॥‘’“”—–-]+', ' ', 'g'))
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── Profiles & roles ───────────────────────────────────────────────────────

create type public.user_role as enum ('reader', 'editor', 'admin');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  role public.user_role not null default 'reader',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_editor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role in ('editor', 'admin')
  )
$$;

-- ── Catalog ────────────────────────────────────────────────────────────────

create type public.publication_status as enum ('draft', 'published', 'withdrawn');
create type public.literary_form as enum ('novel', 'short-stories', 'poetry', 'essays', 'drama');

create table public.authors (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name_bn text not null,
  name_en text not null,
  born_year int,
  died_year int,
  bio_bn text,
  bio_en text,
  wikidata_id text,
  wikisource_url text,
  status public.publication_status not null default 'draft',
  search_text text generated always as (
    public.normalize_search(name_bn || ' ' || name_en)
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.works (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title_bn text not null,
  title_en text not null,
  -- romanised title for Latin-script search ("pather panchali")
  title_latn text not null,
  subtitle_bn text,
  original_pub_year int,
  form public.literary_form not null,
  literary_period text,
  description_bn text,
  description_en text,
  status public.publication_status not null default 'draft',
  -- why this work may be published (author death year, first publication…)
  rights_basis text,
  rights_verified_by text,
  rights_verified_at timestamptz,
  featured_rank int,
  cover_variant int not null default 0,
  search_text text generated always as (
    public.normalize_search(title_bn || ' ' || title_en || ' ' || title_latn)
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint published_requires_rights check (
    status <> 'published' or (rights_basis is not null and rights_verified_at is not null)
  )
);

create type public.contributor_role as enum ('author', 'translator', 'editor', 'illustrator');

create table public.work_authors (
  work_id uuid not null references public.works (id) on delete cascade,
  author_id uuid not null references public.authors (id) on delete restrict,
  role public.contributor_role not null default 'author',
  position int not null default 0,
  primary key (work_id, author_id, role)
);

create table public.editions (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.works (id) on delete cascade,
  label_bn text,
  label_en text,
  publisher text,
  pub_year int,
  source_name text not null,
  source_url text not null,
  -- page title → revision id, so the exact transcribed text is traceable
  source_revisions jsonb not null default '{}'::jsonb,
  license text not null,
  license_url text,
  attribution text,
  toc jsonb not null default '[]'::jsonb,
  excerpt_bn text,
  chapter_count int,
  is_primary boolean not null default true,
  status public.publication_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index editions_one_primary on public.editions (work_id) where is_primary;

create table public.book_files (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions (id) on delete cascade,
  format text not null default 'epub' check (format in ('epub')),
  storage_path text not null,
  sha256 text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes int not null check (bytes > 0),
  epub_version text,
  validation_report jsonb not null default '{}'::jsonb,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index book_files_one_current on public.book_files (edition_id) where is_current;

create table public.genres (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_bn text not null,
  name_en text not null,
  description_bn text,
  description_en text,
  position int not null default 0
);

create table public.work_genres (
  work_id uuid not null references public.works (id) on delete cascade,
  genre_id uuid not null references public.genres (id) on delete cascade,
  primary key (work_id, genre_id)
);

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_bn text not null,
  name_en text not null,
  description_bn text,
  description_en text,
  position int not null default 0,
  status public.publication_status not null default 'published'
);

create table public.collection_items (
  collection_id uuid not null references public.collections (id) on delete cascade,
  work_id uuid not null references public.works (id) on delete cascade,
  position int not null default 0,
  primary key (collection_id, work_id)
);

-- ── Indexes ────────────────────────────────────────────────────────────────

create index works_search_trgm on public.works using gin (search_text extensions.gin_trgm_ops);
create index authors_search_trgm on public.authors using gin (search_text extensions.gin_trgm_ops);
create index works_status_idx on public.works (status, created_at desc);
create index work_authors_author_idx on public.work_authors (author_id);
create index work_genres_genre_idx on public.work_genres (genre_id);
create index editions_work_idx on public.editions (work_id);
create index collection_items_work_idx on public.collection_items (work_id);

-- ── Triggers ───────────────────────────────────────────────────────────────

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger authors_touch before update on public.authors
  for each row execute function public.touch_updated_at();
create trigger works_touch before update on public.works
  for each row execute function public.touch_updated_at();
create trigger editions_touch before update on public.editions
  for each row execute function public.touch_updated_at();

-- new auth users get a reader profile
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Row level security ────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.authors enable row level security;
alter table public.works enable row level security;
alter table public.work_authors enable row level security;
alter table public.editions enable row level security;
alter table public.book_files enable row level security;
alter table public.genres enable row level security;
alter table public.work_genres enable row level security;
alter table public.collections enable row level security;
alter table public.collection_items enable row level security;

create policy "own profile is readable" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "own display name is editable" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- readers may change their display name, never their role
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

create policy "published authors are public" on public.authors
  for select to anon, authenticated using (status = 'published' or (select public.is_editor()));
create policy "published works are public" on public.works
  for select to anon, authenticated using (status = 'published' or (select public.is_editor()));
create policy "credits of published works are public" on public.work_authors
  for select to anon, authenticated using (
    exists (select 1 from public.works w where w.id = work_id and w.status = 'published')
    or (select public.is_editor()));
create policy "published editions are public" on public.editions
  for select to anon, authenticated using (
    (status = 'published' and exists (select 1 from public.works w where w.id = work_id and w.status = 'published'))
    or (select public.is_editor()));
create policy "files of published editions are public" on public.book_files
  for select to anon, authenticated using (
    exists (
      select 1 from public.editions e join public.works w on w.id = e.work_id
      where e.id = edition_id and e.status = 'published' and w.status = 'published')
    or (select public.is_editor()));
create policy "genres are public" on public.genres
  for select to anon, authenticated using (true);
create policy "genre links of published works are public" on public.work_genres
  for select to anon, authenticated using (
    exists (select 1 from public.works w where w.id = work_id and w.status = 'published')
    or (select public.is_editor()));
create policy "published collections are public" on public.collections
  for select to anon, authenticated using (status = 'published' or (select public.is_editor()));
create policy "collection items of published works are public" on public.collection_items
  for select to anon, authenticated using (
    exists (select 1 from public.works w where w.id = work_id and w.status = 'published')
    or (select public.is_editor()));

-- editors manage the catalog
do $$
declare t text;
begin
  foreach t in array array['authors','works','work_authors','editions','book_files','genres','work_genres','collections','collection_items']
  loop
    execute format('create policy "editors insert %1$s" on public.%1$I for insert to authenticated with check ((select public.is_editor()))', t);
    execute format('create policy "editors update %1$s" on public.%1$I for update to authenticated using ((select public.is_editor())) with check ((select public.is_editor()))', t);
    execute format('create policy "editors delete %1$s" on public.%1$I for delete to authenticated using ((select public.is_editor()))', t);
  end loop;
end $$;

-- ── Search ─────────────────────────────────────────────────────────────────

create or replace function public.search_catalog(q text, max_results int default 12)
returns table (
  kind text,
  slug text,
  title_bn text,
  title_en text,
  subtitle text,
  score real
)
language sql
stable
set search_path = public, extensions
as $$
  with nq as (select public.normalize_search(q) as v)
  select * from (
    select 'work'::text, w.slug, w.title_bn, w.title_en,
      (select string_agg(a.name_bn, ', ' order by wa.position)
         from public.work_authors wa join public.authors a on a.id = wa.author_id
        where wa.work_id = w.id and wa.role = 'author'),
      greatest(
        similarity(w.search_text, nq.v),
        word_similarity(nq.v, w.search_text),
        case when w.search_text like nq.v || '%' then 1 else 0 end
      )::real
    from public.works w, nq
    where w.status = 'published' and length(nq.v) > 0
      and (w.search_text % nq.v or nq.v <% w.search_text or w.search_text like '%' || nq.v || '%')
    union all
    select 'author', a.slug, a.name_bn, a.name_en,
      concat_ws('–', a.born_year::text, a.died_year::text),
      greatest(
        similarity(a.search_text, nq.v),
        word_similarity(nq.v, a.search_text),
        case when a.search_text like nq.v || '%' then 1 else 0 end
      )::real
    from public.authors a, nq
    where a.status = 'published' and length(nq.v) > 0
      and (a.search_text % nq.v or nq.v <% a.search_text or a.search_text like '%' || nq.v || '%')
  ) r(kind, slug, title_bn, title_en, subtitle, score)
  order by score desc, title_bn
  limit max_results
$$;

grant execute on function public.search_catalog(text, int) to anon, authenticated;
grant execute on function public.normalize_search(text) to anon, authenticated;

-- ── Storage ────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('books', 'books', true, 52428800, array['application/epub+zip']),
  ('covers', 'covers', true, 5242880, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

create policy "editors upload catalog files" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('books', 'covers') and (select public.is_editor()));
create policy "editors replace catalog files" on storage.objects
  for update to authenticated
  using (bucket_id in ('books', 'covers') and (select public.is_editor()));
create policy "editors delete catalog files" on storage.objects
  for delete to authenticated
  using (bucket_id in ('books', 'covers') and (select public.is_editor()));
