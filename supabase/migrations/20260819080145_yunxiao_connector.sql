begin;

alter table public.connector_instances
  add column target_label_id uuid;

alter table public.connector_instances
  add constraint connector_instances_id_workspace_unique unique (id, workspace_id),
  add constraint connector_instances_target_label_workspace_fkey
    foreign key (target_label_id, workspace_id)
    references public.labels(id, workspace_id) on delete restrict,
  add constraint connector_instances_yunxiao_target_label_required
    check (type <> 'yunxiao' or target_label_id is not null),
  add constraint connector_instances_yunxiao_schedule_check
    check (type <> 'yunxiao' or schedule_minutes in (5, 30, 60, 180, 1440));

alter table public.tasks
  add column external_id text,
  add column connector_id uuid,
  add column connector_platform public.connector_type;

alter table public.tasks
  add constraint tasks_connector_workspace_fkey
    foreign key (connector_id, workspace_id)
    references public.connector_instances(id, workspace_id) on delete restrict,
  add constraint tasks_external_fields_together check (
    (external_id is null and connector_id is null and connector_platform is null)
    or
    (external_id is not null and connector_id is not null and connector_platform is not null)
  ),
  add constraint tasks_external_id_nonempty check (
    external_id is null or char_length(btrim(external_id)) between 1 and 500
  );

create unique index tasks_connector_external_id_uidx
  on public.tasks (connector_id, external_id)
  where connector_id is not null;
create index connector_instances_yunxiao_owner_idx
  on public.connector_instances(created_by, workspace_id, created_at desc)
  where type = 'yunxiao';

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
        (connector.type = 'yunxiao' and connector.created_by = p_user_id)
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

revoke all on function anttodo_private.can_manage_connector_for_user(uuid, uuid)
  from public, anon, authenticated;
grant execute on function anttodo_private.can_manage_connector_for_user(uuid, uuid)
  to service_role;

