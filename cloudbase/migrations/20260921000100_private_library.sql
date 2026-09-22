-- CloudBase PostgreSQL: auth.uid() returns text, so every user_id column is
-- varchar(64) to keep `user_id = auth.uid()` working without casts.
-- auth.users.id is bigint in CloudBase, which cannot be referenced by a
-- varchar column, so these tables deliberately carry no foreign key to
-- auth.users. Access is gated by echo_private_members instead.
-- Applied by CloudBase native migration management using the logged-in CLI account.
create table if not exists public.echo_private_members (
  user_id varchar(64) primary key,
  created_at timestamptz not null default now()
);
alter table public.echo_private_members enable row level security;
revoke all on public.echo_private_members from public, anon, authenticated;

create or replace function public.echo_is_private_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.echo_private_members where user_id = auth.uid()
  );
$$;
revoke all on function public.echo_is_private_member() from public, anon;
grant execute on function public.echo_is_private_member() to authenticated;

create table if not exists public.echo_notes (
  user_id varchar(64) not null,
  id uuid not null,
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 524288),
  storage_version bigint not null default 1 check (storage_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ai_token uuid,
  ai_lease_until timestamptz,
  primary key (user_id, id)
);
create index if not exists echo_notes_owner_created on public.echo_notes(user_id, created_at desc, id);
alter table public.echo_notes enable row level security;
drop policy if exists echo_notes_owner_read on public.echo_notes;
create policy echo_notes_owner_read on public.echo_notes for select to authenticated
  using (user_id = (select auth.uid()) and (select public.echo_is_private_member()));
revoke all on public.echo_notes from public, anon, authenticated;
grant select on public.echo_notes to authenticated;

create table if not exists public.echo_ai_usage (
  user_id varchar(64) primary key,
  minute_start timestamptz not null default now(),
  minute_count integer not null default 0,
  hour_start timestamptz not null default now(),
  hour_count integer not null default 0
);
alter table public.echo_ai_usage enable row level security;
revoke all on public.echo_ai_usage from public, anon, authenticated;

create or replace function public.echo_require_member() returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.echo_is_private_member() then
    raise exception using errcode = '42501', message = 'PRIVATE_ACCOUNT_REQUIRED';
  end if;
  return auth.uid();
end;
$$;

