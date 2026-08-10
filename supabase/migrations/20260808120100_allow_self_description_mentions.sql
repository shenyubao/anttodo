-- Allow self description @mentions for end-to-end notification testing.

drop policy if exists task_description_mentions_insert on public.task_description_mentions;
create policy task_description_mentions_insert
on public.task_description_mentions for insert to authenticated
with check (
  (select anttodo_private.can_edit_task(task_id))
  and anttodo_private.can_user_view_task(task_id, user_id)
);

create or replace function public.update_task_description(
  p_task_id uuid,
  p_description text,
  p_mentioned_user_ids uuid[] default array[]::uuid[]
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated_task public.tasks;
begin
  if not anttodo_private.can_edit_task(p_task_id) then
    raise exception 'Insufficient task permission'
      using errcode = '42501';
  end if;

  update public.tasks
  set description = coalesce(p_description, ''),
      updated_at = now(),
      version = version + 1
  where id = p_task_id
  returning * into updated_task;

  if not found then
    raise exception 'Task not found'
      using errcode = 'P0002';
  end if;

  delete from public.task_description_mentions mention
  where mention.task_id = updated_task.id
    and not (
      mention.user_id = any(coalesce(p_mentioned_user_ids, array[]::uuid[]))
      and anttodo_private.can_user_view_task(updated_task.id, mention.user_id)
    );

  insert into public.task_description_mentions (
    task_id,
    user_id,
    display_name_snapshot
  )
  select
    updated_task.id,
    profile.id,
    coalesce(nullif(btrim(profile.display_name), ''), '团队成员')
  from public.profiles profile
  where profile.id = any(coalesce(p_mentioned_user_ids, array[]::uuid[]))
    and anttodo_private.can_user_view_task(updated_task.id, profile.id)
  on conflict (task_id, user_id) do nothing;

  return updated_task;
end;
$$;
