create or replace function anttodo_private.record_task_core_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  changes jsonb := '{}'::jsonb;
begin
  if old.title is distinct from new.title then
    changes := changes || jsonb_build_object('title', jsonb_build_object('before', old.title, 'after', new.title));
  end if;
  if old.description is distinct from new.description then
    changes := changes || jsonb_build_object('description', jsonb_build_object('before', old.description, 'after', new.description));
  end if;
  if old.kind is distinct from new.kind then
    changes := changes || jsonb_build_object('kind', jsonb_build_object('before', old.kind, 'after', new.kind));
  end if;
  if old.status is distinct from new.status then
    changes := changes || jsonb_build_object('status', jsonb_build_object('before', old.status, 'after', new.status));
  end if;
  if old.priority is distinct from new.priority then
    changes := changes || jsonb_build_object('priority', jsonb_build_object('before', old.priority, 'after', new.priority));
  end if;
  if old.due_at is distinct from new.due_at then
    changes := changes || jsonb_build_object('due_at', jsonb_build_object('before', old.due_at, 'after', new.due_at));
  end if;
  if old.due_start_at is distinct from new.due_start_at then
    changes := changes || jsonb_build_object('due_start_at', jsonb_build_object('before', old.due_start_at, 'after', new.due_start_at));
  end if;
  if old.due_is_all_day is distinct from new.due_is_all_day then
    changes := changes || jsonb_build_object('due_is_all_day', jsonb_build_object('before', old.due_is_all_day, 'after', new.due_is_all_day));
  end if;
  if old.due_timezone is distinct from new.due_timezone then
    changes := changes || jsonb_build_object('due_timezone', jsonb_build_object('before', old.due_timezone, 'after', new.due_timezone));
  end if;
  if old.deleted_at is distinct from new.deleted_at then
    changes := changes || jsonb_build_object('deleted_at', jsonb_build_object('before', old.deleted_at, 'after', new.deleted_at));
  end if;

  if changes <> '{}'::jsonb then
    insert into public.activity_events(workspace_id, task_id, actor_id, event_type, payload)
    values (new.workspace_id, new.id, (select auth.uid()), 'task.updated', jsonb_build_object('changes', changes));
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_record_core_changes on public.tasks;
create trigger tasks_record_core_changes
after update on public.tasks
for each row execute function anttodo_private.record_task_core_changes();

