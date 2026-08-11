alter table public.tasks
  add column estimate_pomodoros integer null,
  add column actual_pomodoros integer null;

alter table public.tasks
  add constraint tasks_estimate_pomodoros_non_negative
    check (estimate_pomodoros is null or estimate_pomodoros >= 0),
  add constraint tasks_actual_pomodoros_non_negative
    check (actual_pomodoros is null or actual_pomodoros >= 0);

alter table public.subtasks
  add column estimate_pomodoros integer null,
  add column actual_pomodoros integer null;

alter table public.subtasks
  add constraint subtasks_estimate_pomodoros_non_negative
    check (estimate_pomodoros is null or estimate_pomodoros >= 0),
  add constraint subtasks_actual_pomodoros_non_negative
    check (actual_pomodoros is null or actual_pomodoros >= 0);
