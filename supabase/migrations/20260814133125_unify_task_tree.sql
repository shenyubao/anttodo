begin;

-- This is an intentionally breaking migration. Keep every check and rewrite in
-- one transaction so production can safely abort before any old client shape is
-- removed.
lock table public.tasks in access exclusive mode;
lock table public.subtasks in access exclusive mode;
lock table public.task_comments in access exclusive mode;
lock table public.focus_sessions in access exclusive mode;
lock table public.task_dependencies in access exclusive mode;
lock table public.task_reminders in access exclusive mode;

do $migration_preflight$
declare
  bad_id uuid;
begin
  select s.id into bad_id
  from public.subtasks s join public.tasks t on t.id = s.id
  limit 1;
  if bad_id is not null then
    raise exception 'Task tree migration aborted: UUID % exists in tasks and subtasks', bad_id;
  end if;

  select s.id into bad_id
  from public.subtasks s
  left join public.tasks t on t.id = s.task_id
  left join public.subtasks p on p.id = s.parent_subtask_id
  where t.id is null
     or (s.parent_subtask_id is not null and p.id is null)
     or (p.id is not null and p.task_id <> s.task_id)
  limit 1;
  if bad_id is not null then
    raise exception 'Task tree migration aborted: orphan or cross-root record %', bad_id;
  end if;

  with recursive ancestry as (
    select s.id as origin, s.id, s.parent_subtask_id, array[s.id] as path, false as cycle
    from public.subtasks s
    union all
    select a.origin, p.id, p.parent_subtask_id, a.path || p.id, p.id = any(a.path)
    from ancestry a
    join public.subtasks p on p.id = a.parent_subtask_id
    where not a.cycle
  )
  select origin into bad_id from ancestry where cycle limit 1;
  if bad_id is not null then
    raise exception 'Task tree migration aborted: cycle detected at %', bad_id;
  end if;

  with recursive depths as (
    select s.id, 2 as depth
    from public.subtasks s where s.parent_subtask_id is null
    union all
    select s.id, d.depth + 1
    from public.subtasks s join depths d on d.id = s.parent_subtask_id
  )
  select id into bad_id from depths where depth > 5 limit 1;
  if bad_id is not null then
    raise exception 'Task tree migration aborted: task % exceeds five levels', bad_id;
  end if;
end
$migration_preflight$;

alter table public.tasks
  add column parent_task_id uuid,
  add column position integer not null default 0;

insert into public.tasks (
  id, workspace_id, title, description, status, priority,
  due_at, assignee_id, created_by, completed_at, deleted_at, version,
  created_at, updated_at, due_start_at, due_is_all_day, due_timezone,
  kind, recurrence, cli_assignee, estimate_hours, actual_hours,
  estimate_pomodoros, actual_pomodoros, parent_task_id, position
)
select
  s.id, t.workspace_id, s.title, s.description,
  case when s.completed then 'completed'::public.task_status else 'open'::public.task_status end,
  s.priority, s.due_at, s.assignee_id, s.created_by,
  case when s.completed then s.updated_at else null end,
  null, s.version, s.created_at, s.updated_at, s.due_start_at,
  s.due_is_all_day, s.due_timezone, 'todo'::public.task_kind, null,
  s.cli_assignee, s.estimate_hours, s.actual_hours,
  s.estimate_pomodoros, s.actual_pomodoros,
  coalesce(s.parent_subtask_id, s.task_id), s.position
from public.subtasks s
join public.tasks t on t.id = s.task_id;

alter table public.tasks
  add constraint tasks_parent_task_id_fkey
  foreign key (parent_task_id) references public.tasks(id) on delete cascade,
  add constraint tasks_not_own_parent check (parent_task_id is distinct from id),
  add constraint tasks_root_position_check check (position >= 0);

create index tasks_workspace_roots_page_idx
  on public.tasks(workspace_id, updated_at desc, id)
  where parent_task_id is null;
create index tasks_parent_position_idx
  on public.tasks(parent_task_id, position, created_at, id)
  where parent_task_id is not null;

-- Existing objects stay in place. Their authorization follows a private binding
-- to the actual task instead of the historical root encoded in the object path.
create table anttodo_private.task_attachment_bindings (
  bucket_id text not null,
  object_name text not null,
  task_id uuid not null references public.tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (bucket_id, object_name)
);
create index task_attachment_bindings_task_idx
  on anttodo_private.task_attachment_bindings(task_id);
revoke all on anttodo_private.task_attachment_bindings from public, anon, authenticated;

insert into anttodo_private.task_attachment_bindings(bucket_id, object_name, task_id)
select distinct
  'comment-images',
  regexp_replace(uri, '^anttodo-storage://comment-images/', ''),
  c.subtask_id
from public.task_comments c
cross join lateral unnest(c.image_uris) uri
where c.subtask_id is not null
  and uri like 'anttodo-storage://comment-images/%'
on conflict (bucket_id, object_name) do update set task_id = excluded.task_id;

insert into anttodo_private.task_attachment_bindings(bucket_id, object_name, task_id)
select distinct
  'task-attachments',
  match[1],
  s.id
from public.subtasks s
cross join lateral regexp_matches(
  s.description,
  'anttodo-storage://task-attachments/([^[:space:]<>\)]+)',
  'g'
) match
on conflict (bucket_id, object_name) do update set task_id = excluded.task_id;

-- Repoint every relationship before the old table is removed.
drop trigger if exists focus_sessions_validate on public.focus_sessions;
drop trigger if exists task_reminders_subtask_parent on public.task_reminders;
drop trigger if exists task_reminders_bump_task_version on public.task_reminders;
drop trigger if exists task_reminder_settings_bump_task_version on public.task_reminder_settings;
drop trigger if exists task_dependencies_validate on public.task_dependencies;
drop trigger if exists task_comments_client_version on public.task_comments;
drop trigger if exists task_comments_client_change_log on public.task_comments;
update public.task_comments set task_id = subtask_id where subtask_id is not null;
update public.focus_sessions set task_id = subtask_id where subtask_id is not null;
update public.task_reminders set task_id = subtask_id where subtask_id is not null;
update public.task_dependencies
set task_id = coalesce(subtask_id, task_id),
    depends_on_task_id = coalesce(depends_on_subtask_id, depends_on_task_id);

