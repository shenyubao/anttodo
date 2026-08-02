alter table public.task_list_preferences
  add column show_completed boolean not null default false;
