alter table public.subtasks
  add column priority public.task_priority not null default 'none';

create index subtasks_priority_idx on public.subtasks(priority);

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
  select t.workspace_id into selected_workspace_id
  from public.tasks t where t.id = selected_task_id;
  if selected_workspace_id is null then return coalesce(new, old); end if;

  if tg_op = 'INSERT' then
    selected_event_type := 'task.subtask_created';
    selected_payload := jsonb_build_object(
      'subtask_id', new.id, 'title', new.title, 'completed', new.completed,
      'priority', new.priority
    );
  elsif tg_op = 'DELETE' then
    selected_event_type := 'task.subtask_deleted';
    selected_payload := jsonb_build_object(
      'subtask_id', old.id, 'title', old.title, 'completed', old.completed,
      'priority', old.priority
    );
  else
    if old.title is distinct from new.title then
      changes := changes || jsonb_build_object('title', jsonb_build_object('before', old.title, 'after', new.title));
    end if;
    if old.completed is distinct from new.completed then
      changes := changes || jsonb_build_object('completed', jsonb_build_object('before', old.completed, 'after', new.completed));
    end if;
    if old.priority is distinct from new.priority then
      changes := changes || jsonb_build_object('priority', jsonb_build_object('before', old.priority, 'after', new.priority));
    end if;
    if old.position is distinct from new.position then
      changes := changes || jsonb_build_object('position', jsonb_build_object('before', old.position, 'after', new.position));
    end if;
    if old.cli_assignee is distinct from new.cli_assignee then
      changes := changes || jsonb_build_object('cli_assignee', jsonb_build_object('before', old.cli_assignee, 'after', new.cli_assignee));
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