alter table public.task_comments drop column subtask_id;
alter table public.focus_sessions drop constraint if exists focus_sessions_subtask_requires_task;
alter table public.focus_sessions drop column subtask_id;
drop trigger if exists task_reminders_subtask_parent on public.task_reminders;
alter table public.task_reminders drop constraint if exists task_reminders_scope_position_key;
alter table public.task_reminders drop constraint if exists task_reminders_scope_rule_key;
alter table public.task_reminders drop column subtask_id;
alter table public.task_reminders
  add constraint task_reminders_task_position_key unique(task_id, position),
  add constraint task_reminders_task_rule_key
    unique nulls not distinct(task_id, anchor, offset_value, offset_unit, local_time);

alter table public.task_dependencies drop constraint if exists task_dependencies_not_self;
drop index if exists public.task_dependencies_unique_idx;
alter table public.task_dependencies drop column subtask_id;
alter table public.task_dependencies drop column depends_on_subtask_id;
delete from public.task_dependencies a
using public.task_dependencies b
where a.id > b.id
  and a.task_id = b.task_id
  and a.depends_on_task_id = b.depends_on_task_id;
alter table public.task_dependencies
  add constraint task_dependencies_not_self check(task_id <> depends_on_task_id),
  add constraint task_dependencies_unique unique(task_id, depends_on_task_id);
drop index if exists public.task_dependencies_task_idx;
drop index if exists public.task_dependencies_depends_on_idx;
create index task_dependencies_task_idx on public.task_dependencies(task_id, position);
create index task_dependencies_depends_on_idx on public.task_dependencies(depends_on_task_id);

create trigger task_reminders_bump_task_version
after insert or update or delete on public.task_reminders
for each row execute function anttodo_private.bump_parent_task_version();
create trigger task_comments_client_version
before update on public.task_comments
for each row execute function anttodo_private.bump_client_version();
create trigger task_comments_client_change_log
after insert or update or delete on public.task_comments
for each row execute function anttodo_private.record_client_change();

insert into public.task_reminder_settings(task_id, persistent, updated_by, created_at, updated_at)
select s.subtask_id, s.persistent, s.updated_by, s.created_at, s.updated_at
from public.subtask_reminder_settings s
on conflict (task_id) do update
set persistent = public.task_reminder_settings.persistent or excluded.persistent,
    updated_by = case
      when excluded.updated_at >= public.task_reminder_settings.updated_at then excluded.updated_by
      else public.task_reminder_settings.updated_by
    end,
    updated_at = greatest(public.task_reminder_settings.updated_at, excluded.updated_at);
create trigger task_reminder_settings_bump_task_version
after insert or update or delete on public.task_reminder_settings
for each row execute function anttodo_private.bump_parent_task_version();

-- Normalize historical generic events and notification payloads.
update public.activity_events
set task_id = coalesce(nullif(payload->>'subtask_id', '')::uuid, task_id),
    event_type = case event_type
      when 'task.subtask_created' then 'task.created'
      when 'task.subtask_updated' then 'task.updated'
      when 'task.subtask_deleted' then 'task.deleted'
      else replace(event_type, 'subtask', 'task')
    end,
    payload = (payload - 'subtask_id' - 'parent_subtask_id' - 'completed')
      || case
        when payload ? 'subtask_id' then jsonb_build_object('task_id', payload->'subtask_id')
        else '{}'::jsonb
      end
      || case
        when payload ? 'parent_subtask_id' then jsonb_build_object('parent_task_id', payload->'parent_subtask_id')
        else '{}'::jsonb
      end
      || case
        when payload ? 'completed' then jsonb_build_object(
          'status', case when (payload->>'completed')::boolean then 'completed' else 'open' end
        )
        else '{}'::jsonb
      end
where event_type like '%subtask%' or payload ? 'subtask_id' or payload ? 'parent_subtask_id';

