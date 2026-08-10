-- Allow hiding and ordering every system smart view.
alter table public.task_system_view_preferences
  drop constraint if exists task_system_view_preferences_view_key_check;

alter table public.task_system_view_preferences
  add constraint task_system_view_preferences_view_key_check
  check (view_key in (
    'all',
    'today',
    'week',
    'assigned',
    'watching',
    'inbox',
    'trash'
  ));

alter table public.task_system_view_preferences
  add column if not exists position integer not null default 0;
