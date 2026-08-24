begin;

create or replace function anttodo_private.bump_parent_task_version()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_task uuid := coalesce((to_jsonb(new) ->> 'task_id')::uuid, (to_jsonb(old) ->> 'task_id')::uuid);
begin
  update public.tasks set updated_at = now() where id = target_task;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function anttodo_private.record_task_label_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_task_id uuid := coalesce(new.task_id, old.task_id);
  selected_label_id uuid := coalesce(new.label_id, old.label_id);
  selected_workspace_id uuid;
  selected_label_name text;
  selected_label_color text;
begin
  select t.workspace_id into selected_workspace_id from public.tasks t where t.id = selected_task_id;
  if selected_workspace_id is null then return coalesce(new, old); end if;
  select l.name, l.color into selected_label_name, selected_label_color
  from public.labels l where l.id = selected_label_id;

  insert into public.activity_events(workspace_id, task_id, actor_id, event_type, payload)
  values (
    selected_workspace_id,
    selected_task_id,
    (select auth.uid()),
    case when tg_op = 'INSERT' then 'task.label_added' else 'task.label_removed' end,
    jsonb_build_object(
      'label_id', selected_label_id,
      'label_name', coalesce(selected_label_name, '标签'),
      'label_color', coalesce(selected_label_color, '#8f959e')
    )
  );
  return coalesce(new, old);
end;
$$;

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (deleted_at is not null and (select anttodo_private.can_organize_task(id)));

alter policy task_labels_insert
on public.task_labels
with check (
  (select anttodo_private.label_permission_level(label_id)) >= 2
  and (
    (select anttodo_private.is_task_creator(task_id))
    or (select anttodo_private.can_organize_task(task_id))
  )
);

drop policy if exists task_labels_delete on public.task_labels;
create policy task_labels_delete on public.task_labels for delete to authenticated
using ((select anttodo_private.can_organize_task(task_id)));

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
  v_due_at timestamptz := p_due_at;
  v_due_start_at timestamptz := p_due_start_at;
  v_due_is_all_day boolean := coalesce(p_due_is_all_day, false);
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
      coalesce(p_description,''),p_status,'todo','none',connector.created_by,
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
  uuid,uuid,text,text,text,public.task_status,timestamptz,text,timestamptz,timestamptz,boolean,text
) from public,anon,authenticated;
grant execute on function public.upsert_yunxiao_external_task(
  uuid,uuid,text,text,text,public.task_status,timestamptz,text,timestamptz,timestamptz,boolean,text
) to service_role;

commit;