update public.activity_events
set payload = jsonb_set(
  payload #- '{changes,completed}',
  '{changes,status}',
  jsonb_build_object(
    'before',case when payload #> '{changes,completed}' ? 'before'
      then case when (payload #>> '{changes,completed,before}')::boolean then 'completed' else 'open' end
      else null end,
    'after',case when (payload #>> '{changes,completed,after}')::boolean then 'completed' else 'open' end
  ),
  true
)
where payload #> '{changes,completed}' is not null;

update public.notifications
set notification_type = case notification_type
      when 'participant_subtask_created' then 'participant_task_created'
      when 'participant_subtask_status_changed' then 'participant_status_changed'
      when 'participant_subtask_title_changed' then 'participant_title_changed'
      else notification_type
    end,
    task_id = coalesce(nullif(payload->>'subtask_id', '')::uuid, task_id),
    payload = (payload - 'subtask_id') || case
      when payload ? 'subtask_id' then jsonb_build_object('task_id', payload->'subtask_id')
      else '{}'::jsonb
    end;

update anttodo_private.notification_dispatch_buffer
set notification_type = case notification_type
      when 'participant_subtask_created' then 'participant_task_created'
      when 'participant_subtask_status_changed' then 'participant_status_changed'
      when 'participant_subtask_title_changed' then 'participant_title_changed'
      else notification_type
    end,
    task_id = coalesce(nullif(payload->>'subtask_id', '')::uuid, task_id),
    payload = (payload - 'subtask_id') || case
      when payload ? 'subtask_id' then jsonb_build_object('task_id', payload->'subtask_id')
      else '{}'::jsonb
    end;

alter table public.notifications drop constraint notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check check (
  notification_type = any(array[
    'comment_mention','todo_mentioned','task_assigned','task_new_comment',
    'note_mentioned','participant_added','participant_title_changed',
    'participant_status_changed','participant_new_comment','participant_task_created'
  ])
);

-- Preserve the most conservative setting when the old and new scenarios merge.
insert into public.user_notification_preferences(user_id, scenario, system_enabled, dingtalk_enabled, updated_at)
select user_id,
  case scenario
    when 'participant_subtask_created' then 'participant_task_created'
    when 'participant_subtask_status_changed' then 'participant_status_changed'
    when 'participant_subtask_title_changed' then 'participant_title_changed'
  end,
  bool_and(system_enabled), bool_and(dingtalk_enabled), max(updated_at)
from public.user_notification_preferences
where scenario like 'participant_subtask_%'
group by user_id, 2
on conflict (user_id, scenario) do update
set system_enabled = public.user_notification_preferences.system_enabled and excluded.system_enabled,
    dingtalk_enabled = public.user_notification_preferences.dingtalk_enabled and excluded.dingtalk_enabled,
    updated_at = greatest(public.user_notification_preferences.updated_at, excluded.updated_at);
delete from public.user_notification_preferences where scenario like 'participant_subtask_%';
alter table public.user_notification_preferences drop constraint user_notification_preferences_scenario_check;
alter table public.user_notification_preferences add constraint user_notification_preferences_scenario_check check (
  scenario = any(array[
    'task_assigned','task_due_reminder','task_new_comment','note_mentioned',
    'todo_mentioned','participant_added','participant_title_changed',
    'participant_status_changed','participant_new_comment','participant_task_created'
  ])
);

alter table public.user_ai_feature_settings
  rename column subtask_decompose_enabled to task_decompose_enabled;
alter table public.user_ai_feature_settings
  rename column subtask_decompose_prompt_override to task_decompose_prompt_override;
alter table public.user_ai_feature_settings
  rename constraint user_ai_feature_settings_decompose_prompt_check
  to user_ai_feature_settings_task_decompose_prompt_check;

update public.client_sync_conflicts
set entity_type = case when entity_type = 'subtasks' then 'tasks' else entity_type end,
    local_payload = (local_payload - 'subtask_id' - 'subtaskId')
      || case when local_payload ? 'subtask_id' then jsonb_build_object('task_id', local_payload->'subtask_id') else '{}'::jsonb end
      || case when local_payload ? 'subtaskId' then jsonb_build_object('taskId', local_payload->'subtaskId') else '{}'::jsonb end,
    remote_payload = (remote_payload - 'subtask_id' - 'subtaskId')
      || case when remote_payload ? 'subtask_id' then jsonb_build_object('task_id', remote_payload->'subtask_id') else '{}'::jsonb end
      || case when remote_payload ? 'subtaskId' then jsonb_build_object('taskId', remote_payload->'subtaskId') else '{}'::jsonb end;

-- Old cursors must only observe snapshots in the unified shape.
delete from anttodo_private.client_change_log;
insert into anttodo_private.client_change_log(
  workspace_id, entity_type, entity_id, operation, version, payload, changed_by
)
select t.workspace_id, 'tasks', t.id, 'upsert', t.version, to_jsonb(t), null
from public.tasks t;

-- Tree and authorization helpers deliberately resolve labels through the root.
create or replace function anttodo_private.task_root_id(target_task uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  with recursive ancestors as (
    select t.id, t.parent_task_id, array[t.id] path
    from public.tasks t where t.id = target_task
    union all
    select p.id, p.parent_task_id, a.path || p.id
    from ancestors a join public.tasks p on p.id = a.parent_task_id
    where not p.id = any(a.path)
  )
  select id from ancestors where parent_task_id is null limit 1
$$;
revoke all on function anttodo_private.task_root_id(uuid) from public, anon, authenticated;

create or replace function anttodo_private.can_user_view_task(target_task uuid, target_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select target_user is not null
    and exists (
      select 1 from public.tasks t
      join public.workspace_members wm on wm.workspace_id=t.workspace_id and wm.user_id=target_user
      where t.id=target_task
    )
    and not exists (
      select 1 from public.task_labels tl
      where tl.task_id=anttodo_private.task_root_id(target_task)
        and anttodo_private.label_permission_level_for_user(tl.label_id,target_user)<1
    )
$$;

create or replace function anttodo_private.can_view_task(target_task uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and exists(select 1 from public.tasks t where t.id=target_task and anttodo_private.is_workspace_member(t.workspace_id))
    and not exists(
      select 1 from public.task_labels tl
      where tl.task_id=anttodo_private.task_root_id(target_task)
        and anttodo_private.label_permission_level(tl.label_id)<1
    )
$$;

create or replace function anttodo_private.can_edit_task(target_task uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.tasks t
      join public.tasks r on r.id=anttodo_private.task_root_id(t.id)
      where t.id=target_task
        and (
          t.created_by=(select auth.uid()) or t.assignee_id=(select auth.uid())
          or r.created_by=(select auth.uid()) or r.assignee_id=(select auth.uid())
          or anttodo_private.is_workspace_admin(t.workspace_id)
          or exists(select 1 from public.task_labels tl where tl.task_id=r.id)
        )
    )
    and not exists(
      select 1 from public.task_labels tl
      where tl.task_id=anttodo_private.task_root_id(target_task)
        and anttodo_private.label_permission_level(tl.label_id)<2
    )
$$;

-- Root participants follow the whole tree while each exact task may add its own
-- participants. Existing comment/title/status triggers call this function.
create or replace function anttodo_private.notify_task_participants(
  p_workspace_id uuid,
  p_task_id uuid,
  p_actor_id uuid,
  p_notification_type text,
  p_payload jsonb default '{}'::jsonb,
  p_dedupe_prefix text default null,
  p_exclude_user_ids uuid[] default array[]::uuid[]
) returns void language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid; v_root_id uuid;
begin
  v_root_id := anttodo_private.task_root_id(p_task_id);
  for v_user_id in
    select distinct tp.user_id
    from public.task_participants tp
    where tp.task_id in (p_task_id,v_root_id)
      and tp.user_id is distinct from p_actor_id
      and not (tp.user_id=any(coalesce(p_exclude_user_ids,array[]::uuid[])))
  loop
    perform anttodo_private.create_app_notification(
      p_workspace_id,p_task_id,v_user_id,p_actor_id,p_notification_type,null,p_payload,
      case when p_dedupe_prefix is null then null else p_dedupe_prefix||':'||v_user_id::text end
    );
  end loop;
end $$;

create or replace function anttodo_private.notify_nested_task_created()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid());
begin
  if new.parent_task_id is not null and v_actor is not null then
    insert into public.activity_events(workspace_id,task_id,actor_id,event_type,payload)
    values(new.workspace_id,new.id,v_actor,'task.created',jsonb_build_object('title',new.title,'parent_task_id',new.parent_task_id));
    perform anttodo_private.notify_task_participants(
      new.workspace_id,new.id,v_actor,'participant_task_created',
      jsonb_build_object('task_id',new.id,'parent_task_id',new.parent_task_id,'title',new.title),
      'taskcreate:'||new.id::text
    );
  end if;
  return new;
end $$;
drop trigger if exists tasks_notify_nested_created on public.tasks;
create trigger tasks_notify_nested_created after insert on public.tasks
for each row execute function anttodo_private.notify_nested_task_created();

create or replace function anttodo_private.validate_task_tree()
returns trigger language plpgsql set search_path = '' as $$
declare parent_row public.tasks; depth integer; subtree_height integer;
begin
  if new.kind = 'note' and exists(select 1 from public.tasks where parent_task_id=new.id) then
    raise exception 'Notes cannot contain child tasks';
  end if;
  if new.parent_task_id is null then
    return new;
  end if;
  if new.kind <> 'todo' then raise exception 'Only todo tasks can have a parent'; end if;
  if new.parent_task_id = new.id then raise exception 'A task cannot be its own parent'; end if;
  select * into parent_row from public.tasks where id=new.parent_task_id for key share;
  if not found then raise exception 'Parent task does not exist'; end if;
  if parent_row.workspace_id <> new.workspace_id then raise exception 'Parent task must be in the same workspace'; end if;
  if parent_row.kind <> 'todo' then raise exception 'Notes cannot contain child tasks'; end if;
  with recursive ancestors as (
    select t.id,t.parent_task_id,1 d,array[t.id] path from public.tasks t where t.id=new.parent_task_id
    union all
    select p.id,p.parent_task_id,a.d+1,a.path||p.id
    from ancestors a join public.tasks p on p.id=a.parent_task_id
    where not p.id=any(a.path)
  ) select max(d)+1 into depth from ancestors;
  if exists(
    with recursive ancestors as (
      select t.id,t.parent_task_id from public.tasks t where t.id=new.parent_task_id
      union all select p.id,p.parent_task_id from ancestors a join public.tasks p on p.id=a.parent_task_id
    ) select 1 from ancestors where id=new.id
  ) then raise exception 'Task tree cycle detected'; end if;
  with recursive descendants as (
    select t.id,1 d from public.tasks t where t.id=new.id
    union all select c.id,d.d+1 from public.tasks c join descendants d on c.parent_task_id=d.id
  ) select coalesce(max(d),1) into subtree_height from descendants;
  if depth + subtree_height - 1 > 5 then raise exception 'Task tree cannot exceed five levels'; end if;
  return new;
end $$;
create trigger tasks_validate_tree before insert or update of parent_task_id,workspace_id,kind
on public.tasks for each row execute function anttodo_private.validate_task_tree();

create or replace function anttodo_private.validate_root_task_label()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists(select 1 from public.tasks where id=new.task_id and parent_task_id is not null) then
    raise exception 'Labels can only be assigned to root tasks';
  end if;
  return new;
end $$;
create trigger task_labels_validate_root before insert or update of task_id
on public.task_labels for each row execute function anttodo_private.validate_root_task_label();

create or replace function anttodo_private.validate_task_reference()
returns trigger language plpgsql set search_path = '' as $$
declare actual_workspace uuid;
begin
  select workspace_id into actual_workspace from public.tasks where id=new.task_id;
  if actual_workspace is null then raise exception 'Task does not exist'; end if;
  if to_jsonb(new) ? 'workspace_id' and new.workspace_id <> actual_workspace then
    raise exception 'Task and record must belong to the same workspace';
  end if;
  return new;
end $$;

create or replace function anttodo_private.validate_task_dependency()
returns trigger language plpgsql set search_path = '' as $$
declare from_workspace uuid; to_workspace uuid;
begin
  if new.created_by is null then new.created_by := (select auth.uid()); end if;
  select workspace_id into from_workspace from public.tasks where id=new.task_id;
  select workspace_id into to_workspace from public.tasks where id=new.depends_on_task_id;
  if from_workspace is null or to_workspace is null or from_workspace<>to_workspace or new.workspace_id<>from_workspace then
    raise exception 'Dependencies must reference tasks in the same workspace';
  end if;
  if new.task_id=new.depends_on_task_id then
    raise exception 'A task cannot depend on itself' using errcode='23514';
  end if;
  if exists(
    with recursive chain(id) as (
      select new.depends_on_task_id
      union
      select d.depends_on_task_id from public.task_dependencies d join chain c on d.task_id=c.id
    ) select 1 from chain where id=new.task_id
  ) then raise exception 'Task dependency cycle detected' using errcode='23514'; end if;
  return new;
end $$;

drop trigger if exists task_comments_validate on public.task_comments;
create trigger task_comments_validate before insert or update of task_id,workspace_id
on public.task_comments for each row execute function anttodo_private.validate_task_reference();
drop trigger if exists focus_sessions_validate on public.focus_sessions;
create trigger focus_sessions_validate before insert or update of task_id,workspace_id
on public.focus_sessions for each row when (new.task_id is not null)
execute function anttodo_private.validate_task_reference();
drop trigger if exists task_dependencies_validate on public.task_dependencies;
create trigger task_dependencies_validate before insert or update on public.task_dependencies
for each row execute function anttodo_private.validate_task_dependency();

-- RLS policies call the root-aware helpers and UPDATE retains both clauses.
drop policy if exists tasks_select on public.tasks;
drop policy if exists tasks_insert on public.tasks;
drop policy if exists tasks_update on public.tasks;
drop policy if exists tasks_delete on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using ((select anttodo_private.can_view_task(id)));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (
    created_by=(select auth.uid())
    and assignee_id is null and cli_assignee is null
    and (select anttodo_private.is_workspace_member(workspace_id))
    and (parent_task_id is null or (select anttodo_private.can_edit_task(parent_task_id)))
  );
create policy tasks_update on public.tasks for update to authenticated
  using ((select anttodo_private.can_edit_task(id)))
  with check ((select anttodo_private.can_edit_task(id)));
create policy tasks_delete on public.tasks for delete to authenticated
  using (deleted_at is not null and (select anttodo_private.can_edit_task(id)));

-- Atomic reparenting also owns label transfer and list placement cleanup.
create or replace function public.move_task(
  p_task_id uuid,
  p_parent_task_id uuid default null,
  p_position integer default 0
) returns public.tasks language plpgsql security definer set search_path = '' as $$
declare moving public.tasks; destination public.tasks; old_root uuid; new_root uuid;
  conflict_users uuid[]; result public.tasks; promote_to_root boolean;
begin
  select * into moving from public.tasks where id=p_task_id for update;
  if not found then raise exception 'Task does not exist'; end if;
  if moving.deleted_at is not null then raise exception 'Deleted tasks cannot be moved'; end if;
  if not anttodo_private.can_edit_task(moving.id) then raise exception 'Task is not editable'; end if;
  old_root := anttodo_private.task_root_id(moving.id);
  if p_parent_task_id is not null then
    select * into destination from public.tasks where id=p_parent_task_id for update;
    if not found then raise exception 'Parent task does not exist'; end if;
    if not anttodo_private.can_edit_task(destination.id) then raise exception 'Destination is not editable'; end if;
    new_root := anttodo_private.task_root_id(destination.id);
    with recursive tree as (
      select id,assignee_id from public.tasks where id=moving.id
      union all select t.id,t.assignee_id from public.tasks t join tree x on t.parent_task_id=x.id
    ), people as (
      select assignee_id user_id from tree where assignee_id is not null
      union select tp.user_id from public.task_participants tp join tree on tree.id=tp.task_id
    )
    select array_agg(user_id) into conflict_users from people
    where not anttodo_private.can_user_view_task(new_root,user_id);
    if cardinality(conflict_users)>0 then
      raise exception using message='Move would remove task visibility', detail=array_to_string(conflict_users,',');
    end if;
  else new_root := moving.id;
  end if;

  promote_to_root := p_parent_task_id is null and moving.parent_task_id is not null;
  if p_parent_task_id is not null and moving.parent_task_id is null then
    delete from public.task_labels where task_id=moving.id;
    delete from public.task_list_placements where task_id=moving.id;
  end if;
  update public.tasks
  set position=position-1
  where parent_task_id is not distinct from moving.parent_task_id
    and id<>moving.id and position>moving.position;
  update public.tasks
  set position=position+1
  where parent_task_id is not distinct from p_parent_task_id
    and id<>moving.id and position>=greatest(p_position,0);
  update public.tasks set parent_task_id=p_parent_task_id, position=greatest(p_position,0) where id=moving.id returning * into result;
  if promote_to_root then
    insert into public.task_labels(task_id,label_id)
    select moving.id,label_id from public.task_labels where task_id=old_root on conflict do nothing;
  end if;
  return result;
end $$;
revoke all on function public.move_task(uuid,uuid,integer) from public, anon;
grant execute on function public.move_task(uuid,uuid,integer) to authenticated;

create or replace function anttodo_private.reminder_trigger_at(
  p_task_id uuid,
  p_anchor text,
  p_offset_value integer,
  p_offset_unit text,
  p_local_time time
) returns timestamptz language plpgsql stable security definer set search_path = '' as $$
declare v_task public.tasks%rowtype; v_anchor timestamptz; v_minutes integer; v_days integer; v_zone text;
begin
  select * into strict v_task from public.tasks where id=p_task_id;
  v_anchor := case when p_anchor='end' then v_task.due_at else coalesce(v_task.due_start_at,v_task.due_at) end;
  if v_anchor is null then raise exception 'A due date is required before reminders can be saved'; end if;
  if p_local_time is not null then
    v_zone := coalesce(v_task.due_timezone,'UTC');
    v_days := p_offset_value * case when p_offset_unit='week' then 7 else 1 end;
    return (((v_anchor at time zone v_zone)::date-v_days)+p_local_time) at time zone v_zone;
  end if;
  v_minutes := p_offset_value * case p_offset_unit
    when 'minute' then 1 when 'hour' then 60 when 'day' then 1440 when 'week' then 10080 end;
  return v_anchor-make_interval(mins=>v_minutes);
end $$;

create or replace function anttodo_private.on_task_schedule_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.due_at is null or new.status<>'open' or new.deleted_at is not null then
    update public.reminder_delivery_states d set cancelled_at=coalesce(cancelled_at,now())
    from public.task_reminders r
    where r.task_id=new.id and d.reminder_id=r.id and d.acknowledged_at is null;
    if new.due_at is null then
      delete from public.task_reminders where task_id=new.id;
      delete from public.task_reminder_settings where task_id=new.id;
    end if;
    return new;
  end if;
  if old.due_at is distinct from new.due_at
    or old.due_start_at is distinct from new.due_start_at
    or old.due_is_all_day is distinct from new.due_is_all_day
    or old.due_timezone is distinct from new.due_timezone then
    update public.task_reminders r set trigger_at=anttodo_private.reminder_trigger_at(
      r.task_id,r.anchor,r.offset_value,r.offset_unit,r.local_time
    ) where r.task_id=new.id;
    update public.reminder_delivery_states d set cancelled_at=coalesce(cancelled_at,now())
    from public.task_reminders r
    where r.task_id=new.id and d.reminder_id=r.id
      and d.scheduled_for is distinct from r.trigger_at and d.acknowledged_at is null;
  end if;
  return new;
end $$;

create or replace function public.save_task_schedule(
  p_task_id uuid,
  p_due_at timestamptz,
  p_due_start_at timestamptz,
  p_due_is_all_day boolean,
  p_due_timezone text,
  p_reminders jsonb default '[]'::jsonb,
  p_persistent boolean default false,
  p_recurrence jsonb default null
) returns setof public.task_reminders language plpgsql security definer set search_path = '' as $$
declare rule jsonb; rule_position integer; rule_local_time time; current_kind public.task_kind;
  target_workspace uuid; before_schedule jsonb; after_schedule jsonb;
  before_recurrence jsonb; after_recurrence jsonb;
begin
  if (select auth.uid()) is null or not anttodo_private.can_edit_task(p_task_id) then
    raise exception 'Insufficient task permission' using errcode='42501';
  end if;
  perform anttodo_private.validate_reminder_rules(p_reminders);
  if p_due_at is null and jsonb_array_length(coalesce(p_reminders,'[]'::jsonb))>0 then
    raise exception 'A due date is required before reminders can be saved';
  end if;
  if p_due_at is null and p_recurrence is not null and p_recurrence<>'null'::jsonb then
    raise exception 'A due date is required before recurrence can be saved';
  end if;
  select kind,workspace_id,recurrence into current_kind,target_workspace,before_recurrence
  from public.tasks where id=p_task_id;
  if current_kind='note' and p_recurrence is not null and p_recurrence<>'null'::jsonb then
    raise exception 'Notes cannot recur';
  end if;
  perform anttodo_private.validate_recurrence(p_recurrence);
  select jsonb_build_object(
    'persistent',coalesce((select persistent from public.task_reminder_settings where task_id=p_task_id),false),
    'reminders',coalesce((select jsonb_agg(jsonb_build_object(
      'anchor',anchor,'offset_value',offset_value,'offset_unit',offset_unit,'local_time',local_time
    ) order by position) from public.task_reminders where task_id=p_task_id),'[]'::jsonb)
  ) into before_schedule;
  update public.tasks set due_at=p_due_at,due_start_at=p_due_start_at,
    due_is_all_day=coalesce(p_due_is_all_day,false),due_timezone=p_due_timezone,
    recurrence=case when p_due_at is null then null else p_recurrence end
  where id=p_task_id;
  delete from public.task_reminders where task_id=p_task_id;
  delete from public.task_reminder_settings where task_id=p_task_id;
  if p_due_at is not null and jsonb_array_length(coalesce(p_reminders,'[]'::jsonb))>0 then
    insert into public.task_reminder_settings(task_id,persistent,updated_by)
    values(p_task_id,coalesce(p_persistent,false),(select auth.uid()));
    for rule,rule_position in
      select value,(ordinality-1)::integer
      from jsonb_array_elements(coalesce(p_reminders,'[]'::jsonb)) with ordinality
    loop
      rule_local_time := case when jsonb_typeof(rule->'local_time')='string' then (rule->>'local_time')::time else null end;
      insert into public.task_reminders(
        task_id,anchor,offset_value,offset_unit,local_time,trigger_at,position,created_by
      ) values(
        p_task_id,rule->>'anchor',(rule->>'offset_value')::integer,rule->>'offset_unit',rule_local_time,
        anttodo_private.reminder_trigger_at(p_task_id,rule->>'anchor',(rule->>'offset_value')::integer,rule->>'offset_unit',rule_local_time),
        rule_position,(select auth.uid())
      );
    end loop;
  end if;
  select jsonb_build_object(
    'persistent',coalesce((select persistent from public.task_reminder_settings where task_id=p_task_id),false),
    'reminders',coalesce((select jsonb_agg(jsonb_build_object(
      'anchor',anchor,'offset_value',offset_value,'offset_unit',offset_unit,'local_time',local_time
    ) order by position) from public.task_reminders where task_id=p_task_id),'[]'::jsonb)
  ) into after_schedule;
  select recurrence into after_recurrence from public.tasks where id=p_task_id;
  if before_schedule is distinct from after_schedule then
    insert into public.activity_events(workspace_id,task_id,actor_id,event_type,payload)
    values(target_workspace,p_task_id,(select auth.uid()),'task.reminders_changed',
      jsonb_build_object('before',before_schedule,'after',after_schedule));
  end if;
  if before_recurrence is distinct from after_recurrence then
    insert into public.activity_events(workspace_id,task_id,actor_id,event_type,payload)
    values(target_workspace,p_task_id,(select auth.uid()),'task.recurrence_changed',
      jsonb_build_object('before',before_recurrence,'after',after_recurrence));
  end if;
  return query select * from public.task_reminders where task_id=p_task_id order by position;
end $$;

create or replace function public.create_task_comment(
  p_task_id uuid,
  p_body text default '',
  p_image_uris text[] default array[]::text[],
  p_mentioned_user_ids uuid[] default array[]::uuid[]
) returns public.task_comments language plpgsql security definer set search_path = '' as $$
declare created public.task_comments; target_workspace uuid; mentioned uuid;
begin
  if (select auth.uid()) is null or not anttodo_private.can_view_task(p_task_id) then
    raise exception 'Insufficient task permission' using errcode='42501';
  end if;
  select workspace_id into target_workspace from public.tasks where id=p_task_id;
  insert into public.task_comments(workspace_id,task_id,author_id,body,image_uris)
  values(target_workspace,p_task_id,(select auth.uid()),coalesce(p_body,''),coalesce(p_image_uris,array[]::text[]))
  returning * into created;
  foreach mentioned in array coalesce(p_mentioned_user_ids,array[]::uuid[]) loop
    insert into public.task_comment_mentions(comment_id,user_id,display_name_snapshot)
    select created.id,wm.user_id,coalesce(p.display_name,'团队成员')
    from public.workspace_members wm left join public.profiles p on p.id=wm.user_id
    where wm.workspace_id=target_workspace and wm.user_id=mentioned
    on conflict do nothing;
  end loop;
  return created;
end $$;
revoke all on function public.create_task_comment(uuid,text,text[],uuid[]) from public,anon;
grant execute on function public.create_task_comment(uuid,text,text[],uuid[]) to authenticated;

create or replace function public.get_task_page(
  p_workspace_id uuid,
  p_offset integer default 0,
  p_limit integer default 1000
) returns setof public.tasks language sql stable security invoker set search_path = '' as $$
  with recursive selected_roots as (
    select t.* from public.tasks t
    where t.workspace_id=p_workspace_id and t.parent_task_id is null and t.deleted_at is null
    order by t.updated_at desc,t.id offset greatest(p_offset,0) limit least(greatest(p_limit,1),1000)
  ), tree as (
    select r.* from selected_roots r
    union all
    select c.* from public.tasks c join tree p on c.parent_task_id=p.id
    where c.deleted_at is null
  ) select * from tree
$$;
grant execute on function public.get_task_page(uuid,integer,integer) to authenticated;

create or replace function public.get_task_tree(p_task_id uuid)
returns setof public.tasks language sql stable security invoker set search_path = '' as $$
  with recursive upward as (
    select t.id,t.parent_task_id from public.tasks t where t.id=p_task_id
    union all select p.id,p.parent_task_id from public.tasks p join upward u on p.id=u.parent_task_id
  ), root as (select id from upward where parent_task_id is null), tree as (
    select t.* from public.tasks t join root r on r.id=t.id where t.deleted_at is null
    union all select c.* from public.tasks c join tree p on c.parent_task_id=p.id where c.deleted_at is null
  ) select * from tree
$$;
grant execute on function public.get_task_tree(uuid) to authenticated;

create or replace function public.list_task_activity(
  p_task_id uuid,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50
) returns setof public.activity_events language sql stable security invoker set search_path = '' as $$
  with recursive tree as (
    select id from public.tasks where id=p_task_id
    union all select t.id from public.tasks t join tree p on t.parent_task_id=p.id
  )
  select ae.* from public.activity_events ae
  where ae.task_id in (select id from tree)
    and (p_before_created_at is null or (ae.created_at,ae.id)<(p_before_created_at,p_before_id))
  order by ae.created_at desc,ae.id desc
  limit least(greatest(coalesce(p_limit,50),1),100)
$$;
revoke all on function public.list_task_activity(uuid,timestamptz,uuid,integer) from public,anon;
grant execute on function public.list_task_activity(uuid,timestamptz,uuid,integer) to authenticated;

-- Storage authorization resolves a migrated binding first and the current path
-- second. This keeps historical binaries safe after cross-root moves.
create or replace function anttodo_private.storage_object_task_id(p_bucket_id text,p_object_name text)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select b.task_id from anttodo_private.task_attachment_bindings b
      where b.bucket_id=p_bucket_id and b.object_name=p_object_name),
    case
      when p_bucket_id='task-attachments' then anttodo_private.attachment_task_id(p_object_name)
      when p_bucket_id='comment-images' then anttodo_private.comment_image_folder_id(p_object_name,2)
    end
  )
$$;
revoke all on function anttodo_private.storage_object_task_id(text,text) from public,anon;
grant execute on function anttodo_private.storage_object_task_id(text,text) to authenticated;

drop policy if exists task_attachments_select on storage.objects;
drop policy if exists task_attachments_delete on storage.objects;
drop policy if exists comment_images_select on storage.objects;
drop policy if exists comment_images_delete on storage.objects;
create policy task_attachments_select on storage.objects for select to authenticated using (
  bucket_id='task-attachments' and anttodo_private.can_view_task(
    anttodo_private.storage_object_task_id(bucket_id,name)
  )
);
create policy task_attachments_delete on storage.objects for delete to authenticated using (
  bucket_id='task-attachments' and anttodo_private.can_edit_task(
    anttodo_private.storage_object_task_id(bucket_id,name)
  )
);
create policy comment_images_select on storage.objects for select to authenticated using (
  bucket_id='comment-images' and anttodo_private.can_view_task(
    anttodo_private.storage_object_task_id(bucket_id,name)
  )
);
create policy comment_images_delete on storage.objects for delete to authenticated using (
  bucket_id='comment-images' and owner_id=((select auth.uid()))::text
  and anttodo_private.can_view_task(anttodo_private.storage_object_task_id(bucket_id,name))
);

drop function if exists anttodo_private.validate_focus_session();
drop function if exists anttodo_private.validate_task_comment();

create or replace function public.apply_client_operations(p_operations jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op jsonb; result jsonb:='[]'::jsonb; outcome jsonb; target_workspace uuid; payload jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if jsonb_array_length(coalesce(p_operations,'[]'::jsonb))>50 then raise exception 'Too many operations'; end if;
  for op in select value from jsonb_array_elements(coalesce(p_operations,'[]'::jsonb)) loop
    target_workspace := (op->>'workspaceId')::uuid; payload:=coalesce(op->'payload','{}'::jsonb);
    if not anttodo_private.is_workspace_member(target_workspace) then
      result:=result||jsonb_build_array(jsonb_build_object('operationId',op->>'operationId','status','rejected','code','WORKSPACE_ACCESS_REVOKED'));
      continue;
    end if;
    if op->>'entityType'='tasks' then
      if coalesce((payload->>'deleted')::boolean,false) then
        update public.tasks set deleted_at=now() where id=(op->>'entityId')::uuid and workspace_id=target_workspace;
      elsif exists(select 1 from public.tasks where id=(op->>'entityId')::uuid) then
        update public.tasks t set title=coalesce(payload->>'title',t.title),description=coalesce(payload->>'description',t.description),
          status=coalesce((payload->>'status')::public.task_status,t.status),priority=coalesce((payload->>'priority')::public.task_priority,t.priority),
          parent_task_id=case when payload?'parent_task_id' then (payload->>'parent_task_id')::uuid else t.parent_task_id end,
          position=coalesce((payload->>'position')::integer,t.position),
          due_at=case when payload?'due_at' then (payload->>'due_at')::timestamptz else t.due_at end
        where t.id=(op->>'entityId')::uuid and t.workspace_id=target_workspace;
      else
        insert into public.tasks(id,workspace_id,title,description,status,priority,parent_task_id,position,created_by)
        values((op->>'entityId')::uuid,target_workspace,coalesce(payload->>'title','新任务'),coalesce(payload->>'description',''),
          coalesce((payload->>'status')::public.task_status,'open'),coalesce((payload->>'priority')::public.task_priority,'none'),
          (payload->>'parent_task_id')::uuid,coalesce((payload->>'position')::integer,0),(select auth.uid()));
      end if;
    elsif op->>'entityType'='task_move' then
      perform public.move_task(
        (op->>'entityId')::uuid,
        nullif(payload->>'parentTaskId','')::uuid,
        coalesce((payload->>'position')::integer,0)
      );
    elsif op->>'entityType'='task_schedule' then
      perform public.save_task_schedule((op->>'entityId')::uuid,(payload->>'due_at')::timestamptz,
        (payload->>'due_start_at')::timestamptz,coalesce((payload->>'due_is_all_day')::boolean,false),payload->>'due_timezone',
        coalesce(payload->'schedule'->'reminders','[]'::jsonb),coalesce((payload->'schedule'->>'persistent')::boolean,false),payload->'recurrence');
    elsif op->>'entityType'='task_dependencies' then
      if coalesce((payload->>'selected')::boolean,false) then
        insert into public.task_dependencies(id,workspace_id,task_id,depends_on_task_id)
        values((op->>'entityId')::uuid,target_workspace,(payload->>'taskId')::uuid,(payload->>'dependsOnTaskId')::uuid) on conflict do nothing;
      else delete from public.task_dependencies where id=(op->>'entityId')::uuid and workspace_id=target_workspace; end if;
    elsif op->>'entityType'='task_comments' then
      if coalesce((payload->>'deleted')::boolean,false) then
        delete from public.task_comments where id=(op->>'entityId')::uuid and author_id=(select auth.uid());
      elsif exists(select 1 from public.task_comments where id=(op->>'entityId')::uuid) then
        update public.task_comments c set body=coalesce(payload->>'body',c.body),updated_at=now()
        where c.id=(op->>'entityId')::uuid and c.author_id=(select auth.uid());
      else
        perform public.create_task_comment((payload->>'taskId')::uuid,coalesce(payload->>'body',''),
          case when payload?'imageUris' then array(select jsonb_array_elements_text(payload->'imageUris')) else array[]::text[] end,
          case when payload?'mentionedUserIds' then array(select jsonb_array_elements_text(payload->'mentionedUserIds'))::uuid[] else array[]::uuid[] end);
      end if;
    else
      outcome:=jsonb_build_object('operationId',op->>'operationId','status','rejected','code','UNSUPPORTED_ENTITY');
      result:=result||jsonb_build_array(outcome); continue;
    end if;
    outcome:=jsonb_build_object('operationId',op->>'operationId','status','applied');
    insert into anttodo_private.client_applied_operations(operation_id,user_id,workspace_id,result)
    values((op->>'operationId')::uuid,(select auth.uid()),target_workspace,outcome) on conflict do nothing;
    result:=result||jsonb_build_array(outcome);
  end loop;
  return result;
end $$;

-- Remove the old physical model and every named database API built around it.
drop trigger if exists tasks_clear_note_subtask_assignments on public.tasks;
drop table public.subtask_reminder_settings;
drop table public.subtasks cascade;
drop function if exists public.assign_subtask(uuid,uuid,public.ai_cli_tool);
drop function if exists public.save_subtask_schedule(uuid,timestamptz,timestamptz,boolean,text,jsonb,boolean);
drop function if exists anttodo_private.clear_note_subtask_assignments();
drop function if exists anttodo_private.enforce_reminder_subtask_parent();
drop function if exists anttodo_private.enforce_subtask_nesting();
drop function if exists anttodo_private.notify_subtask_changes();
drop function if exists anttodo_private.record_subtask_activity();
drop function if exists anttodo_private.set_subtask_created_by();
drop function if exists anttodo_private.validate_subtask_assignee();
drop function if exists anttodo_private.on_subtask_schedule_changed();

-- Drop obsolete overloads. Unified replacements are added with the client API
-- changes in this migration series.
drop function if exists public.create_task_comment(uuid,text,text[],uuid[],uuid);
drop function if exists anttodo_private.reminder_trigger_at(uuid,text,integer,text,time,uuid);
drop function if exists anttodo_private.task_dependency_would_cycle(uuid,uuid,uuid,uuid);

commit;
