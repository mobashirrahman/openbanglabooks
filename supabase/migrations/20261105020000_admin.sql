-- Admin: catalog edits that touch several tables at once, as single
-- transactions. Security invoker: row level security applies exactly as for
-- direct writes (only editors may change the catalog); the explicit role
-- check gives a clear error instead of a silent zero-row write.

create or replace function public.require_editor()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not (select public.is_editor()) then
    raise exception 'editors only' using errcode = '42501';
  end if;
end;
$$;

-- A work with its credits, genres and collections.
-- p: { id?, slug, title_bn, title_en, title_latn, subtitle_bn, original_pub_year,
--      form, literary_period, description_bn, description_en, status,
--      rights_basis, rights_verified (bool), featured_rank, cover_variant,
--      authors: [{ id, role }], genres: [uuid], collections: [uuid] }
create or replace function public.admin_save_work(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  wid uuid := nullif(p ->> 'id', '')::uuid;
  verified boolean := coalesce((p ->> 'rights_verified')::boolean, false);
  who text := coalesce(auth.jwt() ->> 'email', auth.uid()::text);
  a jsonb;
  i int := 0;
begin
  perform public.require_editor();
  if jsonb_typeof(p -> 'authors') is distinct from 'array' or jsonb_array_length(p -> 'authors') = 0 then
    raise exception 'a work needs at least one author' using errcode = '22023';
  end if;

  if wid is null then
    insert into public.works (slug, title_bn, title_en, title_latn, subtitle_bn, original_pub_year, form,
      literary_period, description_bn, description_en, status, rights_basis, rights_verified_by,
      rights_verified_at, featured_rank, cover_variant)
    values (p ->> 'slug', p ->> 'title_bn', p ->> 'title_en', p ->> 'title_latn', nullif(p ->> 'subtitle_bn', ''),
      (p ->> 'original_pub_year')::int, (p ->> 'form')::public.literary_form, nullif(p ->> 'literary_period', ''),
      nullif(p ->> 'description_bn', ''), nullif(p ->> 'description_en', ''),
      (p ->> 'status')::public.publication_status, nullif(p ->> 'rights_basis', ''),
      case when verified then who end, case when verified then now() end,
      (p ->> 'featured_rank')::int, coalesce((p ->> 'cover_variant')::int, 0))
    returning id into wid;
  else
    update public.works w set
      slug = p ->> 'slug',
      title_bn = p ->> 'title_bn',
      title_en = p ->> 'title_en',
      title_latn = p ->> 'title_latn',
      subtitle_bn = nullif(p ->> 'subtitle_bn', ''),
      original_pub_year = (p ->> 'original_pub_year')::int,
      form = (p ->> 'form')::public.literary_form,
      literary_period = nullif(p ->> 'literary_period', ''),
      description_bn = nullif(p ->> 'description_bn', ''),
      description_en = nullif(p ->> 'description_en', ''),
      status = (p ->> 'status')::public.publication_status,
      -- a change of the rights basis needs a new verification
      rights_basis = nullif(p ->> 'rights_basis', ''),
      rights_verified_by = case
        when verified then who
        when w.rights_basis is distinct from nullif(p ->> 'rights_basis', '') then null
        else w.rights_verified_by end,
      rights_verified_at = case
        when verified then now()
        when w.rights_basis is distinct from nullif(p ->> 'rights_basis', '') then null
        else w.rights_verified_at end,
      featured_rank = (p ->> 'featured_rank')::int,
      cover_variant = coalesce((p ->> 'cover_variant')::int, 0)
    where w.id = wid;
    if not found then
      raise exception 'no such work' using errcode = 'P0002';
    end if;
  end if;

  delete from public.work_authors where work_id = wid;
  for a in select * from jsonb_array_elements(p -> 'authors') loop
    insert into public.work_authors (work_id, author_id, role, position)
    values (wid, (a ->> 'id')::uuid, coalesce(a ->> 'role', 'author')::public.contributor_role, i);
    i := i + 1;
  end loop;

  delete from public.work_genres where work_id = wid;
  insert into public.work_genres (work_id, genre_id)
  select wid, g::uuid from jsonb_array_elements_text(coalesce(p -> 'genres', '[]')) g;

  -- keep the position of collections the work stays in; new ones go last
  delete from public.collection_items ci
  where ci.work_id = wid
    and ci.collection_id::text not in (select jsonb_array_elements_text(coalesce(p -> 'collections', '[]')));
  insert into public.collection_items (collection_id, work_id, position)
  select c::uuid, wid,
    coalesce((select max(position) + 10 from public.collection_items x where x.collection_id = c::uuid), 0)
  from jsonb_array_elements_text(coalesce(p -> 'collections', '[]')) c
  on conflict (collection_id, work_id) do nothing;

  return wid;
end;
$$;

-- An edition of a work. Making it primary demotes the work's other editions.
create or replace function public.admin_save_edition(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  eid uuid := nullif(p ->> 'id', '')::uuid;
  wid uuid := (p ->> 'work_id')::uuid;
  primary_ boolean := coalesce((p ->> 'is_primary')::boolean, false);
begin
  perform public.require_editor();
  if eid is not null then
    select work_id into wid from public.editions where id = eid;
    if wid is null then
      raise exception 'no such edition' using errcode = 'P0002';
    end if;
  end if;
  if primary_ then
    update public.editions set is_primary = false where work_id = wid and is_primary and id is distinct from eid;
  end if;
  if eid is null then
    insert into public.editions (work_id, label_bn, label_en, publisher, pub_year, source_name, source_url,
      license, license_url, attribution, is_primary, status)
    values (wid, nullif(p ->> 'label_bn', ''), nullif(p ->> 'label_en', ''), nullif(p ->> 'publisher', ''),
      (p ->> 'pub_year')::int, p ->> 'source_name', p ->> 'source_url', p ->> 'license',
      nullif(p ->> 'license_url', ''), nullif(p ->> 'attribution', ''), primary_,
      (p ->> 'status')::public.publication_status)
    returning id into eid;
  else
    update public.editions set
      label_bn = nullif(p ->> 'label_bn', ''),
      label_en = nullif(p ->> 'label_en', ''),
      publisher = nullif(p ->> 'publisher', ''),
      pub_year = (p ->> 'pub_year')::int,
      source_name = p ->> 'source_name',
      source_url = p ->> 'source_url',
      license = p ->> 'license',
      license_url = nullif(p ->> 'license_url', ''),
      attribution = nullif(p ->> 'attribution', ''),
      is_primary = primary_,
      status = (p ->> 'status')::public.publication_status
    where id = eid;
  end if;
  return eid;
end;
$$;

-- A validated EPUB (already in storage at books/<sha>.epub) becomes the
-- edition's current file; its table of contents replaces the edition's.
create or replace function public.admin_add_book_file(
  p_edition uuid, p_sha text, p_bytes int, p_version text, p_report jsonb, p_toc jsonb, p_chapters int)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  fid uuid;
  owner_ uuid;
begin
  perform public.require_editor();
  if not exists (select 1 from public.editions where id = p_edition) then
    raise exception 'no such edition' using errcode = 'P0002';
  end if;
  select f.edition_id, f.id into owner_, fid from public.book_files f where f.sha256 = p_sha;
  if owner_ is not null and owner_ <> p_edition then
    raise exception 'this file already belongs to another edition' using errcode = '23505';
  end if;
  update public.book_files f set is_current = false
  where f.edition_id = p_edition and f.is_current and f.sha256 <> p_sha;
  if fid is null then
    insert into public.book_files (edition_id, storage_path, sha256, bytes, epub_version, validation_report, is_current)
    values (p_edition, p_sha || '.epub', p_sha, p_bytes, p_version, coalesce(p_report, '{}'), true)
    returning id into fid;
  else
    update public.book_files f set is_current = true where f.id = fid;
  end if;
  update public.editions e set toc = coalesce(p_toc, '[]'), chapter_count = p_chapters where e.id = p_edition;
  return fid;
end;
$$;

-- Goes back to an earlier file of an edition.
create or replace function public.admin_make_file_current(file uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ed uuid;
begin
  perform public.require_editor();
  select edition_id into ed from public.book_files where id = file;
  if ed is null then
    raise exception 'no such file' using errcode = 'P0002';
  end if;
  update public.book_files set is_current = false where edition_id = ed and is_current and id <> file;
  update public.book_files set is_current = true where id = file;
end;
$$;

-- Uploading with upsert reads the object row back: editors may read the
-- catalogue buckets through the API too (the public reads files by URL).
create policy "editors read catalog files" on storage.objects
  for select to authenticated
  using (bucket_id in ('books', 'covers') and (select public.is_editor()));

revoke all on function public.require_editor() from public, anon;
revoke all on function public.admin_save_work(jsonb) from public, anon;
revoke all on function public.admin_save_edition(jsonb) from public, anon;
revoke all on function public.admin_add_book_file(uuid, text, int, text, jsonb, jsonb, int) from public, anon;
revoke all on function public.admin_make_file_current(uuid) from public, anon;
grant execute on function public.require_editor() to authenticated;
grant execute on function public.admin_save_work(jsonb) to authenticated;
grant execute on function public.admin_save_edition(jsonb) to authenticated;
grant execute on function public.admin_add_book_file(uuid, text, int, text, jsonb, jsonb, int) to authenticated;
grant execute on function public.admin_make_file_current(uuid) to authenticated;
