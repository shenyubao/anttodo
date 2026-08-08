-- Notify users when they are added as a task participant.

alter table public.user_notification_preferences
  drop constraint if exists user_notification_preferences_scenario_check;

alter table public.user_notification_preferences
  add constraint user_notification_preferences_scenario_check
  check (scenario in (
    'task_assigned',
    'task_due_reminder',
    'task_new_comment',
    'note_mentioned',
    'participant_added',
    'participant_title_changed',
    'participant_status_changed',
    'participant_new_comment',
    'participant_subtask_created',
    'participant_subtask_status_changed',
    'participant_subtask_title_changed'
  ));

alter table public.notifications
  drop constraint if exists notifications_notification_type_check;

alter table public.notifications
  add constraint notifications_notification_type_check
  check (notification_type in (
    'comment_mention',
    'task_assigned',
    'task_new_comment',
    'note_mentioned',
    'participant_added',
    'participant_title_changed',
    'participant_status_changed',
    'participant_new_comment',
    'participant_subtask_created',
    'participant_subtask_status_changed',
    'participant_subtask_title_changed'
  ));

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

revoke all on function anttodo_private.notify_task_participant_added()
from public, anon, authenticated;

drop trigger if exists task_participants_notify_added on public.task_participants;
create trigger task_participants_notify_added
after insert on public.task_participants
for each row execute function anttodo_private.notify_task_participant_added();
