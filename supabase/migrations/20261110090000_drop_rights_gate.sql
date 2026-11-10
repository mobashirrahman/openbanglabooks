-- Publishing is no longer gated on a recorded rights basis or a named reviewer.
-- The provenance columns stay so older rows keep their history, but they are
-- informational only: nothing blocks a work from being set to 'published'.
alter table public.works drop constraint if exists published_requires_rights;
