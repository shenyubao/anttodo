create type public.task_list_filter_creator as enum (
  'all', 'created_by_me'
);

alter table public.task_list_preferences
  add column filter_creator public.task_list_filter_creator not null default 'all';
