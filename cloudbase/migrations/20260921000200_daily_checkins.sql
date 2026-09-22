-- Private daily check-ins. All writes use the database clock in Asia/Shanghai.
-- auth.uid() returns text while auth.users.id is bigint in CloudBase, so
-- user_id stays varchar(64) with no foreign key; echo_private_members gates access.
create table if not exists public.echo_checkins (
  user_id varchar(64) not null,
  day date not null,
  mood text not null default '' check (char_length(mood) <= 24),
  quote text not null default '' check (char_length(quote) <= 100),
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id, day)
);
alter table public.echo_checkins enable row level security;
drop policy if exists echo_checkins_owner_read on public.echo_checkins;
create policy echo_checkins_owner_read on public.echo_checkins for select to authenticated
  using (user_id = (select auth.uid()) and (select public.echo_is_private_member()));
revoke all on public.echo_checkins from public, anon, authenticated;
grant select on public.echo_checkins to authenticated;

-- The date parameter is deliberately unavailable to API callers.
create or replace function public.echo_checkin_summary(p_today date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user text := public.echo_require_member();
  v_total bigint;
  v_streak bigint := 0;
  v_anchor date;
  v_cursor date;
  v_entry jsonb := null;
begin
  select count(*), max(day) into v_total, v_anchor
    from public.echo_checkins where user_id = v_user and day <= p_today;
  if v_anchor >= p_today - 1 then
    v_cursor := v_anchor;
    while exists (select 1 from public.echo_checkins where user_id = v_user and day = v_cursor) loop
      v_streak := v_streak + 1;
      v_cursor := v_cursor - 1;
    end loop;
  end if;
  select jsonb_build_object(
    'day', to_char(day, 'YYYY-MM-DD'), 'mood', mood, 'quote', quote,
    'createdAt', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) into v_entry from public.echo_checkins where user_id = v_user and day = p_today;
  return jsonb_build_object(
    'today', to_char(p_today, 'YYYY-MM-DD'), 'totalDays', v_total,
    'currentStreak', v_streak, 'entry', v_entry
  );
end;
$$;

create or replace function public.echo_get_checkin() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return public.echo_checkin_summary((clock_timestamp() at time zone 'Asia/Shanghai')::date);
end;
$$;

create or replace function public.echo_create_checkin(p_expected_day date, p_mood text, p_quote text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user text := public.echo_require_member();
  v_now timestamptz := clock_timestamp();
  v_today date := (v_now at time zone 'Asia/Shanghai')::date;
begin
  if p_expected_day is null or p_expected_day <> v_today then
    raise exception using errcode = 'P0001', message = 'CHECKIN_DAY_CHANGED';
  end if;
  if p_mood is null or p_quote is null or char_length(p_mood) > 24 or char_length(p_quote) > 100 then
    raise exception using errcode = '22023', message = 'INVALID_CHECKIN_INPUT';
  end if;
  -- The unique key serializes competing devices. A retry preserves the first entry.
  insert into public.echo_checkins(user_id, day, mood, quote, created_at)
    values(v_user, v_today, btrim(p_mood), btrim(p_quote), v_now)
    on conflict(user_id, day) do nothing;
  return public.echo_checkin_summary(v_today);
end;
$$;

revoke all on function public.echo_checkin_summary(date) from public, anon, authenticated;
revoke all on function public.echo_get_checkin() from public, anon;
revoke all on function public.echo_create_checkin(date,text,text) from public, anon;
grant execute on function public.echo_get_checkin() to authenticated;
grant execute on function public.echo_create_checkin(date,text,text) to authenticated;
NOTIFY pgrst, 'reload schema';
