create unique index connector_instances_dingtalk_group_robot_workspace_uidx
  on public.connector_instances (workspace_id)
  where type = 'dingtalk'
    and public_config->>'kind' = 'group_robot';

create table anttodo_private.dingtalk_group_robot_receipts (
  connector_id uuid not null references public.connector_instances(id) on delete cascade,
  message_id text not null check (char_length(message_id) between 1 and 500),
  task_id uuid not null references public.tasks(id) on delete cascade,
  received_at timestamptz not null default now(),
  primary key (connector_id, message_id)
);

revoke all on table anttodo_private.dingtalk_group_robot_receipts
  from public, anon, authenticated;
grant select, insert on table anttodo_private.dingtalk_group_robot_receipts
  to service_role;
grant execute on function anttodo_private.label_permission_level_for_user(uuid, uuid)
  to service_role;
grant execute on function anttodo_private.can_user_view_task(uuid, uuid)
  to service_role;
grant select, insert on table public.task_participants to service_role;

create or replace function public.create_task_from_dingtalk_group_robot(
  p_connector_id uuid,
  p_message_id text,
  p_actor_id uuid,
  p_title text,
  p_due_at timestamptz default null,
  p_due_start_at timestamptz default null,
  p_due_is_all_day boolean default false,
  p_due_timezone text default 'Asia/Shanghai',
  p_assignee_id uuid default null,
  p_participant_ids uuid[] default array[]::uuid[],
  p_label_names text[] default array[]::text[]
)
returns table (
  task_id uuid,
  duplicate boolean,
  assigned_user_id uuid,
  participant_user_ids uuid[],
  selected_label_ids uuid[]
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_existing_task_id uuid;
  v_task_id uuid := extensions.gen_random_uuid();
  v_assignee_id uuid;
  v_participant_ids uuid[] := array[]::uuid[];
  v_label_id uuid;
  v_label_ids uuid[] := array[]::uuid[];
  v_label_name text;
  v_label_matches integer;
  v_user_id uuid;
begin
  if p_message_id is null or char_length(btrim(p_message_id)) not between 1 and 500 then
    raise exception 'Invalid DingTalk message id' using errcode = '22023';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 500 then
    raise exception 'Invalid task title' using errcode = '22023';
  end if;
  if p_due_timezone is not null and char_length(p_due_timezone) not between 1 and 100 then
    raise exception 'Invalid due timezone' using errcode = '22023';
  end if;
  if p_due_start_at is not null and (p_due_at is null or p_due_start_at > p_due_at) then
    raise exception 'Invalid due date range' using errcode = '22023';
  end if;
  if coalesce(p_due_is_all_day, false) and p_due_start_at is null then
    raise exception 'All-day tasks require a due date range' using errcode = '22023';
  end if;

  select connector.workspace_id
    into v_workspace_id
  from public.connector_instances connector
  where connector.id = p_connector_id
    and connector.type = 'dingtalk'
    and connector.public_config->>'kind' = 'group_robot'
    and connector.enabled;

  if v_workspace_id is null then
    raise exception 'DingTalk group robot is not enabled' using errcode = '42501';
  end if;

  select receipt.task_id
    into v_existing_task_id
  from anttodo_private.dingtalk_group_robot_receipts receipt
  where receipt.connector_id = p_connector_id
    and receipt.message_id = btrim(p_message_id);

  if v_existing_task_id is not null then
    return query
      select
        v_existing_task_id,
        true,
        existing_task.assignee_id,
        coalesce(array(
          select participant.user_id
          from public.task_participants participant
          where participant.task_id = v_existing_task_id
          order by participant.created_at, participant.user_id
        ), array[]::uuid[]),
        coalesce(array(
          select task_label.label_id
          from public.task_labels task_label
          where task_label.task_id = v_existing_task_id
          order by task_label.created_at, task_label.label_id
        ), array[]::uuid[])
      from public.tasks existing_task
      where existing_task.id = v_existing_task_id;
    return;
  end if;

  if not exists (
    select 1
    from public.workspace_members member
    where member.workspace_id = v_workspace_id
      and member.user_id = p_actor_id
  ) then
    raise exception 'DingTalk sender is not a workspace member' using errcode = '42501';
  end if;

  foreach v_label_name in array coalesce(p_label_names, array[]::text[]) loop
    select count(*), min(label.id::text)::uuid
      into v_label_matches, v_label_id
    from public.labels label
    where label.workspace_id = v_workspace_id
      and lower(btrim(label.name)) = lower(btrim(v_label_name));
    if v_label_matches = 1
      and anttodo_private.label_permission_level_for_user(v_label_id, p_actor_id) >= 2
      and not (v_label_id = any(v_label_ids))
    then
      v_label_ids := array_append(v_label_ids, v_label_id);
    end if;
  end loop;

  if p_assignee_id is not null
    and exists (
      select 1 from public.workspace_members member
      where member.workspace_id = v_workspace_id
        and member.user_id = p_assignee_id
    )
    and not exists (
      select 1
      from unnest(v_label_ids) selected_label(label_id)
      where anttodo_private.label_permission_level_for_user(
        selected_label.label_id,
        p_assignee_id
      ) < 1
    )
  then
    v_assignee_id := p_assignee_id;
  end if;

  foreach v_user_id in array coalesce(p_participant_ids, array[]::uuid[]) loop
    if v_user_id is distinct from v_assignee_id
      and not (v_user_id = any(v_participant_ids))
      and exists (
        select 1 from public.workspace_members member
        where member.workspace_id = v_workspace_id
          and member.user_id = v_user_id
      )
      and not exists (
        select 1
        from unnest(v_label_ids) selected_label(label_id)
        where anttodo_private.label_permission_level_for_user(
          selected_label.label_id,
          v_user_id
        ) < 1
      )
    then
      v_participant_ids := array_append(v_participant_ids, v_user_id);
    end if;
  end loop;

  if p_actor_id is distinct from v_assignee_id
    and not (p_actor_id = any(v_participant_ids))
  then
    v_participant_ids := array_append(v_participant_ids, p_actor_id);
  end if;

  perform set_config('request.jwt.claim.sub', p_actor_id::text, true);

  insert into public.tasks (
    id,
    workspace_id,
    title,
    description,
    kind,
    priority,
    due_at,
    due_start_at,
    due_is_all_day,
    due_timezone,
    assignee_id,
    created_by
  ) values (
    v_task_id,
    v_workspace_id,
    btrim(p_title),
    '',
    'todo',
    'low',
    p_due_at,
    p_due_start_at,
    coalesce(p_due_is_all_day, false),
    p_due_timezone,
    v_assignee_id,
    p_actor_id
  );

  insert into public.task_labels (task_id, label_id)
  select v_task_id, selected.label_id
  from (
    select unnest(v_label_ids) as label_id
  ) selected;

  insert into public.task_participants (task_id, user_id, created_by)
  select v_task_id, selected.user_id, p_actor_id
  from unnest(v_participant_ids) selected(user_id);

  insert into public.activity_events (
    workspace_id,
    task_id,
    actor_id,
    event_type,
    payload
  ) values (
    v_workspace_id,
    v_task_id,
    p_actor_id,
    'task.created',
    jsonb_build_object('source', 'dingtalk_group_robot')
  );

  insert into anttodo_private.dingtalk_group_robot_receipts (
    connector_id,
    message_id,
    task_id
  ) values (
    p_connector_id,
    btrim(p_message_id),
    v_task_id
  );

  update public.connector_instances
  set last_synced_at = now(), updated_at = now()
  where id = p_connector_id;

  return query select v_task_id, false, v_assignee_id, v_participant_ids, v_label_ids;
exception
  when unique_violation then
    select receipt.task_id
      into v_existing_task_id
    from anttodo_private.dingtalk_group_robot_receipts receipt
    where receipt.connector_id = p_connector_id
      and receipt.message_id = btrim(p_message_id);
    if v_existing_task_id is null then
      raise;
    end if;
    return query
      select
        v_existing_task_id,
        true,
        existing_task.assignee_id,
        coalesce(array(
          select participant.user_id
          from public.task_participants participant
          where participant.task_id = v_existing_task_id
          order by participant.created_at, participant.user_id
        ), array[]::uuid[]),
        coalesce(array(
          select task_label.label_id
          from public.task_labels task_label
          where task_label.task_id = v_existing_task_id
          order by task_label.created_at, task_label.label_id
        ), array[]::uuid[])
      from public.tasks existing_task
      where existing_task.id = v_existing_task_id;
end;
$$;

revoke all on function public.create_task_from_dingtalk_group_robot(
  uuid, text, uuid, text, timestamptz, timestamptz, boolean, text,
  uuid, uuid[], text[]
) from public, anon, authenticated;
grant execute on function public.create_task_from_dingtalk_group_robot(
  uuid, text, uuid, text, timestamptz, timestamptz, boolean, text,
  uuid, uuid[], text[]
) to service_role;
