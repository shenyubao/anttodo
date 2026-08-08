alter table public.task_list_preferences
  drop constraint if exists task_list_preferences_view_mode_check;

alter table public.task_list_preferences
  add constraint task_list_preferences_view_mode_check
  check (view_mode in ('list', 'kanban', 'timeline'));
