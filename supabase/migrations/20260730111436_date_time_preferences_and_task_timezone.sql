create table public.user_date_time_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  time_format text not null default '24h'
    check (time_format in ('12h', '24h')),
  date_format text not null default 'ymd'
    check (date_format in ('mdy', 'dmy', 'ymd')),
  week_starts_on smallint not null default 1
    check (week_starts_on between 0 and 6),
  show_lunar boolean not null default false,
  show_week_numbers boolean not null default true,
  show_holiday_adjustments boolean not null default true,
  time_zone_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_date_time_preferences enable row level security;

create policy user_date_time_preferences_select_self
on public.user_date_time_preferences
for select to authenticated
using (user_id = (select auth.uid()));

create policy user_date_time_preferences_insert_self
on public.user_date_time_preferences
for insert to authenticated
with check (user_id = (select auth.uid()));

create policy user_date_time_preferences_update_self
on public.user_date_time_preferences
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

grant select, insert, update on public.user_date_time_preferences to authenticated;

alter table public.tasks
  add column due_timezone text,
  add constraint tasks_due_timezone_length_check
    check (due_timezone is null or char_length(due_timezone) between 1 and 100);

drop function if exists public.create_task_with_labels(
  uuid, text, uuid[], text, timestamptz, public.task_priority, uuid
);

create function public.create_task_with_labels(
  p_workspace_id uuid,
  p_title text,
  p_label_ids uuid[],
  p_description text default '',
  p_due_at timestamptz default null,
  p_priority public.task_priority default 'none',
  p_assignee_id uuid default null,
  p_due_timezone text default null
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_task public.tasks;
  label_id uuid;
begin
  foreach label_id in array coalesce(p_label_ids, array[]::uuid[]) loop
    if anttodo_private.label_permission_level(label_id) < 2
      or not exists (
        select 1 from public.labels
        where id = label_id
          and workspace_id = p_workspace_id
      ) then
      raise exception 'Insufficient label permission';
    end if;
  end loop;

  created_task.id := extensions.gen_random_uuid();

  insert into public.tasks (
    id, workspace_id, title, description, due_at, due_timezone,
    priority, assignee_id, created_by
  ) values (
    created_task.id, p_workspace_id, p_title, coalesce(p_description, ''),
    p_due_at, p_due_timezone, p_priority, p_assignee_id, (select auth.uid())
  );

  insert into public.task_labels (task_id, label_id)
  select created_task.id, unnest(coalesce(p_label_ids, array[]::uuid[]));

  select *
  into created_task
  from public.tasks
  where tasks.id = created_task.id;

  insert into public.activity_events (workspace_id, task_id, actor_id, event_type)
  values (p_workspace_id, created_task.id, (select auth.uid()), 'task.created');

  return created_task;
end;
$$;

revoke all on function public.create_task_with_labels(
  uuid, text, uuid[], text, timestamptz, public.task_priority, uuid, text
) from public, anon;

grant execute on function public.create_task_with_labels(
  uuid, text, uuid[], text, timestamptz, public.task_priority, uuid, text
) to authenticated;