create or replace function anttodo_private.snapshot_task_creation_activity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.event_type = 'task.created' and not (new.payload ? 'title') then
    new.payload := new.payload || jsonb_build_object(
      'title', (select t.title from public.tasks t where t.id = new.task_id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists activity_events_snapshot_task_creation on public.activity_events;
create trigger activity_events_snapshot_task_creation
before insert on public.activity_events
for each row execute function anttodo_private.snapshot_task_creation_activity();

create or replace function anttodo_private.record_task_label_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_task_id uuid := coalesce(new.task_id, old.task_id);
  selected_label_id uuid := coalesce(new.label_id, old.label_id);
  selected_workspace_id uuid;
  selected_label_name text;
  selected_label_color text;
begin
  select t.workspace_id into selected_workspace_id from public.tasks t where t.id = selected_task_id;
  if selected_workspace_id is null then return coalesce(new, old); end if;
  select l.name, l.color into selected_label_name, selected_label_color
  from public.labels l where l.id = selected_label_id;

  insert into public.activity_events(workspace_id, task_id, actor_id, event_type, payload)
  values (
    selected_workspace_id,
    selected_task_id,
    (select auth.uid()),
    case when tg_op = 'INSERT' then 'task.label_added' else 'task.label_removed' end,
    jsonb_build_object(
      'label_id', selected_label_id,
      'label_name', coalesce(selected_label_name, '标签'),
      'label_color', coalesce(selected_label_color, '#8f959e')
    )
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists task_labels_record_activity on public.task_labels;
create trigger task_labels_record_activity
after insert or delete on public.task_labels
for each row execute function anttodo_private.record_task_label_change();

create or replace function anttodo_private.record_subtask_activity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_task_id uuid := coalesce(new.task_id, old.task_id);
  selected_workspace_id uuid;
  changes jsonb := '{}'::jsonb;
  selected_event_type text;
  selected_payload jsonb;
begin
  select t.workspace_id into selected_workspace_id from public.tasks t where t.id = selected_task_id;
  if selected_workspace_id is null then return coalesce(new, old); end if;

  if tg_op = 'INSERT' then
    selected_event_type := 'task.subtask_created';
    selected_payload := jsonb_build_object('subtask_id', new.id, 'title', new.title, 'completed', new.completed);
  elsif tg_op = 'DELETE' then
    selected_event_type := 'task.subtask_deleted';
    selected_payload := jsonb_build_object('subtask_id', old.id, 'title', old.title, 'completed', old.completed);
  else
    if old.title is distinct from new.title then
      changes := changes || jsonb_build_object('title', jsonb_build_object('before', old.title, 'after', new.title));
    end if;
    if old.completed is distinct from new.completed then
      changes := changes || jsonb_build_object('completed', jsonb_build_object('before', old.completed, 'after', new.completed));
    end if;
    if (to_jsonb(old)->'due_at') is distinct from (to_jsonb(new)->'due_at') then
      changes := changes || jsonb_build_object('due_at', jsonb_build_object(
        'before', to_jsonb(old)->'due_at', 'after', to_jsonb(new)->'due_at'
      ));
    end if;
    if (to_jsonb(old)->'assignee_id') is distinct from (to_jsonb(new)->'assignee_id') then
      changes := changes || jsonb_build_object('assignee_id', jsonb_build_object(
        'before', to_jsonb(old)->'assignee_id', 'after', to_jsonb(new)->'assignee_id'
      ));
    end if;
    if changes = '{}'::jsonb then return new; end if;
    selected_event_type := 'task.subtask_updated';
    selected_payload := jsonb_build_object('subtask_id', new.id, 'title', new.title, 'changes', changes);
  end if;

  insert into public.activity_events(workspace_id, task_id, actor_id, event_type, payload)
  values (selected_workspace_id, selected_task_id, (select auth.uid()), selected_event_type, selected_payload);
  return coalesce(new, old);
end;
$$;

drop trigger if exists subtasks_record_activity on public.subtasks;
create trigger subtasks_record_activity
after insert or update or delete on public.subtasks
for each row execute function anttodo_private.record_subtask_activity();

create or replace function public.save_task_schedule(
  p_task_id uuid,
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
  v_rule jsonb;
  v_position integer;
  v_local_time time;
  v_workspace_id uuid;
  v_before jsonb;
  v_after jsonb;
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

  select t.workspace_id into v_workspace_id from public.tasks t where t.id = p_task_id;
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

  if v_before is distinct from v_after then
    insert into public.activity_events(workspace_id, task_id, actor_id, event_type, payload)
    values (v_workspace_id, p_task_id, (select auth.uid()), 'task.reminders_changed', jsonb_build_object('before', v_before, 'after', v_after));
  end if;

  return query select * from public.task_reminders
    where task_id = p_task_id order by position;
end;
$$;

revoke all on function public.save_task_schedule(
  uuid, timestamptz, timestamptz, boolean, text, jsonb, boolean
) from public, anon;
grant execute on function public.save_task_schedule(
  uuid, timestamptz, timestamptz, boolean, text, jsonb, boolean
) to authenticated;

create or replace function public.list_task_activity(
  p_task_id uuid,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50
)
returns setof public.activity_events
language sql
stable
security invoker
set search_path = ''
as $$
  select ae.*
  from public.activity_events ae
  where ae.task_id = p_task_id
    and (
      p_before_created_at is null
      or (ae.created_at, ae.id) < (p_before_created_at, p_before_id)
    )
  order by ae.created_at desc, ae.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

revoke all on function public.list_task_activity(uuid, timestamptz, uuid, integer)
from public, anon;
grant execute on function public.list_task_activity(uuid, timestamptz, uuid, integer)
to authenticated;
