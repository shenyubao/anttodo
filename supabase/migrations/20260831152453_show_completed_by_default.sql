-- Apply the new default to future preferences without overwriting saved choices.
alter table public.task_list_preferences
  alter column show_completed set default true;
