alter table public.tasks
  add column estimate_hours numeric(8, 1) null,
  add column actual_hours numeric(8, 1) null;

alter table public.tasks
  add constraint tasks_estimate_hours_non_negative
    check (estimate_hours is null or estimate_hours >= 0),
  add constraint tasks_actual_hours_non_negative
    check (actual_hours is null or actual_hours >= 0);

alter table public.task_list_preferences
  add column show_hours boolean not null default false;
