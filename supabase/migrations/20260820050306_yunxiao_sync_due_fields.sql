begin;

drop function if exists public.upsert_yunxiao_external_task(
  uuid, uuid, text, text, text, public.task_status, timestamptz, text
);

create or replace function public.upsert_yunxiao_external_task(
  p_connector_id uuid,
  p_task_id uuid,
  p_external_id text,
  p_title text,
  p_description text,
  p_status public.task_status,
  p_remote_updated_at timestamptz,
  p_external_version text default null,
  p_due_at timestamptz default null,
  p_due_start_at timestamptz default null,
  p_due_is_all_day boolean default false,
  p_due_timezone text default null
)
returns table(task_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  connector public.connector_instances;
  existing_id uuid;
  was_created boolean := false;
  due_at timestamptz := p_due_at;
  due_start_at timestamptz := p_due_start_at;
  due_is_all_day boolean := coalesce(p_due_is_all_day, false);
begin
  select * into connector from public.connector_instances
  where id=p_connector_id and type='yunxiao' and enabled
  for update;
  if not found or connector.target_label_id is null then
    raise exception 'Yunxiao connector is not enabled' using errcode='42501';
  end if;
  if p_status not in ('open','completed') then
    raise exception 'Invalid external task status' using errcode='22023';
  end if;
  if due_start_at is not null and due_at is null then
    due_at := due_start_at;
  end if;
  if due_start_at is not null and due_at is not null and due_start_at > due_at then
    due_start_at := due_at;
    due_at := p_due_start_at;
  end if;
  if due_is_all_day and due_start_at is null and due_at is not null then
    due_start_at := due_at;
  end if;
  if due_at is null then
    due_start_at := null;
    due_is_all_day := false;
  end if;
  select task.id into existing_id
  from public.tasks task
  where task.connector_id=p_connector_id and task.external_id=btrim(p_external_id)
  for update;
  if existing_id is null then
    existing_id := p_task_id;
    insert into public.tasks(
      id,workspace_id,title,description,status,kind,priority,created_by,
      completed_at,external_id,connector_id,connector_platform,
      due_at,due_start_at,due_is_all_day,due_timezone
    ) values (
      existing_id,connector.workspace_id,
      left(coalesce(nullif(btrim(p_title),''),'未命名云效工作项'),500),
      coalesce(p_description,''),p_status,'todo','none',connector.created_by,
      case when p_status='completed' then coalesce(p_remote_updated_at,now()) else null end,
      btrim(p_external_id),connector.id,'yunxiao',
      due_at,due_start_at,due_is_all_day,nullif(btrim(coalesce(p_due_timezone,'')),'')
    );
    was_created := true;
  else
    update public.tasks
    set title=left(coalesce(nullif(btrim(p_title),''),'未命名云效工作项'),500),
        description=coalesce(p_description,''),
        status=p_status,
        completed_at=case when p_status='completed'
          then coalesce(completed_at,p_remote_updated_at,now()) else null end,
        due_at=due_at,
        due_start_at=due_start_at,
        due_is_all_day=due_is_all_day,
        due_timezone=nullif(btrim(coalesce(p_due_timezone,'')),''),
        deleted_at=null
    where id=existing_id;
  end if;
  delete from public.task_labels task_label
  where task_label.task_id=existing_id and task_label.label_id<>connector.target_label_id;
  insert into public.task_labels(task_id,label_id)
  values(existing_id,connector.target_label_id) on conflict do nothing;
  insert into public.external_task_links(
    connector_id,task_id,external_id,external_version,remote_updated_at,
    last_local_version,last_synced_at
  )
  select connector.id,existing_id,btrim(p_external_id),p_external_version,
    p_remote_updated_at,task.version,now()
  from public.tasks task where task.id=existing_id
  on conflict (connector_id,external_id) do update set
    task_id=excluded.task_id,
    external_version=excluded.external_version,
    remote_updated_at=excluded.remote_updated_at,
    last_local_version=excluded.last_local_version,
    last_synced_at=excluded.last_synced_at;
  return query select existing_id,was_created;
end $$;
revoke all on function public.upsert_yunxiao_external_task(
  uuid,uuid,text,text,text,public.task_status,timestamptz,text,timestamptz,timestamptz,boolean,text
) from public,anon,authenticated;
grant execute on function public.upsert_yunxiao_external_task(
  uuid,uuid,text,text,text,public.task_status,timestamptz,text,timestamptz,timestamptz,boolean,text
) to service_role;

commit;
