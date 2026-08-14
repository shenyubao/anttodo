alter table public.subtasks
  add column due_start_at timestamptz,
  add column due_is_all_day boolean not null default false,
  add column due_timezone text;

alter table public.subtasks
  add constraint subtasks_due_range_order_check
  check (
    due_start_at is null
    or (due_at is not null and due_start_at <= due_at)
  ),
  add constraint subtasks_due_all_day_range_check
  check (not due_is_all_day or due_start_at is not null),
  add constraint subtasks_due_timezone_length_check
  check (due_timezone is null or char_length(due_timezone) between 1 and 100);

alter table public.task_reminders
  add column subtask_id uuid references public.subtasks(id) on delete cascade;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.task_reminders'::regclass
      and con.contype = 'u'
  loop
    execute format('alter table public.task_reminders drop constraint %I', constraint_name);
  end loop;
end
$$;

alter table public.task_reminders
  add constraint task_reminders_scope_rule_key
    unique nulls not distinct (task_id, subtask_id, anchor, offset_value, offset_unit, local_time),
  add constraint task_reminders_scope_position_key
    unique nulls not distinct (task_id, subtask_id, position);

create or replace function anttodo_private.enforce_reminder_subtask_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.subtask_id is null then
    return new;
  end if;
  if not exists (
    select 1 from public.subtasks s
    where s.id = new.subtask_id and s.task_id = new.task_id
  ) then
    raise exception 'Reminder subtask must belong to the parent task';
  end if;
  return new;
end;
$$;

drop trigger if exists task_reminders_subtask_parent on public.task_reminders;
create trigger task_reminders_subtask_parent
before insert or update of task_id, subtask_id on public.task_reminders
for each row execute function anttodo_private.enforce_reminder_subtask_parent();

