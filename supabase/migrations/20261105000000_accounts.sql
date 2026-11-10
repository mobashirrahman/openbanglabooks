-- OpenBanglaBooks — reader accounts
-- Readers sign in with email and password, or with Google/Facebook (Supabase
-- Auth). A profile row is created for every new user by public.handle_new_user
-- (catalog migration).

-- A reader can delete their own account at any time. Everything personal
-- (profile, library, notes, positions…) references auth.users with
-- "on delete cascade", so this one statement removes all of it.
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
  delete from auth.users where id = uid;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
