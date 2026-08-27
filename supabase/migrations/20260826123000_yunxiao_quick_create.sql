begin;

create unique index if not exists connector_instances_yunxiao_quick_create_uidx
  on public.connector_instances (workspace_id)
  where type = 'yunxiao' and public_config->>'kind' = 'quick_create';

create or replace function anttodo_private.can_manage_connector_for_user(
  p_connector_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.connector_instances connector
    where connector.id = p_connector_id
      and p_user_id is not null
      and (
        (
          connector.type = 'yunxiao'
          and connector.public_config->>'kind' = 'quick_create'
          and exists (
            select 1 from public.workspace_members member
            where member.workspace_id = connector.workspace_id
              and member.user_id = p_user_id
              and member.role in ('owner', 'admin')
          )
        )
        or
        (
          connector.type = 'yunxiao'
          and coalesce(connector.public_config->>'kind', '') is distinct from 'quick_create'
          and connector.created_by = p_user_id
        )
        or
        (connector.type <> 'yunxiao' and exists (
          select 1 from public.workspace_members member
          where member.workspace_id = connector.workspace_id
            and member.user_id = p_user_id
            and member.role in ('owner', 'admin')
        ))
      )
  )
$$;

drop policy if exists connectors_select on public.connector_instances;
create policy connectors_select on public.connector_instances for select to authenticated
using (
  (type = 'yunxiao' and created_by = (select auth.uid()))
  or (
    type = 'yunxiao'
    and public_config->>'kind' = 'quick_create'
    and (select anttodo_private.is_workspace_member(workspace_id))
  )
  or (type <> 'yunxiao' and (select anttodo_private.is_workspace_admin(workspace_id)))
);

create or replace function anttodo_private.invoke_yunxiao_connector_sync()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  connector record;
  invoked integer := 0;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets
    where name='anttodo_project_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets
    where name='anttodo_reminder_dispatch_secret' limit 1;
  if nullif(v_url,'') is null or nullif(v_secret,'') is null then return 0; end if;
  for connector in
    select id,schedule_minutes from public.connector_instances
    where type='yunxiao'
      and enabled
      and next_sync_at<=now()
      and coalesce(public_config->>'kind','') is distinct from 'quick_create'
    order by next_sync_at for update skip locked limit 20
  loop
    update public.connector_instances
    set next_sync_at=now()+make_interval(mins=>greatest(connector.schedule_minutes,5))
    where id=connector.id;
    perform net.http_post(
      url:=rtrim(v_url,'/')||'/functions/v1/connector-sync',
      headers:=jsonb_build_object(
        'Content-Type','application/json',
        'x-anttodo-dispatch-secret',v_secret
      ),
      body:=jsonb_build_object('connectorId',connector.id)
    );
    invoked:=invoked+1;
  end loop;
  return invoked;
end $$;

drop function if exists public.upsert_yunxiao_external_task(
  uuid,uuid,text,text,text,public.task_status,timestamptz,text,timestamptz,timestamptz,boolean,text
);

create function public.upsert_yunxiao_external_task(
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
  p_due_timezone text default null,
  p_created_by uuid default null
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
  v_due_at timestamptz := p_due_at;
  v_due_start_at timestamptz := p_due_start_at;
  v_due_is_all_day boolean := coalesce(p_due_is_all_day, false);
  v_created_by uuid;
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
  v_created_by := coalesce(p_created_by, connector.created_by);
  if v_due_start_at is not null and v_due_at is null then
    v_due_at := v_due_start_at;
  end if;
  if v_due_start_at is not null and v_due_at is not null and v_due_start_at > v_due_at then
    v_due_start_at := v_due_at;
    v_due_at := p_due_start_at;
  end if;
  if v_due_is_all_day and v_due_start_at is null and v_due_at is not null then
    v_due_start_at := v_due_at;
  end if;
  if v_due_at is null then
    v_due_start_at := null;
    v_due_is_all_day := false;
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
      coalesce(p_description,''),p_status,'todo','none',v_created_by,
      case when p_status='completed' then coalesce(p_remote_updated_at,now()) else null end,
      btrim(p_external_id),connector.id,'yunxiao',
      v_due_at,v_due_start_at,v_due_is_all_day,nullif(btrim(coalesce(p_due_timezone,'')),'')
    );
    was_created := true;
  else
    update public.tasks
    set title=left(coalesce(nullif(btrim(p_title),''),'未命名云效工作项'),500),
        description=coalesce(p_description,''),
        status=p_status,
        completed_at=case when p_status='completed'
          then coalesce(completed_at,p_remote_updated_at,now()) else null end,
        due_at=v_due_at,
        due_start_at=v_due_start_at,
        due_is_all_day=v_due_is_all_day,
        due_timezone=nullif(btrim(coalesce(p_due_timezone,'')),'')
    where id=existing_id;
  end if;
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
  uuid,uuid,text,text,text,public.task_status,timestamptz,text,timestamptz,timestamptz,boolean,text,uuid
) from public,anon,authenticated;
grant execute on function public.upsert_yunxiao_external_task(
  uuid,uuid,text,text,text,public.task_status,timestamptz,text,timestamptz,timestamptz,boolean,text,uuid
) to service_role;

create or replace function public.complete_yunxiao_external_task_local(
  p_task_id uuid,
  p_actor_id uuid
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare result public.tasks;
begin
  select task.* into result
  from public.tasks task
  join public.connector_instances connector on connector.id=task.connector_id
  where task.id=p_task_id
    and task.connector_platform='yunxiao'
    and connector.enabled
    and (
      (
        connector.public_config->>'kind' = 'quick_create'
        and (task.created_by=p_actor_id or connector.created_by=p_actor_id)
      )
      or
      (
        coalesce(connector.public_config->>'kind','') is distinct from 'quick_create'
        and task.created_by=p_actor_id
        and connector.created_by=p_actor_id
      )
    )
  for update of task;
  if not found then raise exception 'External task completion forbidden' using errcode='42501'; end if;
  if result.status <> 'completed' then
    update public.tasks set status='completed',completed_at=now()
    where id=p_task_id returning * into result;
  end if;
  return result;
end $$;

commit;