create or replace function public.echo_note_json(p_note public.echo_notes) returns jsonb
language sql immutable set search_path = '' as $$
  select p_note.data || jsonb_build_object(
    'id', p_note.id, 'storageVersion', p_note.storage_version,
    'createdAt', to_char(p_note.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(p_note.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
$$;

create or replace function public.echo_create_note(p_id uuid, p_note jsonb, p_capture jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user text := public.echo_require_member(); v_note public.echo_notes;
begin
  if jsonb_typeof(p_note) <> 'object' or jsonb_typeof(p_capture) <> 'object' then
    raise exception using errcode = '22023', message = 'INVALID_NOTE';
  end if;
  insert into public.echo_notes(user_id, id, data)
    values(v_user, p_id, p_note - 'id' - 'storageVersion' - 'createdAt' - 'updatedAt')
    on conflict(user_id,id) do nothing;
  select * into v_note from public.echo_notes where user_id = v_user and id = p_id for update;
  if not (v_note.data @> p_capture) then
    raise exception using errcode = 'P0001', message = 'CONFLICT';
  end if;
  return public.echo_note_json(v_note);
end;
$$;

create or replace function public.echo_update_note(p_id uuid, p_expected_version bigint, p_action text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user text := public.echo_require_member(); v_note public.echo_notes; v_patch jsonb;
begin
  if p_id is null or p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode = '22023', message = 'INVALID_VERSION';
  end if;
  select * into v_note from public.echo_notes where user_id = v_user and id = p_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
  if v_note.storage_version <> p_expected_version then raise exception using errcode = 'P0001', message = 'CONFLICT'; end if;
  if p_action = 'content' then
    v_patch := jsonb_build_object(
      'userText', p_patch->'userText', 'sourceType', p_patch->'sourceType', 'sourceName', p_patch->'sourceName',
      'sourceUrl', p_patch->'sourceUrl', 'sourceTimestamp', p_patch->'sourceTimestamp', 'sourceExcerpt', p_patch->'sourceExcerpt');
    if v_note.data @> v_patch then return public.echo_note_json(v_note); end if;
    v_patch := v_patch || jsonb_build_object('revision', (v_note.data->>'revision')::integer + 1,
      'aiStatus', case when v_note.data->'aiResult' <> 'null'::jsonb then 'outdated' else 'not_started' end, 'aiError', null);
    v_note.ai_token := null; v_note.ai_lease_until := null;
  elsif p_action = 'meta' then
    v_patch := jsonb_build_object('title', p_patch->'title', 'tags', p_patch->'tags');
  elsif p_action = 'reflection' then
    v_patch := jsonb_build_object('reflectionText', p_patch->'text',
      'reflectionPrompt', case when p_patch ? 'prompt' then p_patch->'prompt' else v_note.data->'reflectionPrompt' end);
  elsif p_action = 'aiResult' then
    if v_note.data->'aiResult' = 'null'::jsonb then raise exception using errcode = 'P0001', message = 'NO_AI_RESULT'; end if;
    if v_note.data->>'aiStatus' = 'processing' then raise exception using errcode = 'P0001', message = 'ALREADY_PROCESSING'; end if;
    v_patch := jsonb_build_object('aiResult', p_patch);
  else raise exception using errcode = '22023', message = 'INVALID_ACTION';
  end if;
  update public.echo_notes set data = data || v_patch, storage_version = storage_version + 1,
    updated_at = clock_timestamp(), ai_token = v_note.ai_token, ai_lease_until = v_note.ai_lease_until
    where user_id = v_user and id = p_id returning * into v_note;
  return public.echo_note_json(v_note);
end;
$$;

create or replace function public.echo_delete_note(p_id uuid, p_expected_version bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_user text := public.echo_require_member(); v_version bigint;
begin
  if p_id is null or p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode = '22023', message = 'INVALID_VERSION';
  end if;
  select storage_version into v_version from public.echo_notes where user_id = v_user and id = p_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
  if v_version <> p_expected_version then raise exception using errcode = 'P0001', message = 'CONFLICT'; end if;
  delete from public.echo_notes where user_id = v_user and id = p_id;
  return true;
end;
$$;

create or replace function public.echo_import_notes(p_notes jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_user text := public.echo_require_member(); v_note jsonb; v_added integer := 0; v_rows integer;
begin
  if jsonb_typeof(p_notes) <> 'array' or jsonb_array_length(p_notes) > 10000 then
    raise exception using errcode = '22023', message = 'INVALID_BACKUP';
  end if;
  for v_note in select value from jsonb_array_elements(p_notes) loop
    if jsonb_typeof(v_note) <> 'object' then raise exception using errcode = '22023', message = 'INVALID_NOTE'; end if;
    if v_note->>'aiStatus' = 'processing' then
      v_note := v_note || jsonb_build_object('aiStatus', 'error', 'aiError', '备份中的整理未完成，原记录和已有结果已保留，可以重新整理。');
    end if;
    insert into public.echo_notes(user_id, id, data, created_at)
      values(v_user, (v_note->>'id')::uuid, v_note - 'id' - 'storageVersion' - 'createdAt' - 'updatedAt',
        (v_note->>'createdAt')::timestamptz)
      on conflict(user_id,id) do nothing;
    get diagnostics v_rows = row_count;
    v_added := v_added + v_rows;
  end loop;
  return v_added;
end;
$$;

create or replace function public.echo_recover_ai() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_user text := public.echo_require_member(); v_rows integer;
begin
  update public.echo_notes set data = data || jsonb_build_object('aiStatus', 'error', 'aiError', '上次整理超时，记录和已有结果已保留，可以重新整理。'),
    ai_token = null, ai_lease_until = null, storage_version = storage_version + 1, updated_at = clock_timestamp()
    where user_id = v_user and data->>'aiStatus' = 'processing'
      and (ai_lease_until is null or ai_lease_until <= clock_timestamp());
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create or replace function public.echo_begin_ai(p_id uuid, p_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user text := public.echo_require_member(); v_note public.echo_notes; v_usage public.echo_ai_usage; v_now timestamptz := clock_timestamp(); v_token uuid := gen_random_uuid();
begin
  if p_id is null or p_revision is null or p_revision < 1 then raise exception using errcode = '22023', message = 'INVALID_REVISION'; end if;
  insert into public.echo_ai_usage(user_id) values(v_user) on conflict(user_id) do nothing;
  select * into v_usage from public.echo_ai_usage where user_id = v_user for update;
  select * into v_note from public.echo_notes where user_id = v_user and id = p_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;
  if (v_note.data->>'revision')::integer <> p_revision then raise exception using errcode = 'P0001', message = 'CONTENT_CHANGED'; end if;
  if v_note.ai_token is not null and v_note.ai_lease_until > v_now then raise exception using errcode = 'P0001', message = 'ALREADY_PROCESSING'; end if;
  if coalesce(trim(v_note.data->>'userText'), '') = '' and coalesce(trim(v_note.data->>'sourceExcerpt'), '') = '' then
    raise exception using errcode = 'P0001', message = 'NO_AI_INPUT';
  end if;
  if (select count(*) from public.echo_notes where user_id = v_user and ai_lease_until > v_now) >= 3 then
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED';
  end if;
  if v_usage.minute_start + interval '1 minute' <= v_now then v_usage.minute_start := v_now; v_usage.minute_count := 0; end if;
  if v_usage.hour_start + interval '1 hour' <= v_now then v_usage.hour_start := v_now; v_usage.hour_count := 0; end if;
  if v_usage.minute_count >= 8 or v_usage.hour_count >= 100 then raise exception using errcode = 'P0001', message = 'RATE_LIMITED'; end if;
  update public.echo_ai_usage set minute_start = v_usage.minute_start, minute_count = v_usage.minute_count + 1,
    hour_start = v_usage.hour_start, hour_count = v_usage.hour_count + 1 where user_id = v_user;
  update public.echo_notes set data = data || jsonb_build_object('aiStatus', 'processing', 'aiError', null),
    ai_token = v_token, ai_lease_until = v_now + interval '2 minutes', storage_version = storage_version + 1, updated_at = v_now
    where user_id = v_user and id = p_id returning * into v_note;
  return jsonb_build_object('note', public.echo_note_json(v_note), 'token', v_token);
end;
$$;

create or replace function public.echo_finish_ai(p_id uuid, p_token uuid, p_revision integer, p_result jsonb, p_default_title text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_user text := public.echo_require_member(); v_note public.echo_notes; v_patch jsonb;
begin
  select * into v_note from public.echo_notes where user_id = v_user and id = p_id for update;
  if not found or p_token is null or p_revision is null or v_note.ai_token is distinct from p_token or v_note.ai_lease_until is null or v_note.ai_lease_until <= clock_timestamp()
    or (v_note.data->>'revision')::integer <> p_revision or v_note.data->>'aiStatus' <> 'processing' then return false; end if;
  v_patch := jsonb_build_object('aiResult', p_result, 'aiInputRevision', p_revision, 'aiStatus', 'done', 'aiError', null);
  if v_note.data->'aiResult' = 'null'::jsonb then
    if v_note.data->>'title' = p_default_title then v_patch := v_patch || jsonb_build_object('title', p_result->'title'); end if;
    if v_note.data->'tags' = '[]'::jsonb then v_patch := v_patch || jsonb_build_object('tags', p_result->'tags'); end if;
  end if;
  if coalesce(trim(v_note.data->>'reflectionText'), '') = '' and v_note.data->>'reflectionPrompt' = '如果讲给朋友听，你会怎么解释这条想法？' then
    v_patch := v_patch || jsonb_build_object('reflectionPrompt', p_result->'reflectionQuestions'->0);
  end if;
  update public.echo_notes set data = data || v_patch, storage_version = storage_version + 1, updated_at = clock_timestamp(),
    ai_token = null, ai_lease_until = null where user_id = v_user and id = p_id;
  return true;
end;
$$;

create or replace function public.echo_fail_ai(p_id uuid, p_token uuid, p_message text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user text := public.echo_require_member();
begin
  update public.echo_notes set data = data || jsonb_build_object('aiStatus', 'error', 'aiError', left(p_message, 2000)),
    ai_token = null, ai_lease_until = null, storage_version = storage_version + 1, updated_at = clock_timestamp()
    where user_id = v_user and id = p_id and ai_token = p_token and data->>'aiStatus' = 'processing';
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on new functions by default. Close that path.
revoke all on function public.echo_require_member() from public, anon, authenticated;
revoke all on function public.echo_note_json(public.echo_notes) from public, anon, authenticated;
revoke all on function public.echo_create_note(uuid,jsonb,jsonb) from public, anon;
revoke all on function public.echo_update_note(uuid,bigint,text,jsonb) from public, anon;
revoke all on function public.echo_delete_note(uuid,bigint) from public, anon;
revoke all on function public.echo_import_notes(jsonb) from public, anon;
revoke all on function public.echo_recover_ai() from public, anon;
revoke all on function public.echo_begin_ai(uuid,integer) from public, anon;
revoke all on function public.echo_finish_ai(uuid,uuid,integer,jsonb,text) from public, anon;
revoke all on function public.echo_fail_ai(uuid,uuid,text) from public, anon;
grant execute on function public.echo_create_note(uuid,jsonb,jsonb), public.echo_update_note(uuid,bigint,text,jsonb),
  public.echo_delete_note(uuid,bigint), public.echo_import_notes(jsonb), public.echo_recover_ai(),
  public.echo_begin_ai(uuid,integer), public.echo_finish_ai(uuid,uuid,integer,jsonb,text), public.echo_fail_ai(uuid,uuid,text)
  to authenticated;
