-- Any verified Supabase Auth account gets its own isolated library on first use.
-- The user_id owner key and RLS policies continue to prevent cross-account access.
create or replace function public.echo_require_member() returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not exists (select 1 from auth.users where id = v_user) then
    raise exception using errcode = '42501', message = 'PRIVATE_ACCOUNT_REQUIRED';
  end if;
  insert into public.echo_private_members(user_id) values(v_user) on conflict(user_id) do nothing;
  return v_user;
end;
$$;
revoke all on function public.echo_require_member() from public, anon, authenticated;
grant execute on function public.echo_require_member() to authenticated;
