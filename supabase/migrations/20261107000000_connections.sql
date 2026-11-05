-- Connections to other services (Hardcover, Readwise), made by the reader.
--
-- The secret (an OAuth token pair or an access token) is encrypted by the
-- web server (AES-256-GCM, a key only the server holds, bound to the user
-- and provider) before it gets here: the database never sees a token.
-- No client role can read or write the table; the functions below are the
-- only way in, and each acts on the caller's own rows. A reader's browser
-- could call them too, and would get back ciphertext it cannot open.

create table public.connections (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('hardcover', 'readwise')),
  -- "v1." + base64url(iv | ciphertext | tag)
  secret text not null constraint connections_secret_sealed check (secret ~ '^v1\.[A-Za-z0-9_-]+$' and char_length(secret) between 23 and 8000),
  account_label text check (char_length(account_label) <= 200),
  -- when the access token stops working (Hardcover); null if it does not expire
  expires_at timestamptz,
  -- a token refresh in progress: refresh tokens rotate, and one used twice
  -- revokes the whole chain, so only one request may refresh at a time
  leased_until timestamptz,
  version bigint not null default 1,
  connected_at timestamptz not null default now(),
  last_used_at timestamptz,
  primary key (user_id, provider)
);

alter table public.connections enable row level security;
-- no policies, and no grants: only the definer functions touch it
revoke all on public.connections from anon, authenticated;

create or replace function public.connection_uid()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  return uid;
end;
$$;

-- What the reader is connected to: never the secret.
create or replace function public.connection_list()
returns table (provider text, account_label text, connected_at timestamptz, last_used_at timestamptz, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.provider, c.account_label, c.connected_at, c.last_used_at, c.expires_at
  from public.connections c
  where c.user_id = public.connection_uid()
  order by c.provider;
$$;

create or replace function public.connection_save(p_provider text, p_secret text, p_label text, p_expires_at timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.connections as c (user_id, provider, secret, account_label, expires_at)
  values (public.connection_uid(), p_provider, p_secret, p_label, p_expires_at)
  on conflict (user_id, provider) do update
    set secret = excluded.secret, account_label = excluded.account_label, expires_at = excluded.expires_at,
        leased_until = null, version = c.version + 1, connected_at = now();
$$;

create or replace function public.connection_secret(p_provider text)
returns table (secret text, version bigint, expires_at timestamptz, leased boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select c.secret, c.version, c.expires_at, coalesce(c.leased_until > now(), false)
  from public.connections c
  where c.user_id = public.connection_uid() and c.provider = p_provider;
$$;

-- Takes the refresh lease, if no one holds it. Returns the row it leased, or nothing.
create or replace function public.connection_lease(p_provider text, p_seconds integer default 30)
returns table (secret text, version bigint)
language sql
security definer
set search_path = ''
as $$
  update public.connections c
  set leased_until = now() + make_interval(secs => least(greatest(p_seconds, 1), 120))
  where c.user_id = public.connection_uid() and c.provider = p_provider
    and (c.leased_until is null or c.leased_until <= now())
  returning c.secret, c.version;
$$;

-- Stores refreshed tokens, if the row is still the version that was leased.
create or replace function public.connection_rotate(p_provider text, p_version bigint, p_secret text, p_expires_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.connections c
  set secret = p_secret, expires_at = p_expires_at, leased_until = null, version = c.version + 1
  where c.user_id = public.connection_uid() and c.provider = p_provider and c.version = p_version;
  return found;
end;
$$;

create or replace function public.connection_release(p_provider text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.connections c set leased_until = null
  where c.user_id = public.connection_uid() and c.provider = p_provider;
$$;

create or replace function public.connection_used(p_provider text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.connections c set last_used_at = now()
  where c.user_id = public.connection_uid() and c.provider = p_provider;
$$;

create or replace function public.connection_delete(p_provider text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.connections c where c.user_id = public.connection_uid() and c.provider = p_provider;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'connection_uid()', 'connection_list()', 'connection_save(text, text, text, timestamptz)',
    'connection_secret(text)', 'connection_lease(text, integer)', 'connection_rotate(text, bigint, text, timestamptz)',
    'connection_release(text)', 'connection_used(text)', 'connection_delete(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
