-- unify_task_tree rewrote apply_client_operations and dropped the Mac
-- local-first create path for labels, assignees, and watchers. After a
-- successful sync the client reloads the workspace snapshot, so a task
-- created under a private label vanished from that label's list (and
-- landed unlabeled in the inbox). Restore those writes while keeping the
-- unified task-tree operations.

create or replace function public.apply_client_operations(p_operations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  op jsonb;
  result jsonb := '[]'::jsonb;
  existing jsonb;
  outcome jsonb;
  target_workspace uuid;
  payload jsonb;
  requested_label_id uuid;
  creator_id uuid := (select auth.uid());
  parent_id uuid;
begin
  if creator_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if jsonb_array_length(coalesce(p_operations, '[]'::jsonb)) > 50 then
    raise exception 'Too many operations';
  end if;

  for op in select value from jsonb_array_elements(coalesce(p_operations, '[]'::jsonb)) loop
    target_workspace := (op ->> 'workspaceId')::uuid;
    payload := coalesce(op -> 'payload', '{}'::jsonb);

    if not anttodo_private.is_workspace_member(target_workspace) then
      result := result || jsonb_build_array(jsonb_build_object(
        'operationId', op ->> 'operationId',
        'status', 'rejected',
        'code', 'WORKSPACE_ACCESS_REVOKED'
      ));
      continue;
    end if;

    select a.result into existing
    from anttodo_private.client_applied_operations a
    where a.operation_id = (op ->> 'operationId')::uuid
      and a.user_id = creator_id;
    if existing is not null then
      result := result || jsonb_build_array(existing);
      continue;
    end if;

    if op ->> 'entityType' = 'tasks' then
      if coalesce((payload ->> 'deleted')::boolean, false) then
        update public.tasks
        set deleted_at = now()
        where id = (op ->> 'entityId')::uuid
          and workspace_id = target_workspace;
      elsif exists (select 1 from public.tasks where id = (op ->> 'entityId')::uuid) then
        update public.tasks t set
          title = coalesce(payload ->> 'title', t.title),
          description = coalesce(payload ->> 'description', t.description),
          status = coalesce((payload ->> 'status')::public.task_status, t.status),
          priority = coalesce((payload ->> 'priority')::public.task_priority, t.priority),
          kind = coalesce((payload ->> 'kind')::public.task_kind, t.kind),
          parent_task_id = case
            when payload ? 'parent_task_id' then nullif(payload ->> 'parent_task_id', '')::uuid
            else t.parent_task_id
          end,
          position = coalesce((payload ->> 'position')::integer, t.position),
          due_at = case
            when payload ? 'due_at' then nullif(payload ->> 'due_at', '')::timestamptz
            else t.due_at
          end,
          assignee_id = case
            when payload ? 'assignee_id' then nullif(payload ->> 'assignee_id', '')::uuid
            else t.assignee_id
          end,
          cli_assignee = case
            when payload ? 'cli_assignee' then nullif(payload ->> 'cli_assignee', '')::public.ai_cli_tool
            else t.cli_assignee
          end
        where t.id = (op ->> 'entityId')::uuid
          and t.workspace_id = target_workspace;
      else
        parent_id := nullif(payload ->> 'parent_task_id', '')::uuid;
        insert into public.tasks (
          id, workspace_id, title, description, status, priority, kind,
          parent_task_id, position, due_at, assignee_id, cli_assignee, created_by
        ) values (
          (op ->> 'entityId')::uuid,
          target_workspace,
          coalesce(payload ->> 'title', '新任务'),
          coalesce(payload ->> 'description', ''),
          coalesce((payload ->> 'status')::public.task_status, 'open'),
          coalesce((payload ->> 'priority')::public.task_priority, 'none'),
          coalesce((payload ->> 'kind')::public.task_kind, 'todo'),
          parent_id,
          coalesce((payload ->> 'position')::integer, 0),
          nullif(payload ->> 'due_at', '')::timestamptz,
          nullif(payload ->> 'assignee_id', '')::uuid,
          nullif(payload ->> 'cli_assignee', '')::public.ai_cli_tool,
          creator_id
        );

        -- Labels belong to the root task only. Nested creates already send [].
        if parent_id is null and jsonb_typeof(payload -> 'label_ids') = 'array' then
          foreach requested_label_id in array coalesce(
            array(select jsonb_array_elements_text(payload -> 'label_ids'))::uuid[],
            array[]::uuid[]
          ) loop
            if anttodo_private.label_permission_level(requested_label_id) < 2
              or not exists (
                select 1
                from public.labels
                where id = requested_label_id
                  and workspace_id = target_workspace
              )
            then
              raise exception 'Insufficient label permission';
            end if;
          end loop;

          insert into public.task_labels (task_id, label_id)
          select (op ->> 'entityId')::uuid, value::uuid
          from jsonb_array_elements_text(payload -> 'label_ids')
          on conflict do nothing;
        end if;

        if nullif(payload ->> 'assignee_id', '')::uuid is distinct from creator_id then
          insert into public.task_participants (task_id, user_id)
          values ((op ->> 'entityId')::uuid, creator_id)
          on conflict do nothing;
        end if;
      end if;

    elsif op ->> 'entityType' = 'task_move' then
      perform public.move_task(
        (op ->> 'entityId')::uuid,
        nullif(payload ->> 'parentTaskId', '')::uuid,
        coalesce((payload ->> 'position')::integer, 0)
      );

    elsif op ->> 'entityType' = 'task_schedule' then
      perform public.save_task_schedule(
        (op ->> 'entityId')::uuid,
        (payload ->> 'due_at')::timestamptz,
        (payload ->> 'due_start_at')::timestamptz,
        coalesce((payload ->> 'due_is_all_day')::boolean, false),
        payload ->> 'due_timezone',
        coalesce(payload -> 'schedule' -> 'reminders', '[]'::jsonb),
        coalesce((payload -> 'schedule' ->> 'persistent')::boolean, false),
        payload -> 'recurrence'
      );

    elsif op ->> 'entityType' = 'task_labels' then
      if coalesce((payload ->> 'selected')::boolean, false) then
        insert into public.task_labels (task_id, label_id)
        values ((payload ->> 'taskId')::uuid, (payload ->> 'labelId')::uuid)
        on conflict do nothing;
      else
        delete from public.task_labels tl
        where tl.task_id = (payload ->> 'taskId')::uuid
          and tl.label_id = (payload ->> 'labelId')::uuid;
      end if;

    elsif op ->> 'entityType' = 'task_participants' then
      if coalesce((payload ->> 'selected')::boolean, false) then
        insert into public.task_participants (task_id, user_id)
        values ((payload ->> 'taskId')::uuid, (payload ->> 'userId')::uuid)
        on conflict do nothing;
      else
        delete from public.task_participants
        where task_id = (payload ->> 'taskId')::uuid
          and user_id = (payload ->> 'userId')::uuid;
      end if;

    elsif op ->> 'entityType' = 'task_dependencies' then
      if coalesce((payload ->> 'selected')::boolean, false) then
        insert into public.task_dependencies (id, workspace_id, task_id, depends_on_task_id)
        values (
          (op ->> 'entityId')::uuid,
          target_workspace,
          (payload ->> 'taskId')::uuid,
          (payload ->> 'dependsOnTaskId')::uuid
        )
        on conflict do nothing;
      else
        delete from public.task_dependencies
        where id = (op ->> 'entityId')::uuid
          and workspace_id = target_workspace;
      end if;

    elsif op ->> 'entityType' = 'task_comments' then
      if coalesce((payload ->> 'deleted')::boolean, false) then
        delete from public.task_comments
        where id = (op ->> 'entityId')::uuid
          and author_id = creator_id;
      elsif exists (select 1 from public.task_comments where id = (op ->> 'entityId')::uuid) then
        update public.task_comments c
        set body = coalesce(payload ->> 'body', c.body),
            updated_at = now()
        where c.id = (op ->> 'entityId')::uuid
          and c.author_id = creator_id;
      else
        perform public.create_task_comment(
          (payload ->> 'taskId')::uuid,
          coalesce(payload ->> 'body', ''),
          case
            when payload ? 'imageUris'
              then array(select jsonb_array_elements_text(payload -> 'imageUris'))
            else array[]::text[]
          end,
          case
            when payload ? 'mentionedUserIds'
              then array(select jsonb_array_elements_text(payload -> 'mentionedUserIds'))::uuid[]
            else array[]::uuid[]
          end
        );
      end if;

    else
      outcome := jsonb_build_object(
        'operationId', op ->> 'operationId',
        'status', 'rejected',
        'code', 'UNSUPPORTED_ENTITY'
      );
      result := result || jsonb_build_array(outcome);
      continue;
    end if;

    outcome := jsonb_build_object(
      'operationId', op ->> 'operationId',
      'status', 'applied'
    );
    insert into anttodo_private.client_applied_operations (
      operation_id, user_id, workspace_id, result
    ) values (
      (op ->> 'operationId')::uuid, creator_id, target_workspace, outcome
    ) on conflict do nothing;
    result := result || jsonb_build_array(outcome);
  end loop;

  return result;
end;
$$;