create table public.subtask_reminder_settings (
  subtask_id uuid primary key references public.subtasks(id) on delete cascade,
  persistent boolean not null default false,
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger subtask_reminder_settings_updated_at
before update on public.subtask_reminder_settings
for each row execute function anttodo_private.set_updated_at();

alter table public.subtask_reminder_settings enable row level security;

create policy subtask_reminder_settings_select
on public.subtask_reminder_settings for select to authenticated
using (
  exists (
    select 1 from public.subtasks s
    where s.id = subtask_id
      and anttodo_private.can_view_task(s.task_id)
  )
);

grant select on public.subtask_reminder_settings to authenticated;
grant all on public.subtask_reminder_settings to service_role;

create or replace function anttodo_private.reminder_trigger_at(
  p_task_id uuid,
  p_anchor text,
  p_offset_value integer,
  p_offset_unit text,
  p_local_time time,
  p_subtask_id uuid default null
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_due_at timestamptz;
  v_due_start_at timestamptz;
  v_due_timezone text;
  v_anchor timestamptz;
  v_minutes integer;
  v_days integer;
  v_zone text;
begin
  if p_subtask_id is not null then
    select s.due_at, s.due_start_at, s.due_timezone
    into strict v_due_at, v_due_start_at, v_due_timezone
    from public.subtasks s
    where s.id = p_subtask_id;
  else
    select t.due_at, t.due_start_at, t.due_timezone
    into strict v_due_at, v_due_start_at, v_due_timezone
    from public.tasks t
    where t.id = p_task_id;
  end if;

  v_anchor := case
    when p_anchor = 'end' then v_due_at
    else coalesce(v_due_start_at, v_due_at)
  end;
  if v_anchor is null then
    raise exception 'A due date is required before reminders can be saved';
  end if;

  if p_local_time is not null then
    v_zone := coalesce(v_due_timezone, 'UTC');
    v_days := p_offset_value * case when p_offset_unit = 'week' then 7 else 1 end;
    return (((v_anchor at time zone v_zone)::date - v_days) + p_local_time)
      at time zone v_zone;
  end if;

  v_minutes := p_offset_value * case p_offset_unit
    when 'minute' then 1
    when 'hour' then 60
    when 'day' then 1440
    when 'week' then 10080
  end;
  return v_anchor - make_interval(mins => v_minutes);
end;
$$;

create or replace function anttodo_private.on_task_schedule_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.due_at is null or new.status <> 'open' or new.deleted_at is not null then
    update public.reminder_delivery_states d set cancelled_at = coalesce(cancelled_at, now())
    from public.task_reminders r
    where r.task_id = new.id
      and r.subtask_id is null
      and d.reminder_id = r.id
      and d.acknowledged_at is null;
    if new.due_at is null then
      delete from public.task_reminders where task_id = new.id and subtask_id is null;
      delete from public.task_reminder_settings where task_id = new.id;
    end if;
    return new;
  end if;

  if old.due_at is distinct from new.due_at
    or old.due_start_at is distinct from new.due_start_at
    or old.due_is_all_day is distinct from new.due_is_all_day
    or old.due_timezone is distinct from new.due_timezone then
    update public.task_reminders r set trigger_at =
      anttodo_private.reminder_trigger_at(
        r.task_id, r.anchor, r.offset_value, r.offset_unit, r.local_time, r.subtask_id
      )
    where r.task_id = new.id and r.subtask_id is null;
    update public.reminder_delivery_states d set cancelled_at = coalesce(cancelled_at, now())
    from public.task_reminders r
    where r.task_id = new.id
      and r.subtask_id is null
      and d.reminder_id = r.id
      and d.scheduled_for is distinct from r.trigger_at
      and d.acknowledged_at is null;
  end if;
  return new;
end;
$$;

create or replace function anttodo_private.on_subtask_schedule_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.due_at is null or new.completed then
    update public.reminder_delivery_states d set cancelled_at = coalesce(cancelled_at, now())
    from public.task_reminders r
    where r.subtask_id = new.id
      and d.reminder_id = r.id
      and d.acknowledged_at is null;
    if new.due_at is null then
      delete from public.task_reminders where subtask_id = new.id;
      delete from public.subtask_reminder_settings where subtask_id = new.id;
    end if;
    return new;
  end if;

  if old.due_at is distinct from new.due_at
    or old.due_start_at is distinct from new.due_start_at
    or old.due_is_all_day is distinct from new.due_is_all_day
    or old.due_timezone is distinct from new.due_timezone then
    update public.task_reminders r set trigger_at =
      anttodo_private.reminder_trigger_at(
        r.task_id, r.anchor, r.offset_value, r.offset_unit, r.local_time, r.subtask_id
      )
    where r.subtask_id = new.id;
    update public.reminder_delivery_states d set cancelled_at = coalesce(cancelled_at, now())
    from public.task_reminders r
    where r.subtask_id = new.id
      and d.reminder_id = r.id
      and d.scheduled_for is distinct from r.trigger_at
      and d.acknowledged_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists subtasks_schedule_changed on public.subtasks;
create trigger subtasks_schedule_changed
after update of due_at, due_start_at, due_is_all_day, due_timezone, completed
on public.subtasks for each row execute function anttodo_private.on_subtask_schedule_changed();

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
      from public.task_reminders r where r.task_id = p_task_id and r.subtask_id is null
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

  delete from public.task_reminders where task_id = p_task_id and subtask_id is null;
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
        task_id, subtask_id, anchor, offset_value, offset_unit, local_time,
        trigger_at, position, created_by
      ) values (
        p_task_id,
        null,
        v_rule->>'anchor',
        (v_rule->>'offset_value')::integer,
        v_rule->>'offset_unit',
        v_local_time,
        anttodo_private.reminder_trigger_at(
          p_task_id, v_rule->>'anchor', (v_rule->>'offset_value')::integer,
          v_rule->>'offset_unit', v_local_time, null
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
      from public.task_reminders r where r.task_id = p_task_id and r.subtask_id is null
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
    where task_id = p_task_id and subtask_id is null order by position;
end;
$$;

create or replace function public.save_subtask_schedule(
  p_subtask_id uuid,
  p_due_at timestamptz,
  p_due_start_at timestamptz,
  p_due_is_all_day boolean,
  p_due_timezone text,
  p_reminders jsonb default '[]'::jsonb,
  p_persistent boolean default false
)
returns setof public.task_reminders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
  v_rule jsonb;
  v_position integer;
  v_local_time time;
begin
  select s.task_id into v_task_id from public.subtasks s where s.id = p_subtask_id;
  if v_task_id is null
    or (select auth.uid()) is null
    or not anttodo_private.can_edit_task(v_task_id) then
    raise exception 'Insufficient task permission' using errcode = '42501';
  end if;
  if p_due_timezone is not null and char_length(p_due_timezone) not between 1 and 100 then
    raise exception 'Invalid time zone';
  end if;
  perform anttodo_private.validate_reminder_rules(p_reminders);
  if p_due_at is null and jsonb_array_length(coalesce(p_reminders, '[]'::jsonb)) > 0 then
    raise exception 'A due date is required before reminders can be saved';
  end if;

  update public.subtasks set
    due_at = p_due_at,
    due_start_at = p_due_start_at,
    due_is_all_day = coalesce(p_due_is_all_day, false),
    due_timezone = p_due_timezone
  where id = p_subtask_id;

  delete from public.task_reminders where subtask_id = p_subtask_id;
  delete from public.subtask_reminder_settings where subtask_id = p_subtask_id;

  if p_due_at is not null then
    if jsonb_array_length(coalesce(p_reminders, '[]'::jsonb)) > 0 then
      insert into public.subtask_reminder_settings(subtask_id, persistent, updated_by)
      values (p_subtask_id, coalesce(p_persistent, false), (select auth.uid()));
    end if;

    for v_rule, v_position in
      select value, (ordinality - 1)::integer
      from jsonb_array_elements(coalesce(p_reminders, '[]'::jsonb)) with ordinality
    loop
      v_local_time := case when jsonb_typeof(v_rule->'local_time') = 'string'
        then (v_rule->>'local_time')::time else null end;
      insert into public.task_reminders(
        task_id, subtask_id, anchor, offset_value, offset_unit, local_time,
        trigger_at, position, created_by
      ) values (
        v_task_id,
        p_subtask_id,
        v_rule->>'anchor',
        (v_rule->>'offset_value')::integer,
        v_rule->>'offset_unit',
        v_local_time,
        anttodo_private.reminder_trigger_at(
          v_task_id, v_rule->>'anchor', (v_rule->>'offset_value')::integer,
          v_rule->>'offset_unit', v_local_time, p_subtask_id
        ),
        v_position,
        (select auth.uid())
      );
    end loop;
  end if;

  return query select * from public.task_reminders
    where subtask_id = p_subtask_id order by position;
end;
$$;

revoke all on function public.save_subtask_schedule(
  uuid, timestamptz, timestamptz, boolean, text, jsonb, boolean
) from public, anon;
grant execute on function public.save_subtask_schedule(
  uuid, timestamptz, timestamptz, boolean, text, jsonb, boolean
) to authenticated;

create or replace function public.apply_client_operations(p_operations jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op jsonb; result jsonb := '[]'::jsonb; existing jsonb; target_workspace uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(p_operations, '[]'::jsonb)) > 50 then raise exception 'Too many operations' using errcode = '22023'; end if;
  for op in select value from jsonb_array_elements(coalesce(p_operations, '[]'::jsonb)) loop
    target_workspace := (op ->> 'workspaceId')::uuid;
    if not anttodo_private.is_workspace_member(target_workspace) then
      result := result || jsonb_build_array(jsonb_build_object('operationId', op ->> 'operationId', 'status', 'rejected', 'code', 'WORKSPACE_ACCESS_REVOKED'));
      continue;
    end if;
    select a.result into existing from anttodo_private.client_applied_operations a
      where a.operation_id = (op ->> 'operationId')::uuid and a.user_id = (select auth.uid());
    if existing is not null then result := result || jsonb_build_array(existing); continue; end if;

    if op ->> 'entityType' = 'tasks' then
      if (op ->> 'baseVersion') is not null and not exists (
        select 1 from public.tasks t where t.id = (op ->> 'entityId')::uuid and t.version = (op ->> 'baseVersion')::bigint
      ) then
        existing := jsonb_build_object('operationId', op ->> 'operationId', 'status', 'conflict', 'code', 'VERSION_CONFLICT');
        insert into public.client_sync_conflicts(workspace_id, device_id, entity_type, entity_id, operation_id, local_payload, remote_payload)
          select target_workspace, (op ->> 'deviceId')::uuid, 'tasks', (op ->> 'entityId')::uuid,
            (op ->> 'operationId')::uuid, op -> 'payload', coalesce(to_jsonb(t), '{}'::jsonb)
          from public.tasks t where t.id = (op ->> 'entityId')::uuid;
        insert into anttodo_private.client_applied_operations(operation_id, user_id, workspace_id, result)
          values ((op ->> 'operationId')::uuid, (select auth.uid()), target_workspace, existing);
        result := result || jsonb_build_array(existing);
        continue;
      end if;
      if exists (select 1 from public.tasks t where t.id = (op ->> 'entityId')::uuid) then
        update public.tasks t set
          title = coalesce(op -> 'payload' ->> 'title', t.title),
          description = coalesce(op -> 'payload' ->> 'description', t.description),
          status = coalesce((op -> 'payload' ->> 'status')::public.task_status, t.status),
          priority = coalesce((op -> 'payload' ->> 'priority')::public.task_priority, t.priority),
          due_at = case when op -> 'payload' ? 'due_at' then (op -> 'payload' ->> 'due_at')::timestamptz else t.due_at end,
          assignee_id = case when op -> 'payload' ? 'assignee_id' then (op -> 'payload' ->> 'assignee_id')::uuid else t.assignee_id end,
          updated_at = now()
        where t.id = (op ->> 'entityId')::uuid and t.workspace_id = target_workspace;
      else
        insert into public.tasks(id, workspace_id, title, description, status, priority, due_at, assignee_id, created_by)
        values (
          (op ->> 'entityId')::uuid, target_workspace,
          coalesce(op -> 'payload' ->> 'title', '新任务'),
          coalesce(op -> 'payload' ->> 'description', ''),
          coalesce((op -> 'payload' ->> 'status')::public.task_status, 'open'),
          coalesce((op -> 'payload' ->> 'priority')::public.task_priority, 'none'),
          (op -> 'payload' ->> 'due_at')::timestamptz,
          (op -> 'payload' ->> 'assignee_id')::uuid,
          (select auth.uid())
        );
        if jsonb_typeof(op -> 'payload' -> 'label_ids') = 'array' then
          insert into public.task_labels(task_id, label_id)
          select (op ->> 'entityId')::uuid, value::uuid
          from jsonb_array_elements_text(op -> 'payload' -> 'label_ids')
          on conflict do nothing;
        end if;
      end if;
    elsif op ->> 'entityType' = 'labels' then
      update public.labels l set
        name = coalesce(op -> 'payload' ->> 'name', l.name),
        color = coalesce(op -> 'payload' ->> 'color', l.color),
        position = coalesce((op -> 'payload' ->> 'position')::integer, l.position),
        updated_at = now()
      where l.id = (op ->> 'entityId')::uuid and l.workspace_id = target_workspace;
    elsif op ->> 'entityType' = 'subtasks' then
      if coalesce((op -> 'payload' ->> 'deleted')::boolean, false) then
        delete from public.subtasks where id = (op ->> 'entityId')::uuid
          and exists (select 1 from public.tasks t where t.id = subtasks.task_id and t.workspace_id = target_workspace);
      elsif exists (select 1 from public.subtasks s where s.id = (op ->> 'entityId')::uuid) then
        update public.subtasks s set
          title = coalesce(op -> 'payload' ->> 'title', s.title),
          completed = coalesce((op -> 'payload' ->> 'completed')::boolean, s.completed),
          position = coalesce((op -> 'payload' ->> 'position')::integer, s.position),
          priority = coalesce((op -> 'payload' ->> 'priority')::public.task_priority, s.priority),
          due_at = case when op -> 'payload' ? 'due_at' then (op -> 'payload' ->> 'due_at')::timestamptz else s.due_at end,
          due_start_at = case when op -> 'payload' ? 'due_start_at' then (op -> 'payload' ->> 'due_start_at')::timestamptz else s.due_start_at end,
          due_is_all_day = case when op -> 'payload' ? 'due_is_all_day' then coalesce((op -> 'payload' ->> 'due_is_all_day')::boolean, false) else s.due_is_all_day end,
          due_timezone = case when op -> 'payload' ? 'due_timezone' then op -> 'payload' ->> 'due_timezone' else s.due_timezone end,
          estimate_hours = case when op -> 'payload' ? 'estimate_hours' then (op -> 'payload' ->> 'estimate_hours')::numeric else s.estimate_hours end,
          actual_hours = case when op -> 'payload' ? 'actual_hours' then (op -> 'payload' ->> 'actual_hours')::numeric else s.actual_hours end,
          estimate_pomodoros = case when op -> 'payload' ? 'estimate_pomodoros' then (op -> 'payload' ->> 'estimate_pomodoros')::integer else s.estimate_pomodoros end,
          actual_pomodoros = case when op -> 'payload' ? 'actual_pomodoros' then (op -> 'payload' ->> 'actual_pomodoros')::integer else s.actual_pomodoros end,
          updated_at = now()
        where s.id = (op ->> 'entityId')::uuid
          and exists (select 1 from public.tasks t where t.id = s.task_id and t.workspace_id = target_workspace);
      else
        insert into public.subtasks(
          id, task_id, title, position, created_by, priority, due_at, due_start_at,
          due_is_all_day, due_timezone, assignee_id, cli_assignee
        )
        values (
          (op ->> 'entityId')::uuid,
          (op -> 'payload' ->> 'taskId')::uuid,
          coalesce(op -> 'payload' ->> 'title', ''),
          coalesce((op -> 'payload' ->> 'position')::integer, 0),
          (select auth.uid()),
          coalesce((op -> 'payload' ->> 'priority')::public.task_priority, 'none'),
          (op -> 'payload' ->> 'due_at')::timestamptz,
          (op -> 'payload' ->> 'due_start_at')::timestamptz,
          coalesce((op -> 'payload' ->> 'due_is_all_day')::boolean, false),
          op -> 'payload' ->> 'due_timezone',
          (op -> 'payload' ->> 'assignee_id')::uuid,
          op -> 'payload' ->> 'cli_assignee'
        );
      end if;
    elsif op ->> 'entityType' = 'subtask_schedule' then
      perform public.save_subtask_schedule(
        (op ->> 'entityId')::uuid,
        (op -> 'payload' ->> 'due_at')::timestamptz,
        (op -> 'payload' ->> 'due_start_at')::timestamptz,
        coalesce((op -> 'payload' ->> 'due_is_all_day')::boolean, false),
        op -> 'payload' ->> 'due_timezone',
        coalesce(op -> 'payload' -> 'schedule' -> 'reminders', '[]'::jsonb),
        coalesce((op -> 'payload' -> 'schedule' ->> 'persistent')::boolean, false)
      );
    elsif op ->> 'entityType' = 'task_labels' then
      if coalesce((op -> 'payload' ->> 'selected')::boolean, false) then
        insert into public.task_labels(task_id, label_id)
        values ((op -> 'payload' ->> 'taskId')::uuid, (op -> 'payload' ->> 'labelId')::uuid)
        on conflict do nothing;
      else
        delete from public.task_labels
        where task_id = (op -> 'payload' ->> 'taskId')::uuid
          and label_id = (op -> 'payload' ->> 'labelId')::uuid;
      end if;
    elsif op ->> 'entityType' = 'task_comments' then
      if coalesce((op -> 'payload' ->> 'deleted')::boolean, false) then
        delete from public.task_comments where id = (op ->> 'entityId')::uuid and author_id = (select auth.uid());
      elsif exists (select 1 from public.task_comments c where c.id = (op ->> 'entityId')::uuid) then
        update public.task_comments c set
          body = coalesce(op -> 'payload' ->> 'body', c.body),
          image_uris = case when op -> 'payload' ? 'imageUris'
            then array(select jsonb_array_elements_text(op -> 'payload' -> 'imageUris'))
            else c.image_uris end,
          updated_at = now()
        where c.id = (op ->> 'entityId')::uuid and c.author_id = (select auth.uid());
      else
        insert into public.task_comments(id, workspace_id, task_id, subtask_id, author_id, body, image_uris)
        values (
          (op ->> 'entityId')::uuid, target_workspace, (op -> 'payload' ->> 'taskId')::uuid,
          (op -> 'payload' ->> 'subtaskId')::uuid,
          (select auth.uid()), coalesce(op -> 'payload' ->> 'body', ''),
          case when op -> 'payload' ? 'imageUris'
            then array(select jsonb_array_elements_text(op -> 'payload' -> 'imageUris'))
            else array[]::text[] end
        );
        if jsonb_typeof(op -> 'payload' -> 'mentionedUserIds') = 'array' then
          insert into public.task_comment_mentions(comment_id, user_id, display_name_snapshot)
          select (op ->> 'entityId')::uuid, member.user_id,
            coalesce(profile.display_name, '团队成员')
          from jsonb_array_elements_text(op -> 'payload' -> 'mentionedUserIds') mention
          join public.workspace_members member
            on member.workspace_id = target_workspace and member.user_id = mention.value::uuid
          left join public.profiles profile on profile.id = member.user_id
          on conflict do nothing;
        end if;
      end if;
    end if;
    existing := jsonb_build_object('operationId', op ->> 'operationId', 'status', 'applied');
    insert into anttodo_private.client_applied_operations(operation_id, user_id, workspace_id, result)
      values ((op ->> 'operationId')::uuid, (select auth.uid()), target_workspace, existing);
    result := result || jsonb_build_array(existing);
  end loop;
  return result;
end;
$$;
