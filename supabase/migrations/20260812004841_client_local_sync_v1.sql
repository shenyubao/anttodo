-- Local-first client synchronization primitives. The server remains the source
-- of truth: the client only submits explicit, idempotent operations.

alter table public.tasks alter column version type bigint using version::bigint;
alter table public.subtasks add column if not exists version bigint not null default 1;
alter table public.labels add column if not exists version bigint not null default 1;
alter table public.task_comments add column if not exists version bigint not null default 1;
alter table public.task_list_placements add column if not exists version bigint not null default 1;

create table if not exists anttodo_private.client_change_log (
  seq bigint generated always as identity primary key,
  workspace_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  operation text not null check (operation in ('upsert', 'delete')),
  version bigint,
  payload jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists client_change_log_workspace_seq_idx
  on anttodo_private.client_change_log(workspace_id, seq);

create table if not exists anttodo_private.client_applied_operations (
  operation_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (operation_id, user_id)
);

create table if not exists public.client_devices (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('mac', 'web', 'ios', 'cli')),
  name text not null default '',
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table if not exists public.client_device_cursors (
  device_id uuid not null references public.client_devices(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cursor bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (device_id, workspace_id)
);
create table if not exists public.client_sync_ticks (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  head bigint not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists public.client_sync_conflicts (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  device_id uuid references public.client_devices(id) on delete set null,
  entity_type text not null,
  entity_id uuid not null,
  operation_id uuid,
  local_payload jsonb not null default '{}'::jsonb,
  remote_payload jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved_local', 'resolved_remote')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create table if not exists public.attachment_cleanup_queue (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  bucket text not null,
  object_path text not null,
  canonical_uri text not null,
  requested_by uuid not null references auth.users(id) on delete cascade,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (bucket, object_path)
);

alter table public.client_devices enable row level security;
alter table public.client_device_cursors enable row level security;
alter table public.client_sync_ticks enable row level security;
alter table public.client_sync_conflicts enable row level security;
alter table public.attachment_cleanup_queue enable row level security;

drop policy if exists client_devices_owner on public.client_devices;
create policy client_devices_owner on public.client_devices
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists client_device_cursors_owner on public.client_device_cursors;
create policy client_device_cursors_owner on public.client_device_cursors
  for all to authenticated
  using (exists (select 1 from public.client_devices d where d.id = device_id and d.user_id = (select auth.uid())))
  with check (exists (select 1 from public.client_devices d where d.id = device_id and d.user_id = (select auth.uid())));
drop policy if exists client_sync_ticks_member on public.client_sync_ticks;
create policy client_sync_ticks_member on public.client_sync_ticks
  for select to authenticated using ((select anttodo_private.is_workspace_member(workspace_id)));
drop policy if exists client_sync_conflicts_owner on public.client_sync_conflicts;
create policy client_sync_conflicts_owner on public.client_sync_conflicts
  for select to authenticated using (exists (select 1 from public.client_devices d where d.id = device_id and d.user_id = (select auth.uid())));
drop policy if exists attachment_cleanup_queue_owner on public.attachment_cleanup_queue;
create policy attachment_cleanup_queue_owner on public.attachment_cleanup_queue
  for select to authenticated using (requested_by = (select auth.uid()));

grant select, insert, update, delete on public.client_devices to authenticated;
grant select, insert, update, delete on public.client_device_cursors to authenticated;
grant select on public.client_sync_ticks to authenticated;
grant select on public.client_sync_conflicts to authenticated;
grant select on public.attachment_cleanup_queue to authenticated;

create or replace function anttodo_private.bump_client_version()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.version := greatest(coalesce(old.version, 0) + 1, coalesce(new.version, 0));
  return new;
end;
$$;

drop trigger if exists tasks_client_version on public.tasks;
create trigger tasks_client_version before update on public.tasks
for each row execute function anttodo_private.bump_client_version();
drop trigger if exists subtasks_client_version on public.subtasks;
create trigger subtasks_client_version before update on public.subtasks
for each row execute function anttodo_private.bump_client_version();
drop trigger if exists labels_client_version on public.labels;
create trigger labels_client_version before update on public.labels
for each row execute function anttodo_private.bump_client_version();
drop trigger if exists task_comments_client_version on public.task_comments;
create trigger task_comments_client_version before update on public.task_comments
for each row execute function anttodo_private.bump_client_version();
drop trigger if exists task_list_placements_client_version on public.task_list_placements;
create trigger task_list_placements_client_version before update on public.task_list_placements
for each row execute function anttodo_private.bump_client_version();

create or replace function anttodo_private.record_client_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  record_payload jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  target_workspace uuid := nullif(record_payload ->> 'workspace_id', '')::uuid;
  target_entity uuid := (record_payload ->> 'id')::uuid;
  target_version bigint := nullif(record_payload ->> 'version', '')::bigint;
begin
  if target_workspace is null and record_payload ? 'task_id' then
    select workspace_id into target_workspace from public.tasks where id = (record_payload ->> 'task_id')::uuid;
  end if;
  if target_workspace is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if target_entity is null then
    target_entity := coalesce((record_payload ->> 'task_id')::uuid, (record_payload ->> 'label_id')::uuid);
  end if;
  insert into anttodo_private.client_change_log
    (workspace_id, entity_type, entity_id, operation, version, payload, changed_by)
  values (
    target_workspace, tg_table_name, target_entity,
    case when tg_op = 'DELETE' then 'delete' else 'upsert' end,
    target_version, record_payload, (select auth.uid())
  );
  insert into public.client_sync_ticks(workspace_id, head)
    values (target_workspace, currval(pg_get_serial_sequence('anttodo_private.client_change_log', 'seq')))
    on conflict (workspace_id) do update set head = excluded.head, updated_at = now();
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function anttodo_private.record_client_change() from public, anon, authenticated;

drop trigger if exists tasks_client_change_log on public.tasks;
create trigger tasks_client_change_log after insert or update or delete on public.tasks
for each row execute function anttodo_private.record_client_change();
drop trigger if exists subtasks_client_change_log on public.subtasks;
create trigger subtasks_client_change_log after insert or update or delete on public.subtasks
for each row execute function anttodo_private.record_client_change();
drop trigger if exists labels_client_change_log on public.labels;
create trigger labels_client_change_log after insert or update or delete on public.labels
for each row execute function anttodo_private.record_client_change();
drop trigger if exists task_comments_client_change_log on public.task_comments;
create trigger task_comments_client_change_log after insert or update or delete on public.task_comments
for each row execute function anttodo_private.record_client_change();
drop trigger if exists task_list_placements_client_change_log on public.task_list_placements;
create trigger task_list_placements_client_change_log after insert or update or delete on public.task_list_placements
for each row execute function anttodo_private.record_client_change();

create or replace function anttodo_private.bump_parent_task_version()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare target_task uuid := coalesce((to_jsonb(new) ->> 'task_id')::uuid, (to_jsonb(old) ->> 'task_id')::uuid);
begin
  update public.tasks set updated_at = now() where id = target_task;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists task_labels_bump_task_version on public.task_labels;
create trigger task_labels_bump_task_version after insert or update or delete on public.task_labels
for each row execute function anttodo_private.bump_parent_task_version();
drop trigger if exists task_reminders_bump_task_version on public.task_reminders;
create trigger task_reminders_bump_task_version after insert or update or delete on public.task_reminders
for each row execute function anttodo_private.bump_parent_task_version();
drop trigger if exists task_reminder_settings_bump_task_version on public.task_reminder_settings;
create trigger task_reminder_settings_bump_task_version after insert or update or delete on public.task_reminder_settings
for each row execute function anttodo_private.bump_parent_task_version();
drop trigger if exists task_comment_mentions_bump_comment_version on public.task_comment_mentions;
create or replace function anttodo_private.bump_parent_comment_version()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  update public.task_comments set updated_at = now() where id = coalesce(new.comment_id, old.comment_id);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger task_comment_mentions_bump_comment_version after insert or update or delete on public.task_comment_mentions
for each row execute function anttodo_private.bump_parent_comment_version();

create or replace function public.register_client_device(
  p_device_id uuid, p_platform text, p_name text default ''
) returns public.client_devices
language plpgsql security invoker set search_path = '' as $$
declare result public.client_devices;
begin
  insert into public.client_devices(id, user_id, platform, name)
  values (p_device_id, (select auth.uid()), p_platform, coalesce(p_name, ''))
  on conflict (id) do update set platform = excluded.platform, name = excluded.name, last_seen_at = now()
  returning * into result;
  return result;
end;
$$;

create or replace function public.get_client_sync_head(p_workspace_id uuid)
returns bigint language sql security invoker set search_path = '' as $$
  select coalesce((select head from public.client_sync_ticks where workspace_id = p_workspace_id), 0)
$$;

create or replace function public.pull_client_changes(p_workspace_id uuid, p_cursor bigint default 0, p_limit integer default 500)
returns table(seq bigint, entity_type text, entity_id uuid, operation text, version bigint, payload jsonb)
language sql security definer set search_path = '' as $$
  select 0::bigint, 'sync'::text, extensions.gen_random_uuid(), 'delete'::text, null::bigint,
    jsonb_build_object('requiresManifest', true, 'code', 'FULL_RESYNC_REQUIRED')
  where p_cursor < coalesce((select min(seq) - 1 from anttodo_private.client_change_log where workspace_id = p_workspace_id), 0)
  union all
  select c.seq, c.entity_type, c.entity_id, c.operation, c.version, c.payload
  from anttodo_private.client_change_log c
  where c.workspace_id = p_workspace_id
    and c.seq > p_cursor
    and p_cursor >= coalesce((select min(seq) - 1 from anttodo_private.client_change_log where workspace_id = p_workspace_id), 0)
    and anttodo_private.is_workspace_member(p_workspace_id)
  order by 1
  limit least(greatest(p_limit, 1), 500)
$$;

create or replace function public.get_client_sync_manifest(p_workspace_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_build_object('workspaceId', p_workspace_id, 'head', public.get_client_sync_head(p_workspace_id), 'requiresManifest', false)
$$;

create or replace function public.ack_client_cursor(p_device_id uuid, p_workspace_id uuid, p_cursor bigint)
returns public.client_device_cursors language plpgsql security invoker set search_path = '' as $$
declare result public.client_device_cursors;
begin
  insert into public.client_device_cursors(device_id, workspace_id, cursor)
  values (p_device_id, p_workspace_id, greatest(p_cursor, 0))
  on conflict (device_id, workspace_id) do update set cursor = greatest(public.client_device_cursors.cursor, excluded.cursor), updated_at = now()
  returning * into result;
  return result;
end;
$$;

create or replace function public.check_attachment_unreferenced(p_workspace_id uuid, p_canonical_uri text)
returns boolean language sql security invoker set search_path = '' as $$
  select not exists (
    select 1 from public.tasks t
    where t.workspace_id = p_workspace_id and (t.description like '%' || p_canonical_uri || '%')
  ) and not exists (
    select 1 from public.task_comments c
    where c.workspace_id = p_workspace_id and p_canonical_uri = any(c.image_uris)
  )
$$;

create or replace function public.apply_client_operations(p_operations jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op jsonb; result jsonb := '[]'::jsonb; existing jsonb; target_workspace uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(p_operations, '[]'::jsonb)) > 50 then raise exception 'Too many operations' using errcode = '22023'; end if;
  for op in select value from jsonb_array_elements(coalesce(p_operations, '[]'::jsonb)) loop
    target_workspace := (op ->> 'workspaceId')::uuid;
    if not anttodo_private.is_workspace_member(target_workspace) then
      result := result || jsonb_build_array(jsonb_build_object('operationId', op ->> 'operationId', 'status', 'rejected', 'code', 'WORKSPACE_ACCESS_REVOKED'));
      continue;
    end if;
    select a.result into existing from anttodo_private.client_applied_operations a
      where a.operation_id = (op ->> 'operationId')::uuid and a.user_id = (select auth.uid());
    if existing is not null then result := result || jsonb_build_array(existing); continue; end if;

    -- The first implementation intentionally accepts only narrow, auditable patches.
    -- New operation kinds can be added without changing the cursor protocol.
    if op ->> 'entityType' = 'tasks' then
      if (op ->> 'baseVersion') is not null and not exists (
        select 1 from public.tasks t where t.id = (op ->> 'entityId')::uuid and t.version = (op ->> 'baseVersion')::bigint
      ) then
        existing := jsonb_build_object('operationId', op ->> 'operationId', 'status', 'conflict', 'code', 'VERSION_CONFLICT');
        insert into public.client_sync_conflicts(workspace_id, device_id, entity_type, entity_id, operation_id, local_payload, remote_payload)
          select target_workspace, (op ->> 'deviceId')::uuid, 'tasks', (op ->> 'entityId')::uuid,
            (op ->> 'operationId')::uuid, op -> 'payload', coalesce(to_jsonb(t), '{}'::jsonb)
          from public.tasks t where t.id = (op ->> 'entityId')::uuid;
        insert into anttodo_private.client_applied_operations(operation_id, user_id, workspace_id, result)
          values ((op ->> 'operationId')::uuid, (select auth.uid()), target_workspace, existing);
        result := result || jsonb_build_array(existing);
        continue;
      end if;
      if exists (select 1 from public.tasks t where t.id = (op ->> 'entityId')::uuid) then
        update public.tasks t set
          title = coalesce(op -> 'payload' ->> 'title', t.title),
          description = coalesce(op -> 'payload' ->> 'description', t.description),
          status = coalesce((op -> 'payload' ->> 'status')::public.task_status, t.status),
          priority = coalesce((op -> 'payload' ->> 'priority')::public.task_priority, t.priority),
          due_at = case when op -> 'payload' ? 'due_at' then (op -> 'payload' ->> 'due_at')::timestamptz else t.due_at end,
          assignee_id = case when op -> 'payload' ? 'assignee_id' then (op -> 'payload' ->> 'assignee_id')::uuid else t.assignee_id end,
          updated_at = now()
        where t.id = (op ->> 'entityId')::uuid and t.workspace_id = target_workspace;
      else
        insert into public.tasks(id, workspace_id, title, description, status, priority, due_at, assignee_id, created_by)
        values (
          (op ->> 'entityId')::uuid, target_workspace,
          coalesce(op -> 'payload' ->> 'title', '新任务'),
          coalesce(op -> 'payload' ->> 'description', ''),
          coalesce((op -> 'payload' ->> 'status')::public.task_status, 'open'),
          coalesce((op -> 'payload' ->> 'priority')::public.task_priority, 'none'),
          (op -> 'payload' ->> 'due_at')::timestamptz,
          (op -> 'payload' ->> 'assignee_id')::uuid,
          (select auth.uid())
        );
        if jsonb_typeof(op -> 'payload' -> 'label_ids') = 'array' then
          insert into public.task_labels(task_id, label_id)
          select (op ->> 'entityId')::uuid, value::uuid
          from jsonb_array_elements_text(op -> 'payload' -> 'label_ids')
          on conflict do nothing;
        end if;
      end if;
    elsif op ->> 'entityType' = 'labels' then
      update public.labels l set
        name = coalesce(op -> 'payload' ->> 'name', l.name),
        color = coalesce(op -> 'payload' ->> 'color', l.color),
        position = coalesce((op -> 'payload' ->> 'position')::integer, l.position),
        updated_at = now()
      where l.id = (op ->> 'entityId')::uuid and l.workspace_id = target_workspace;
    elsif op ->> 'entityType' = 'subtasks' then
      if coalesce((op -> 'payload' ->> 'deleted')::boolean, false) then
        delete from public.subtasks where id = (op ->> 'entityId')::uuid
          and exists (select 1 from public.tasks t where t.id = subtasks.task_id and t.workspace_id = target_workspace);
      elsif exists (select 1 from public.subtasks s where s.id = (op ->> 'entityId')::uuid) then
        update public.subtasks s set
          title = coalesce(op -> 'payload' ->> 'title', s.title),
          completed = coalesce((op -> 'payload' ->> 'completed')::boolean, s.completed),
          position = coalesce((op -> 'payload' ->> 'position')::integer, s.position),
          priority = coalesce((op -> 'payload' ->> 'priority')::public.task_priority, s.priority),
          updated_at = now()
        where s.id = (op ->> 'entityId')::uuid
          and exists (select 1 from public.tasks t where t.id = s.task_id and t.workspace_id = target_workspace);
      else
        insert into public.subtasks(id, task_id, title, position, created_by, priority, due_at, assignee_id, cli_assignee)
        values (
          (op ->> 'entityId')::uuid,
          (op -> 'payload' ->> 'taskId')::uuid,
          coalesce(op -> 'payload' ->> 'title', ''),
          coalesce((op -> 'payload' ->> 'position')::integer, 0),
          (select auth.uid()),
          coalesce((op -> 'payload' ->> 'priority')::public.task_priority, 'none'),
          (op -> 'payload' ->> 'due_at')::timestamptz,
          (op -> 'payload' ->> 'assignee_id')::uuid,
          op -> 'payload' ->> 'cli_assignee'
        );
      end if;
    elsif op ->> 'entityType' = 'task_labels' then
      if coalesce((op -> 'payload' ->> 'selected')::boolean, false) then
        insert into public.task_labels(task_id, label_id)
        values ((op -> 'payload' ->> 'taskId')::uuid, (op -> 'payload' ->> 'labelId')::uuid)
        on conflict do nothing;
      else
        delete from public.task_labels
        where task_id = (op -> 'payload' ->> 'taskId')::uuid
          and label_id = (op -> 'payload' ->> 'labelId')::uuid;
      end if;
    elsif op ->> 'entityType' = 'task_comments' then
      if coalesce((op -> 'payload' ->> 'deleted')::boolean, false) then
        delete from public.task_comments where id = (op ->> 'entityId')::uuid and author_id = (select auth.uid());
      elsif exists (select 1 from public.task_comments c where c.id = (op ->> 'entityId')::uuid) then
        update public.task_comments c set
          body = coalesce(op -> 'payload' ->> 'body', c.body),
          image_uris = case when op -> 'payload' ? 'imageUris'
            then array(select jsonb_array_elements_text(op -> 'payload' -> 'imageUris'))
            else c.image_uris end,
          updated_at = now()
        where c.id = (op ->> 'entityId')::uuid and c.author_id = (select auth.uid());
      else
        insert into public.task_comments(id, workspace_id, task_id, subtask_id, author_id, body, image_uris)
        values (
          (op ->> 'entityId')::uuid, target_workspace, (op -> 'payload' ->> 'taskId')::uuid,
          (op -> 'payload' ->> 'subtaskId')::uuid,
          (select auth.uid()), coalesce(op -> 'payload' ->> 'body', ''),
          case when op -> 'payload' ? 'imageUris'
            then array(select jsonb_array_elements_text(op -> 'payload' -> 'imageUris'))
            else array[]::text[] end
        );
        if jsonb_typeof(op -> 'payload' -> 'mentionedUserIds') = 'array' then
          insert into public.task_comment_mentions(comment_id, user_id, display_name_snapshot)
          select (op ->> 'entityId')::uuid, member.user_id,
            coalesce(profile.display_name, '团队成员')
          from jsonb_array_elements_text(op -> 'payload' -> 'mentionedUserIds') mention
          join public.workspace_members member
            on member.workspace_id = target_workspace and member.user_id = mention.value::uuid
          left join public.profiles profile on profile.id = member.user_id
          on conflict do nothing;
        end if;
      end if;
    end if;
    existing := jsonb_build_object('operationId', op ->> 'operationId', 'status', 'applied');
    insert into anttodo_private.client_applied_operations(operation_id, user_id, workspace_id, result)
      values ((op ->> 'operationId')::uuid, (select auth.uid()), target_workspace, existing);
    result := result || jsonb_build_array(existing);
  end loop;
  return result;
end;
$$;

revoke all on function public.register_client_device(uuid, text, text) from public, anon;
revoke all on function public.get_client_sync_head(uuid) from public, anon;
revoke all on function public.pull_client_changes(uuid, bigint, integer) from public, anon;
revoke all on function public.get_client_sync_manifest(uuid) from public, anon;
revoke all on function public.ack_client_cursor(uuid, uuid, bigint) from public, anon;
revoke all on function public.check_attachment_unreferenced(uuid, text) from public, anon;
revoke all on function public.apply_client_operations(jsonb) from public, anon;
grant execute on function public.register_client_device(uuid, text, text) to authenticated;
grant execute on function public.get_client_sync_head(uuid) to authenticated;
grant execute on function public.pull_client_changes(uuid, bigint, integer) to authenticated;
grant execute on function public.get_client_sync_manifest(uuid) to authenticated;
grant execute on function public.ack_client_cursor(uuid, uuid, bigint) to authenticated;
grant execute on function public.check_attachment_unreferenced(uuid, text) to authenticated;
grant execute on function public.apply_client_operations(jsonb) to authenticated;

-- Keep the log bounded. This job is best-effort; cursors older than the window
-- are required to bootstrap from a manifest again.
select cron.schedule('client-change-log-retention', '15 3 * * *', $$
  delete from anttodo_private.client_change_log where created_at < now() - interval '90 days';
$$)
where not exists (select 1 from cron.job where jobname = 'client-change-log-retention');
