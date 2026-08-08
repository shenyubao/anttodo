create type public.task_list_filter_watching as enum (
  'all', 'watching'
);

alter table public.task_list_preferences
  add column filter_watching public.task_list_filter_watching not null default 'all';

update public.task_list_preferences
set
  filter_watching = 'watching',
  filter_assignee = 'all'
where filter_assignee = 'watching';

alter type public.task_list_filter_assignee rename to task_list_filter_assignee_old;

create type public.task_list_filter_assignee as enum (
  'all', 'assigned_to_me'
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
