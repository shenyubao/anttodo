-- Activity belongs to the exact task that produced it. Parent task timelines do
-- not aggregate descendants, and child task timelines do not include parents.
create or replace function public.list_task_activity(
  p_task_id uuid,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50
)
returns setof public.activity_events
language sql
stable
security invoker
set search_path = ''
as $$
  select ae.*
  from public.activity_events ae
  where ae.task_id = p_task_id
    and (
      p_before_created_at is null
      or (ae.created_at, ae.id) < (p_before_created_at, p_before_id)
    )
  order by ae.created_at desc, ae.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

revoke all on function public.list_task_activity(uuid, timestamptz, uuid, integer)
from public, anon;
grant execute on function public.list_task_activity(uuid, timestamptz, uuid, integer)
to authenticated;
