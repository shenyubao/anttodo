-- Store all selected due-date buckets so the client can apply them as a union.
alter table public.task_list_preferences
  alter column filter_due drop default;

alter table public.task_list_preferences
  alter column filter_due type public.task_list_filter_due[]
  using array[filter_due];

alter table public.task_list_preferences
  alter column filter_due set default array['all'::public.task_list_filter_due];

alter table public.task_list_preferences
  drop constraint if exists task_list_preferences_filter_due_check;

alter table public.task_list_preferences
  add constraint task_list_preferences_filter_due_check check (
    cardinality(filter_due) > 0
    and (
      cardinality(filter_due) = 1
      or not ('all'::public.task_list_filter_due = any(filter_due))
    )
  );
