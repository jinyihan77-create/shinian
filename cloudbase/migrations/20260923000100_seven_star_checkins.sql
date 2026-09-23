-- Upgrade daily check-ins to replay the same seven-point star across devices.
alter table public.echo_checkins add column if not exists star_variant integer not null default 0;
alter table public.echo_checkins add column if not exists theme_id text not null default 'climate-0';
alter table public.echo_checkins add column if not exists material_id text not null default 'frost';
alter table public.echo_checkins add column if not exists visual_seed text not null default '0';
alter table public.echo_checkins add column if not exists experience_version integer not null default 2;
alter table public.echo_checkins add column if not exists source_note_ids text[] not null default '{}';
alter table public.echo_checkins add column if not exists updated_at timestamptz not null default clock_timestamp();
alter table public.echo_checkins add column if not exists revision integer not null default 1;

create or replace function public.echo_checkin_summary(p_today date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user text;
  v_total bigint;
  v_streak bigint := 0;
  v_anchor date;
  v_cursor date;
  v_entry jsonb := null;
begin
  v_user := public.echo_require_member();
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
    'createdAt', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'starVariant', star_variant, 'themeId', theme_id, 'materialId', material_id,
    'visualSeed', visual_seed, 'experienceVersion', experience_version,
    'sourceNoteIds', to_jsonb(source_note_ids), 'revision', revision,
    'updatedAt', to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) into v_entry from public.echo_checkins where user_id = v_user and day = p_today;
  return jsonb_build_object(
    'today', to_char(p_today, 'YYYY-MM-DD'), 'totalDays', v_total,
    'currentStreak', v_streak, 'entry', v_entry
  );
end;
$$;

drop function if exists public.echo_create_checkin(date,text,text);
create or replace function public.echo_create_checkin(
  p_expected_day date, p_mood text, p_quote text,
  p_star_variant integer default 0, p_theme_id text default 'climate-0',
  p_material_id text default 'frost', p_visual_seed text default '0',
  p_experience_version integer default 2, p_source_note_ids text[] default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user text;
  v_now timestamptz := clock_timestamp();
  v_today date := (v_now at time zone 'Asia/Shanghai')::date;
begin
  v_user := public.echo_require_member();
  if p_expected_day is null or p_expected_day <> v_today then
    raise exception using errcode = 'P0001', message = 'CHECKIN_DAY_CHANGED';
  end if;
  if p_mood is null or p_quote is null or char_length(p_mood) > 24 or char_length(p_quote) > 100
    or p_star_variant is null or p_star_variant < 0 or p_star_variant > 2
    or p_theme_id is null or char_length(p_theme_id) > 64
    or p_material_id is null or char_length(p_material_id) > 64
    or p_visual_seed is null or char_length(p_visual_seed) > 128
    or p_experience_version is null or p_experience_version < 1 or p_experience_version > 99
    or p_source_note_ids is null or cardinality(p_source_note_ids) > 20 then
    raise exception using errcode = '22023', message = 'INVALID_CHECKIN_INPUT';
  end if;
  insert into public.echo_checkins(
    user_id, day, mood, quote, star_variant, theme_id, material_id,
    visual_seed, experience_version, source_note_ids, created_at, updated_at, revision
  ) values(
    v_user, v_today, btrim(p_mood), btrim(p_quote), p_star_variant,
    btrim(p_theme_id), btrim(p_material_id), btrim(p_visual_seed),
    p_experience_version, p_source_note_ids, v_now, v_now, 1
  ) on conflict(user_id, day) do nothing;
  return public.echo_checkin_summary(v_today);
end;
$$;

revoke all on function public.echo_checkin_summary(date) from public, anon, authenticated;
revoke all on function public.echo_create_checkin(date,text,text,integer,text,text,text,integer,text[]) from public, anon;
grant execute on function public.echo_get_checkin() to authenticated;
grant execute on function public.echo_create_checkin(date,text,text,integer,text,text,text,integer,text[]) to authenticated;
create or replace function public.echo_update_checkin(
  p_expected_day date, p_mood text, p_quote text, p_expected_revision integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user text;
  v_today date := (clock_timestamp() at time zone 'Asia/Shanghai')::date;
begin
  v_user := public.echo_require_member();
  if p_expected_day is null or p_expected_day <> v_today then
    raise exception using errcode = 'P0001', message = 'CHECKIN_DAY_CHANGED';
  end if;
  if p_mood is null or p_quote is null or char_length(p_mood) > 24 or char_length(p_quote) > 100
    or p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'INVALID_CHECKIN_INPUT';
  end if;
  update public.echo_checkins
    set mood = btrim(p_mood), quote = btrim(p_quote), updated_at = clock_timestamp(), revision = revision + 1
    where user_id = v_user and day = v_today and revision = p_expected_revision;
  if not found then
    raise exception using errcode = '40001', message = 'CHECKIN_EDIT_CONFLICT';
  end if;
  return public.echo_checkin_summary(v_today);
end;
$$;

revoke all on function public.echo_update_checkin(date,text,text,integer) from public, anon;
grant execute on function public.echo_update_checkin(date,text,text,integer) to authenticated;
NOTIFY pgrst, 'reload schema';
