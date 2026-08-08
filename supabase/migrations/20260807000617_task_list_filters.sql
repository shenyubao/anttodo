create type public.task_list_filter_assignee as enum (
  'all', 'assigned_to_me', 'watching'
);

create type public.task_list_filter_due as enum (
  'all', 'overdue', 'today', 'tomorrow', 'next_7_days', 'next_30_days'
);

alter table public.task_list_preferences
  add column filter_assignee public.task_list_filter_assignee not null default 'all',
  add column filter_due public.task_list_filter_due not null default 'all';
