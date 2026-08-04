alter table public.task_list_preferences
  add column view_mode text not null default 'list'
  check (view_mode in ('list', 'kanban'));
