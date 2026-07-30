alter table public.tasks
  add column due_start_at timestamptz,
  add column due_is_all_day boolean not null default false;

alter table public.tasks
  add constraint tasks_due_range_order_check
  check (
    due_start_at is null
    or (due_at is not null and due_start_at <= due_at)
  ),
  add constraint tasks_due_all_day_range_check
  check (not due_is_all_day or due_start_at is not null);