create or replace function anttodo_private.can_manage_connector(p_connector_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select anttodo_private.can_manage_connector_for_user(
    p_connector_id,
    (select auth.uid())
  )
$$;
revoke all on function anttodo_private.can_manage_connector(uuid)
  from public, anon;
grant execute on function anttodo_private.can_manage_connector(uuid)
  to authenticated, service_role;

drop policy if exists connectors_select on public.connector_instances;
drop policy if exists connectors_insert on public.connector_instances;
drop policy if exists connectors_update on public.connector_instances;
drop policy if exists connectors_delete on public.connector_instances;

create policy connectors_select on public.connector_instances for select to authenticated
using (
  (type = 'yunxiao' and created_by = (select auth.uid()))
  or (type <> 'yunxiao' and (select anttodo_private.is_workspace_admin(workspace_id)))
);
create policy connectors_insert on public.connector_instances for insert to authenticated
with check (
  created_by = (select auth.uid())
  and type <> 'yunxiao'
  and (select anttodo_private.is_workspace_admin(workspace_id))
);
create policy connectors_update on public.connector_instances for update to authenticated
using (
  type <> 'yunxiao'
  and (select anttodo_private.can_manage_connector(id))
)
with check (
  type <> 'yunxiao'
  and
  (select anttodo_private.can_manage_connector(id))
);
create policy connectors_delete on public.connector_instances for delete to authenticated
using (
  type <> 'yunxiao'
  and (select anttodo_private.can_manage_connector(id))
);

drop policy if exists connector_sync_state_all on public.connector_sync_state;
drop policy if exists external_task_links_select on public.external_task_links;
drop policy if exists sync_outbox_select on public.sync_outbox;
drop policy if exists sync_runs_select on public.sync_runs;
drop policy if exists sync_conflicts_select on public.sync_conflicts;
drop policy if exists sync_conflicts_update on public.sync_conflicts;

create policy connector_sync_state_select on public.connector_sync_state
for select to authenticated
using ((select anttodo_private.can_manage_connector(connector_id)));
create policy external_task_links_select on public.external_task_links
for select to authenticated
using ((select anttodo_private.can_manage_connector(connector_id)));
create policy sync_outbox_select on public.sync_outbox
for select to authenticated
using ((select anttodo_private.can_manage_connector(connector_id)));
create policy sync_runs_select on public.sync_runs
for select to authenticated
using ((select anttodo_private.can_manage_connector(connector_id)));
create policy sync_conflicts_select on public.sync_conflicts
for select to authenticated
using ((select anttodo_private.can_manage_connector(connector_id)));
create policy sync_conflicts_update on public.sync_conflicts
for update to authenticated
using ((select anttodo_private.can_manage_connector(connector_id)))
with check ((select anttodo_private.can_manage_connector(connector_id)));

create or replace function anttodo_private.validate_external_task()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  connector public.connector_instances;
begin
  if new.connector_id is null then
    return new;
  end if;
  select * into connector
  from public.connector_instances
  where id = new.connector_id;
  if not found
    or connector.workspace_id <> new.workspace_id
    or connector.type <> new.connector_platform
  then
    raise exception 'External task connector does not match task' using errcode = '23514';
  end if;
  if new.parent_task_id is not null or new.kind <> 'todo' then
    raise exception 'External tasks must be root todo tasks' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke all on function anttodo_private.validate_external_task()
  from public, anon, authenticated;
create trigger tasks_validate_external
before insert or update of workspace_id, external_id, connector_id, connector_platform, parent_task_id, kind
on public.tasks for each row execute function anttodo_private.validate_external_task();

create or replace function anttodo_private.can_edit_task(target_task uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and not exists (
      select 1
      from public.tasks external_task
      where external_task.connector_id is not null
        and external_task.id in (
          target_task,
          anttodo_private.task_root_id(target_task)
        )
    )
    and exists (
      select 1 from public.tasks t
      join public.tasks r on r.id=anttodo_private.task_root_id(t.id)
      where t.id=target_task
        and (
          t.created_by=(select auth.uid()) or t.assignee_id=(select auth.uid())
          or r.created_by=(select auth.uid()) or r.assignee_id=(select auth.uid())
          or anttodo_private.is_workspace_admin(t.workspace_id)
          or exists(select 1 from public.task_labels tl where tl.task_id=r.id)
        )
    )
    and not exists(
      select 1 from public.task_labels tl
      where tl.task_id=anttodo_private.task_root_id(target_task)
        and anttodo_private.label_permission_level(tl.label_id)<2
    )
$$;

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
with check (
  created_by=(select auth.uid())
  and assignee_id is null and cli_assignee is null
  and external_id is null and connector_id is null and connector_platform is null
  and (select anttodo_private.is_workspace_member(workspace_id))
  and (parent_task_id is null or (select anttodo_private.can_edit_task(parent_task_id)))
);

create or replace function public.create_task_comment(
  p_task_id uuid,
  p_body text default '',
  p_image_uris text[] default array[]::text[],
  p_mentioned_user_ids uuid[] default array[]::uuid[]
) returns public.task_comments language plpgsql security definer set search_path = '' as $$
declare created public.task_comments; target_workspace uuid; mentioned uuid;
begin
  if (select auth.uid()) is null or not anttodo_private.can_view_task(p_task_id) then
    raise exception 'Insufficient task permission' using errcode='42501';
  end if;
  if exists(select 1 from public.tasks task where task.id=p_task_id and task.connector_id is not null) then
    raise exception 'Task is read-only' using errcode='42501';
  end if;
  select workspace_id into target_workspace from public.tasks where id=p_task_id;
  insert into public.task_comments(workspace_id,task_id,author_id,body,image_uris)
  values(target_workspace,p_task_id,(select auth.uid()),coalesce(p_body,''),coalesce(p_image_uris,array[]::text[]))
  returning * into created;
  foreach mentioned in array coalesce(p_mentioned_user_ids,array[]::uuid[]) loop
    insert into public.task_comment_mentions(comment_id,user_id,display_name_snapshot)
    select created.id,wm.user_id,coalesce(p.display_name,'团队成员')
    from public.workspace_members wm left join public.profiles p on p.id=wm.user_id
    where wm.workspace_id=target_workspace and wm.user_id=mentioned
    on conflict do nothing;
  end loop;
  return created;
end $$;

create or replace function public.can_user_manage_connector_label(
  p_workspace_id uuid,
  p_label_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.labels label
    where label.id = p_label_id
      and label.workspace_id = p_workspace_id
      and anttodo_private.label_permission_level_for_user(label.id, p_user_id) >= 2
  )
$$;
revoke all on function public.can_user_manage_connector_label(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.can_user_manage_connector_label(uuid, uuid, uuid)
  to service_role;

create or replace function public.set_connector_secret(
  p_connector_id uuid,
  p_actor_id uuid,
  p_secret text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_secret_id uuid; v_hint text;
begin
  if char_length(trim(p_secret)) = 0 or char_length(p_secret) > 10000 then
    raise exception 'Invalid connector secret';
  end if;
  if not anttodo_private.can_manage_connector_for_user(p_connector_id, p_actor_id) then
    raise exception 'Connector administrator access required' using errcode='42501';
  end if;
  select credential_secret_id into v_secret_id
  from public.connector_instances where id=p_connector_id;
  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      p_secret,
      'anttodo_' || p_connector_id::text,
      'AntTodo connector credential'
    );
  else
    perform vault.update_secret(v_secret_id, p_secret);
  end if;
  v_hint := '••••' || right(p_secret, 4);
  update public.connector_instances
  set credential_secret_id=v_secret_id, credential_hint=v_hint
  where id=p_connector_id;
  return v_hint;
end $$;

create or replace function public.delete_connector_secret(
  p_connector_id uuid,
  p_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_secret_id uuid;
begin
  if not anttodo_private.can_manage_connector_for_user(p_connector_id, p_actor_id) then
    raise exception 'Connector administrator access required' using errcode='42501';
  end if;
  select credential_secret_id into v_secret_id
  from public.connector_instances where id=p_connector_id;
  if v_secret_id is not null then delete from vault.secrets where id=v_secret_id; end if;
  update public.connector_instances
  set credential_secret_id=null, credential_hint=null
  where id=p_connector_id;
  return true;
end $$;

create or replace function public.get_connector_secret(p_connector_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select secret.decrypted_secret
  from public.connector_instances connector
  join vault.decrypted_secrets secret on secret.id=connector.credential_secret_id
  where connector.id=p_connector_id
$$;
revoke all on function public.get_connector_secret(uuid)
  from public, anon, authenticated;
grant execute on function public.get_connector_secret(uuid) to service_role;

create or replace function public.upsert_yunxiao_external_task(
  p_connector_id uuid,
  p_task_id uuid,
  p_external_id text,
  p_title text,
  p_description text,
  p_status public.task_status,
  p_remote_updated_at timestamptz,
  p_external_version text default null
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
  select task.id into existing_id
  from public.tasks task
  where task.connector_id=p_connector_id and task.external_id=btrim(p_external_id)
  for update;
  if existing_id is null then
    existing_id := p_task_id;
    insert into public.tasks(
      id,workspace_id,title,description,status,kind,priority,created_by,
      completed_at,external_id,connector_id,connector_platform
    ) values (
      existing_id,connector.workspace_id,
      left(coalesce(nullif(btrim(p_title),''),'未命名云效工作项'),500),
      coalesce(p_description,''),p_status,'todo','none',connector.created_by,
      case when p_status='completed' then coalesce(p_remote_updated_at,now()) else null end,
      btrim(p_external_id),connector.id,'yunxiao'
    );
    was_created := true;
  else
    update public.tasks
    set title=left(coalesce(nullif(btrim(p_title),''),'未命名云效工作项'),500),
        description=coalesce(p_description,''),
        status=p_status,
        completed_at=case when p_status='completed'
          then coalesce(completed_at,p_remote_updated_at,now()) else null end,
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
  uuid,uuid,text,text,text,public.task_status,timestamptz,text
) from public,anon,authenticated;
grant execute on function public.upsert_yunxiao_external_task(
  uuid,uuid,text,text,text,public.task_status,timestamptz,text
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
    and task.created_by=p_actor_id
    and connector.created_by=p_actor_id
    and connector.enabled
  for update of task;
  if not found then raise exception 'External task completion forbidden' using errcode='42501'; end if;
  if result.status <> 'completed' then
    update public.tasks set status='completed',completed_at=now()
    where id=p_task_id returning * into result;
  end if;
  return result;
end $$;
revoke all on function public.complete_yunxiao_external_task_local(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.complete_yunxiao_external_task_local(uuid,uuid)
  to service_role;

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
    where type='yunxiao' and enabled and next_sync_at<=now()
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
revoke all on function anttodo_private.invoke_yunxiao_connector_sync()
  from public,anon,authenticated;
grant execute on function anttodo_private.invoke_yunxiao_connector_sync()
  to service_role;

do $$
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    if exists(select 1 from cron.job where jobname='anttodo-yunxiao-sync') then
      perform cron.unschedule('anttodo-yunxiao-sync');
    end if;
    perform cron.schedule(
      'anttodo-yunxiao-sync','* * * * *',
      'select anttodo_private.invoke_yunxiao_connector_sync()'
    );
  end if;
end $$;

commit;
