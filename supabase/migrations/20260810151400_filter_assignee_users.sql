-- Expand assignee filter: exclusive modes + multi-select user ids.

alter type public.task_list_filter_assignee rename to task_list_filter_assignee_old;

create type public.task_list_filter_assignee as enum (
  'all', 'unassigned', 'assigned_to_me', 'users'
);

alter table public.task_list_preferences
  alter column filter_assignee drop default;

alter table public.task_list_preferences
  alter column filter_assignee type public.task_list_filter_assignee
  using (
    case
      when filter_assignee::text = 'assigned_to_me' then 'assigned_to_me'
      else 'all'
    end
  )::public.task_list_filter_assignee;

alter table public.task_list_preferences
  alter column filter_assignee set default 'all';

drop type public.task_list_filter_assignee_old;

alter table public.task_list_preferences
  add column filter_assignee_ids uuid[] not null default '{}';

alter table public.task_list_preferences
  add constraint task_list_preferences_filter_assignee_ids_check check (
    (
      filter_assignee = 'users'
      and cardinality(filter_assignee_ids) > 0
    )
    or (
      filter_assignee <> 'users'
      and cardinality(filter_assignee_ids) = 0
    )
  );
