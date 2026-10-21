create or replace function public.attach_dingtalk_group_robot_images(
  p_connector_id uuid,
  p_message_id text,
  p_actor_id uuid,
  p_description text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task_id uuid;
  v_description text;
begin
  if p_message_id is null or char_length(btrim(p_message_id)) not between 1 and 500 then
    raise exception 'Invalid DingTalk message id' using errcode = '22023';
  end if;
  if p_description is null or char_length(btrim(p_description)) not between 1 and 10000 then
    raise exception 'Invalid DingTalk image description' using errcode = '22023';
  end if;

  select task.id, task.description
    into v_task_id, v_description
  from anttodo_private.dingtalk_group_robot_receipts receipt
  join public.connector_instances connector
    on connector.id = receipt.connector_id
  join public.tasks task
    on task.id = receipt.task_id
   and task.workspace_id = connector.workspace_id
  where receipt.connector_id = p_connector_id
    and receipt.message_id = btrim(p_message_id)
    and connector.type = 'dingtalk'
    and connector.public_config->>'kind' = 'group_robot'
    and connector.enabled
    and task.created_by = p_actor_id;

  if v_task_id is null then
    raise exception 'DingTalk robot task not found' using errcode = 'P0002';
  end if;
  if v_description <> '' then
    return false;
  end if;

  perform set_config('request.jwt.claim.sub', p_actor_id::text, true);
  update public.tasks
  set description = btrim(p_description),
      updated_at = now(),
      version = version + 1
  where id = v_task_id
    and description = '';
  return found;
end;
$$;

revoke all on function public.attach_dingtalk_group_robot_images(uuid, text, uuid, text)
from public, anon, authenticated;
grant execute on function public.attach_dingtalk_group_robot_images(uuid, text, uuid, text)
to service_role;
