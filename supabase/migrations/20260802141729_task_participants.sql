create table public.task_participants (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index task_participants_user_idx
  on public.task_participants(user_id, task_id);

alter table public.task_participants enable row level security;

create policy task_participants_select on public.task_participants
for select to authenticated
using ((select anttodo_private.can_view_task(task_id)));

create policy task_participants_insert on public.task_participants
for insert to authenticated
with check ((select anttodo_private.can_edit_task(task_id)));

create policy task_participants_delete on public.task_participants
for delete to authenticated
using ((select anttodo_private.can_edit_task(task_id)));

grant select, insert, delete on public.task_participants to authenticated;

create or replace function anttodo_private.validate_task_participant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not anttodo_private.can_user_view_task(new.task_id, new.user_id) then
    raise exception 'Participant must be a workspace member who can view the task'
      using errcode = '42501';
  end if;

  if new.created_by is null then
    new.created_by := (select auth.uid());
  end if;

  return new;
end;
$$;

create or replace function anttodo_private.record_task_participant_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_task_id uuid := coalesce(new.task_id, old.task_id);
  selected_user_id uuid := coalesce(new.user_id, old.user_id);
  selected_workspace_id uuid;
  selected_display_name text;
begin
  select t.workspace_id
  into selected_workspace_id
  from public.tasks t
  where t.id = selected_task_id;

  if selected_workspace_id is null then
    return coalesce(new, old);
  end if;

  select p.display_name
  into selected_display_name
  from public.profiles p
  where p.id = selected_user_id;

  insert into public.activity_events (
    workspace_id,
    task_id,
    actor_id,
    event_type,
    payload
  ) values (
    selected_workspace_id,
    selected_task_id,
    (select auth.uid()),
    case when tg_op = 'INSERT' then 'task.participant_added' else 'task.participant_removed' end,
    jsonb_build_object(
      'user_id', selected_user_id,
      'display_name', coalesce(nullif(btrim(selected_display_name), ''), '团队成员')
    )
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists task_participants_validate on public.task_participants;
create trigger task_participants_validate
before insert on public.task_participants
for each row execute function anttodo_private.validate_task_participant();

drop trigger if exists task_participants_record_activity on public.task_participants;
create trigger task_participants_record_activity
after insert or delete on public.task_participants
for each row execute function anttodo_private.record_task_participant_change();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'task_participants'
    )
  then
    alter publication supabase_realtime add table public.task_participants;
  end if;
end
$$;
