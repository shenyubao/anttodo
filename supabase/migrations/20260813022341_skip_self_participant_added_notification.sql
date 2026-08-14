-- Do not notify a user when they add themselves as a participant,
-- including auto-watch on task create.

create or replace function anttodo_private.notify_task_participant_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(new.created_by, (select auth.uid()));
  v_workspace_id uuid;
  v_title text;
begin
  if v_actor is null then
    return new;
  end if;

  if new.user_id is not distinct from v_actor then
    return new;
  end if;

  select t.workspace_id, t.title
  into v_workspace_id, v_title
  from public.tasks t
  where t.id = new.task_id;

  if v_workspace_id is null then
    return new;
  end if;

  perform anttodo_private.create_app_notification(
    v_workspace_id,
    new.task_id,
    new.user_id,
    v_actor,
    'participant_added',
    null,
    jsonb_build_object('title', v_title),
    'participant:' || new.task_id::text || ':' || new.user_id::text || ':' || extract(epoch from clock_timestamp())::text
  );

  return new;
end;
$$;
