-- Saving a description records mentions without notifying anyone. Only an
-- explicit, authenticated send request creates and immediately dispatches one.
drop trigger if exists task_description_mentions_notify on public.task_description_mentions;

create function anttodo_private.send_task_description_mention_notification(
  p_task_id uuid,
  p_recipient_id uuid,
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_task public.tasks;
  v_name text;
  v_type text;
  v_dedupe text;
  v_notification_id uuid;
begin
  if v_actor is null or not anttodo_private.can_edit_task(p_task_id) then
    raise exception 'Insufficient task permission' using errcode = '42501';
  end if;
  if p_request_id is null or p_recipient_id is null then
    raise exception 'Recipient and request ID are required' using errcode = '22023';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found or v_task.deleted_at is not null then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
  if not anttodo_private.can_user_view_task(v_task.id, p_recipient_id) then
    raise exception 'Recipient cannot view this task' using errcode = '42501';
  end if;

  select display_name_snapshot into v_name
  from public.task_description_mentions
  where task_id = v_task.id and user_id = p_recipient_id;
  if not found or strpos(coalesce(v_task.description, ''), '@' || v_name) = 0 then
    raise exception 'Mention is absent from description' using errcode = '22023';
  end if;

  v_type := case when v_task.kind = 'note' then 'note_mentioned' else 'todo_mentioned' end;
  v_dedupe := 'manual-description:' || v_task.id::text || ':' || v_actor::text || ':' || p_request_id::text;
  -- A task can change kind between an accepted request and its network retry.
  select id into v_notification_id from public.notifications
  where recipient_id = p_recipient_id and dedupe_key = v_dedupe;
  if found then return v_notification_id; end if;

  insert into public.notifications (
    workspace_id, task_id, recipient_id, actor_id, notification_type, payload, dedupe_key
  ) values (
    v_task.workspace_id, v_task.id, p_recipient_id, v_actor, v_type,
    jsonb_build_object('source', 'description', 'manual_send', true), v_dedupe
  ) on conflict (recipient_id, notification_type, dedupe_key) do nothing
  returning id into v_notification_id;

  if v_notification_id is not null then
    perform anttodo_private.enqueue_notification_dispatch(v_notification_id);
  else
    select id into v_notification_id from public.notifications
    where recipient_id = p_recipient_id and notification_type = v_type and dedupe_key = v_dedupe;
  end if;
  return v_notification_id;
end;
$$;

revoke all on function anttodo_private.send_task_description_mention_notification(uuid, uuid, uuid)
from public, anon;
grant execute on function anttodo_private.send_task_description_mention_notification(uuid, uuid, uuid)
to authenticated;

create function public.send_task_description_mention_notification(
  p_task_id uuid,
  p_recipient_id uuid,
  p_request_id uuid
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select anttodo_private.send_task_description_mention_notification(p_task_id, p_recipient_id, p_request_id);
$$;

revoke all on function public.send_task_description_mention_notification(uuid, uuid, uuid)
from public, anon;
grant execute on function public.send_task_description_mention_notification(uuid, uuid, uuid)
to authenticated;
