alter table public.tasks
  add column if not exists recurrence jsonb;

comment on column public.tasks.recurrence is
  'Task recurrence rule: {freq, interval, mode}. Null means no repeat.';

create or replace function anttodo_private.validate_recurrence(p_recurrence jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_freq text;
  v_interval integer;
  v_mode text;
  v_keys text[];
begin
  if p_recurrence is null or p_recurrence = 'null'::jsonb then
    return;
  end if;
  if jsonb_typeof(p_recurrence) <> 'object' then
    raise exception 'Invalid recurrence rule';
  end if;

  select array_agg(key order by key)
  into v_keys
  from jsonb_object_keys(p_recurrence) as key;

  if v_keys is distinct from array['freq', 'interval', 'mode'] then
    raise exception 'Invalid recurrence rule';
  end if;

  v_freq := p_recurrence->>'freq';
  v_mode := p_recurrence->>'mode';
  if v_freq not in ('daily', 'weekdays', 'weekly', 'monthly', 'yearly')
    or v_mode is distinct from 'due'
    or coalesce(p_recurrence->>'interval', '') !~ '^[1-9]\d*$' then
    raise exception 'Invalid recurrence rule';
  end if;

  v_interval := (p_recurrence->>'interval')::integer;
  if v_interval <> 1 then
    raise exception 'Invalid recurrence rule';
  end if;
end;
$$;

create or replace function anttodo_private.next_recurrence_instant(
  p_instant timestamptz,
  p_timezone text,
  p_freq text,
  p_interval integer default 1
)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_zone text;
  v_local timestamp;
  v_date date;
  v_time time;
  v_year integer;
  v_month integer;
  v_day integer;
  v_target date;
  v_last_day integer;
  v_dow integer;
begin
  if p_instant is null then
    return null;
  end if;
  if p_interval is null or p_interval < 1 then
    raise exception 'Invalid recurrence interval';
  end if;

  v_zone := coalesce(nullif(p_timezone, ''), 'UTC');
  begin
    perform p_instant at time zone v_zone;
  exception when others then
    v_zone := 'UTC';
  end;

  v_local := p_instant at time zone v_zone;
  v_date := v_local::date;
  v_time := v_local::time;

  if p_freq = 'daily' then
    v_date := v_date + (p_interval * interval '1 day');
  elsif p_freq = 'weekly' then
    v_date := v_date + (p_interval * interval '7 days');
  elsif p_freq = 'weekdays' then
    v_date := v_date + interval '1 day';
    loop
      v_dow := extract(isodow from v_date)::integer;
      exit when v_dow between 1 and 5;
      v_date := v_date + interval '1 day';
    end loop;
  elsif p_freq = 'monthly' then
    v_year := extract(year from v_date)::integer;
    v_month := extract(month from v_date)::integer;
    v_day := extract(day from v_date)::integer;
    v_month := v_month + p_interval;
    v_year := v_year + ((v_month - 1) / 12);
    v_month := ((v_month - 1) % 12) + 1;
    v_target := make_date(v_year, v_month, 1);
    v_last_day := extract(day from (v_target + interval '1 month - 1 day'))::integer;
    v_date := make_date(v_year, v_month, least(v_day, v_last_day));
  elsif p_freq = 'yearly' then
    v_year := extract(year from v_date)::integer + p_interval;
    v_month := extract(month from v_date)::integer;
    v_day := extract(day from v_date)::integer;
    v_target := make_date(v_year, v_month, 1);
    v_last_day := extract(day from (v_target + interval '1 month - 1 day'))::integer;
    v_date := make_date(v_year, v_month, least(v_day, v_last_day));
  else
    raise exception 'Invalid recurrence frequency';
  end if;

  return (v_date + v_time) at time zone v_zone;
end;
$$;

create or replace function anttodo_private.roll_task_recurrence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_freq text;
  v_interval integer;
  v_next_due timestamptz;
  v_next_start timestamptz;
  v_delta interval;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if not (
    old.status is distinct from 'completed'
    and new.status = 'completed'
    and new.recurrence is not null
    and new.due_at is not null
  ) then
    return new;
  end if;

  perform anttodo_private.validate_recurrence(new.recurrence);
  v_freq := new.recurrence->>'freq';
  v_interval := coalesce((new.recurrence->>'interval')::integer, 1);

  v_next_due := anttodo_private.next_recurrence_instant(
    new.due_at, new.due_timezone, v_freq, v_interval
  );
  if v_next_due is null or v_next_due <= new.due_at then
    return new;
  end if;

  v_delta := v_next_due - new.due_at;
  if new.due_start_at is not null then
    v_next_start := new.due_start_at + v_delta;
  else
    v_next_start := null;
  end if;

  insert into public.activity_events(workspace_id, task_id, actor_id, event_type, payload)
  values (
    new.workspace_id,
    new.id,
    auth.uid(),
    'task.occurrence_completed',
    jsonb_build_object(
      'before', jsonb_build_object(
        'due_at', new.due_at,
        'due_start_at', new.due_start_at,
        'due_is_all_day', new.due_is_all_day,
        'due_timezone', new.due_timezone,
        'recurrence', new.recurrence
      ),
      'after', jsonb_build_object(
        'due_at', v_next_due,
        'due_start_at', v_next_start,
        'due_is_all_day', new.due_is_all_day,
        'due_timezone', new.due_timezone,
        'recurrence', new.recurrence
      )
    )
  );

  new.status := 'open';
  new.completed_at := null;
  new.due_at := v_next_due;
  new.due_start_at := v_next_start;
  new.version := coalesce(old.version, 0) + 1;
  return new;
end;
$$;

drop trigger if exists tasks_roll_recurrence on public.tasks;
create trigger tasks_roll_recurrence
before update of status on public.tasks
for each row execute function anttodo_private.roll_task_recurrence();

drop function if exists public.save_task_schedule(
  uuid, timestamptz, timestamptz, boolean, text, jsonb, boolean
);

create or replace function public.save_task_schedule(
  p_task_id uuid,
  p_due_at timestamptz,
  p_due_start_at timestamptz,
  p_due_is_all_day boolean,
  p_due_timezone text,
  p_reminders jsonb default '[]'::jsonb,
  p_persistent boolean default false,
  p_recurrence jsonb default null
)
returns setof public.task_reminders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule jsonb;
  v_position integer;
  v_local_time time;
  v_workspace_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_before_recurrence jsonb;
  v_after_recurrence jsonb;
  v_recurrence jsonb;
begin
  if (select auth.uid()) is null
    or not anttodo_private.can_edit_task(p_task_id) then
    raise exception 'Insufficient task permission' using errcode = '42501';
  end if;
  if p_due_timezone is not null and char_length(p_due_timezone) not between 1 and 100 then
    raise exception 'Invalid time zone';
  end if;
  perform anttodo_private.validate_reminder_rules(p_reminders);
  if p_due_at is null and jsonb_array_length(coalesce(p_reminders, '[]'::jsonb)) > 0 then
    raise exception 'A due date is required before reminders can be saved';
  end if;

  v_recurrence := case
    when p_due_at is null then null
    when p_recurrence is null or p_recurrence = 'null'::jsonb then null
    else p_recurrence
  end;
  perform anttodo_private.validate_recurrence(v_recurrence);
  if p_due_at is null and p_recurrence is not null and p_recurrence <> 'null'::jsonb then
    raise exception 'A due date is required before recurrence can be saved';
  end if;

  select t.workspace_id, t.recurrence
  into v_workspace_id, v_before_recurrence
  from public.tasks t where t.id = p_task_id;

  select jsonb_build_object(
    'persistent', coalesce((select s.persistent from public.task_reminder_settings s where s.task_id = p_task_id), false),
    'reminders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'anchor', r.anchor,
        'offset_value', r.offset_value,
        'offset_unit', r.offset_unit,
        'local_time', r.local_time
      ) order by r.position)
      from public.task_reminders r where r.task_id = p_task_id
    ), '[]'::jsonb)
  ) into v_before;

  update public.tasks set
    due_at = p_due_at,
    due_start_at = p_due_start_at,
    due_is_all_day = coalesce(p_due_is_all_day, false),
    due_timezone = p_due_timezone,
    recurrence = v_recurrence,
    version = version + 1
  where id = p_task_id;

  delete from public.task_reminders where task_id = p_task_id;
  delete from public.task_reminder_settings where task_id = p_task_id;

  if p_due_at is not null then
    if jsonb_array_length(coalesce(p_reminders, '[]'::jsonb)) > 0 then
      insert into public.task_reminder_settings(task_id, persistent, updated_by)
      values (p_task_id, coalesce(p_persistent, false), (select auth.uid()));
    end if;

    for v_rule, v_position in
      select value, (ordinality - 1)::integer
      from jsonb_array_elements(coalesce(p_reminders, '[]'::jsonb)) with ordinality
    loop
      v_local_time := case when jsonb_typeof(v_rule->'local_time') = 'string'
        then (v_rule->>'local_time')::time else null end;
      insert into public.task_reminders(
        task_id, anchor, offset_value, offset_unit, local_time,
        trigger_at, position, created_by
      ) values (
        p_task_id,
        v_rule->>'anchor',
        (v_rule->>'offset_value')::integer,
        v_rule->>'offset_unit',
        v_local_time,
        anttodo_private.reminder_trigger_at(
          p_task_id, v_rule->>'anchor', (v_rule->>'offset_value')::integer,
          v_rule->>'offset_unit', v_local_time
        ),
        v_position,
        (select auth.uid())
      );
    end loop;
  end if;

  select jsonb_build_object(
    'persistent', coalesce((select s.persistent from public.task_reminder_settings s where s.task_id = p_task_id), false),
    'reminders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'anchor', r.anchor,
        'offset_value', r.offset_value,
        'offset_unit', r.offset_unit,
        'local_time', r.local_time
      ) order by r.position)
      from public.task_reminders r where r.task_id = p_task_id
    ), '[]'::jsonb)
  ) into v_after;

  select t.recurrence into v_after_recurrence from public.tasks t where t.id = p_task_id;

  if v_before is distinct from v_after then
    insert into public.activity_events(workspace_id, task_id, actor_id, event_type, payload)
    values (v_workspace_id, p_task_id, (select auth.uid()), 'task.reminders_changed',
      jsonb_build_object('before', v_before, 'after', v_after));
  end if;

  if v_before_recurrence is distinct from v_after_recurrence then
    insert into public.activity_events(workspace_id, task_id, actor_id, event_type, payload)
    values (v_workspace_id, p_task_id, (select auth.uid()), 'task.recurrence_changed',
      jsonb_build_object('before', v_before_recurrence, 'after', v_after_recurrence));
  end if;

  return query select * from public.task_reminders
    where task_id = p_task_id order by position;
end;
$$;

revoke all on function public.save_task_schedule(
  uuid, timestamptz, timestamptz, boolean, text, jsonb, boolean, jsonb
) from public, anon;
grant execute on function public.save_task_schedule(
  uuid, timestamptz, timestamptz, boolean, text, jsonb, boolean, jsonb
) to authenticated;
