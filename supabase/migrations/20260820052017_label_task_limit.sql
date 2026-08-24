-- Cache live task counts per label and reject associations beyond 10000.

create table anttodo_private.label_task_counts (
  label_id uuid primary key references public.labels(id) on delete cascade,
  task_count integer not null default 0 check (task_count >= 0)
);

revoke all on table anttodo_private.label_task_counts from public, anon, authenticated;

insert into anttodo_private.label_task_counts (label_id, task_count)
select
  task_label.label_id,
  count(*)::integer
from public.task_labels task_label
join public.tasks task on task.id = task_label.task_id
where task.deleted_at is null
group by task_label.label_id
on conflict (label_id) do update
set task_count = excluded.task_count;

create or replace function anttodo_private.adjust_label_live_task_count(
  p_label_id uuid,
  p_delta integer,
  p_enforce_limit boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_count integer;
begin
  if p_delta = 0 then
    return;
  end if;

  if not exists (select 1 from public.labels where id = p_label_id) then
    return;
  end if;

  insert into anttodo_private.label_task_counts(label_id, task_count)
  values (p_label_id, 0)
  on conflict (label_id) do nothing;

  perform 1
  from anttodo_private.label_task_counts
  where label_id = p_label_id
  for update;

  update anttodo_private.label_task_counts
  set task_count = greatest(0, task_count + p_delta)
  where label_id = p_label_id
  returning task_count into next_count;

  if p_enforce_limit and p_delta > 0 and next_count > 10000 then
    raise exception 'label_task_limit_exceeded';
  end if;
end;
$$;

revoke all on function anttodo_private.adjust_label_live_task_count(uuid, integer, boolean)
from public, anon, authenticated;

create or replace function anttodo_private.sync_label_task_count_on_task_label()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_task public.tasks%rowtype;
  target_label_id uuid;
begin
  target_label_id := coalesce(new.label_id, old.label_id);
  select * into target_task
  from public.tasks
  where id = coalesce(new.task_id, old.task_id);

  if not found or target_task.deleted_at is not null then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    perform anttodo_private.adjust_label_live_task_count(target_label_id, 1, true);
    return new;
  end if;

  perform anttodo_private.adjust_label_live_task_count(target_label_id, -1, false);
  return old;
end;
$$;

create trigger task_labels_sync_label_task_count
after insert or delete on public.task_labels
for each row execute function anttodo_private.sync_label_task_count_on_task_label();

create or replace function anttodo_private.sync_label_task_counts_on_task_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  label_row record;
  going_deleted boolean;
  going_live boolean;
begin
  going_deleted := old.deleted_at is null and new.deleted_at is not null;
  going_live := old.deleted_at is not null and new.deleted_at is null;
  if not going_deleted and not going_live then
    return new;
  end if;

  for label_row in
    select label_id from public.task_labels where task_id = new.id
  loop
    perform anttodo_private.adjust_label_live_task_count(
      label_row.label_id,
      case when going_deleted then -1 else 1 end,
      false
    );
  end loop;
  return new;
end;
$$;

create trigger tasks_sync_label_task_counts
after update of deleted_at on public.tasks
for each row execute function anttodo_private.sync_label_task_counts_on_task_deleted();

create or replace function public.list_label_task_counts(p_workspace_id uuid)
returns table(label_id uuid, task_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not anttodo_private.is_workspace_member(p_workspace_id) then
    raise exception 'not authorized';
  end if;

  return query
  select label.id, coalesce(counts.task_count, 0)
  from public.labels label
  left join anttodo_private.label_task_counts counts on counts.label_id = label.id
  where label.workspace_id = p_workspace_id
    and anttodo_private.label_permission_level(label.id) >= 1;
end;
$$;

revoke all on function public.list_label_task_counts(uuid) from public, anon;
grant execute on function public.list_label_task_counts(uuid) to authenticated;
grant execute on function public.list_label_task_counts(uuid) to service_role;

notify pgrst, 'reload schema';
