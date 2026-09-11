-- Existing personal weekly-report notification groups become workspace-shared.
-- Members of the same team space can see, select, create and delete them.

do $$
declare
  rec record;
begin
  for rec in
    select con.conrelid::regclass as rel, con.conname
    from pg_constraint con
    where con.confrelid = 'public.weekly_report_notification_groups'::regclass
      and con.contype = 'f'
      and pg_get_constraintdef(con.oid) like '%owner_id%'
  loop
    execute format('alter table %s drop constraint %I', rec.rel, rec.conname);
  end loop;

  for rec in
    select con.conname
    from pg_constraint con
    join pg_attribute att
      on att.attrelid = con.conrelid
     and att.attname = 'owner_id'
     and att.attnum = any(con.conkey)
    where con.conrelid = 'public.weekly_report_notification_groups'::regclass
      and con.contype in ('f', 'u')
  loop
    execute format(
      'alter table public.weekly_report_notification_groups drop constraint %I',
      rec.conname
    );
  end loop;
end;
$$;

drop policy if exists weekly_report_notification_groups_select
  on public.weekly_report_notification_groups;
drop policy if exists weekly_report_notification_targets_insert
  on public.weekly_report_notification_targets;
drop policy if exists weekly_report_notification_deliveries_insert
  on public.weekly_report_notification_deliveries;

drop index if exists public.weekly_report_notification_groups_owner_idx;

alter table public.weekly_report_notification_groups
  drop column owner_id,
  add constraint weekly_report_notification_groups_id_workspace_key
    unique (id, workspace_id),
  add constraint weekly_report_notification_groups_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete cascade;

create index weekly_report_notification_groups_workspace_idx
on public.weekly_report_notification_groups(workspace_id, created_at);

alter table public.weekly_report_notification_targets
  add constraint weekly_report_notification_targets_group_workspace_fkey
  foreign key (notification_group_id, workspace_id)
  references public.weekly_report_notification_groups(id, workspace_id) on delete cascade;

alter table public.weekly_report_notification_deliveries
  add constraint weekly_report_notification_deliveries_group_workspace_fkey
  foreign key (notification_group_id, workspace_id)
  references public.weekly_report_notification_groups(id, workspace_id) on delete cascade;

create policy weekly_report_notification_groups_select
on public.weekly_report_notification_groups for select to authenticated
using ((select anttodo_private.is_workspace_member(workspace_id)));

create policy weekly_report_notification_targets_insert
on public.weekly_report_notification_targets for insert to authenticated
with check (
  author_id = (select auth.uid())
  and (select anttodo_private.is_weekly_report_owner(report_id))
  and exists (
    select 1
    from public.weekly_report_notification_groups notification_group
    where notification_group.id = notification_group_id
      and notification_group.workspace_id = workspace_id
  )
);

create policy weekly_report_notification_deliveries_insert
on public.weekly_report_notification_deliveries for insert to authenticated
with check (
  author_id = (select auth.uid())
  and (select anttodo_private.is_weekly_report_owner(report_id))
  and exists (
    select 1
    from public.weekly_reports report
    where report.id = report_id
      and report.notification_revision = revision
  )
  and exists (
    select 1
    from public.weekly_report_notification_groups notification_group
    where notification_group.id = notification_group_id
      and notification_group.workspace_id = workspace_id
  )
);

create or replace function public.create_weekly_report_notification_group(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_type public.weekly_report_notification_group_type,
  p_name text,
  p_credentials jsonb
)
returns public.weekly_report_notification_groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid := extensions.gen_random_uuid();
  v_secret_id uuid;
  v_group public.weekly_report_notification_groups;
begin
  if p_actor_id is null or not exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = p_actor_id
  ) then
    raise exception 'Weekly report notification group access denied' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 100 then
    raise exception 'Notification group name is invalid' using errcode = '23514';
  end if;
  if nullif(btrim(p_credentials ->> 'webhook'), '') is null
    or nullif(btrim(p_credentials ->> 'signingSecret'), '') is null then
    raise exception 'Notification group credentials are invalid' using errcode = '23514';
  end if;

  v_secret_id := vault.create_secret(
    p_credentials::text,
    'anttodo_weekly_report_notification_group_' || v_group_id::text,
    'AntTodo weekly report notification group credential'
  );

  insert into public.weekly_report_notification_groups (
    id, workspace_id, type, name, credential_secret_id
  ) values (
    v_group_id, p_workspace_id, p_type, btrim(p_name), v_secret_id
  ) returning * into v_group;
  return v_group;
exception when others then
  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;
  raise;
end;
$$;

create or replace function public.delete_weekly_report_notification_group(
  p_group_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  select workspace_id into v_workspace_id
  from public.weekly_report_notification_groups
  where id = p_group_id;
  if v_workspace_id is null or p_actor_id is null or not exists (
    select 1 from public.workspace_members
    where workspace_id = v_workspace_id and user_id = p_actor_id
  ) then
    raise exception 'Weekly report notification group access denied' using errcode = '42501';
  end if;
  delete from public.weekly_report_notification_groups where id = p_group_id;
end;
$$;

revoke all on function public.delete_weekly_report_notification_group(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.delete_weekly_report_notification_group(uuid, uuid)
to service_role;

create or replace function public.save_weekly_report(
  p_workspace_id uuid,
  p_week_start date,
  p_completed_text text,
  p_next_plan_text text,
  p_reflection_text text,
  p_visibility public.weekly_report_visibility,
  p_user_ids uuid[] default '{}',
  p_group_ids uuid[] default '{}',
  p_report_id uuid default null,
  p_publish boolean default false,
  p_notification_group_ids uuid[] default '{}'
)
returns public.weekly_reports
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_report public.weekly_reports;
  saved_report public.weekly_reports;
  target_status public.weekly_report_status;
  clean_user_ids uuid[];
  clean_group_ids uuid[];
  clean_notification_group_ids uuid[];
  current_user_ids uuid[] := '{}'::uuid[];
  current_group_ids uuid[] := '{}'::uuid[];
  current_notification_group_ids uuid[] := '{}'::uuid[];
  material_change boolean := true;
  should_notify boolean := false;
  next_notification_revision bigint := 0;
begin
  select coalesce(array_agg(distinct item order by item), '{}'::uuid[])
    into clean_user_ids from unnest(coalesce(p_user_ids, '{}'::uuid[])) item;
  select coalesce(array_agg(distinct item order by item), '{}'::uuid[])
    into clean_group_ids from unnest(coalesce(p_group_ids, '{}'::uuid[])) item;
  select coalesce(array_agg(distinct item order by item), '{}'::uuid[])
    into clean_notification_group_ids
    from unnest(coalesce(p_notification_group_ids, '{}'::uuid[])) item;

  if (select auth.uid()) is null
    or not anttodo_private.is_workspace_member(p_workspace_id) then
    raise exception 'Weekly report workspace access denied' using errcode = '42501';
  end if;
  if extract(isodow from p_week_start) <> 1 then
    raise exception 'Weekly report week must start on Monday' using errcode = '23514';
  end if;
  if p_visibility = 'workspace' and (cardinality(clean_user_ids) > 0 or cardinality(clean_group_ids) > 0) then
    raise exception 'Workspace visibility cannot include ACL subjects' using errcode = '23514';
  end if;
  if p_visibility = 'users' and cardinality(clean_group_ids) > 0 then
    raise exception 'User visibility cannot include groups' using errcode = '23514';
  end if;
  if p_visibility = 'groups' and cardinality(clean_user_ids) > 0 then
    raise exception 'Group visibility cannot include users' using errcode = '23514';
  end if;
  if exists (
    select 1 from unnest(clean_notification_group_ids) selected_id
    where not exists (
      select 1 from public.weekly_report_notification_groups notification_group
      where notification_group.id = selected_id
        and notification_group.workspace_id = p_workspace_id
    )
  ) then
    raise exception 'Weekly report notification group access denied' using errcode = '42501';
  end if;

  if p_report_id is not null then
    select * into current_report from public.weekly_reports where id = p_report_id;
  else
    select * into current_report
    from public.weekly_reports
    where workspace_id = p_workspace_id
      and author_id = (select auth.uid())
      and week_start = p_week_start;
  end if;
  if current_report.id is not null and (
    current_report.author_id <> (select auth.uid())
    or current_report.workspace_id <> p_workspace_id
    or current_report.week_start <> p_week_start
  ) then
    raise exception 'Only the weekly report author can update it' using errcode = '42501';
  end if;

  target_status := case
    when p_publish or current_report.status = 'published' then 'published'::public.weekly_report_status
    else 'draft'::public.weekly_report_status
  end;
  if target_status = 'published'
    and nullif(btrim(coalesce(p_completed_text, '')), '') is null
    and nullif(btrim(coalesce(p_next_plan_text, '')), '') is null
    and nullif(btrim(coalesce(p_reflection_text, '')), '') is null then
    raise exception 'Published weekly reports need content' using errcode = '23514';
  end if;
  if target_status = 'published' and p_visibility = 'users' and not exists (
    select 1 from unnest(clean_user_ids) subject_id
    where subject_id <> (select auth.uid())
  ) then
    raise exception 'Published user-visible reports need at least one user' using errcode = '23514';
  end if;
  if target_status = 'published' and p_visibility = 'groups' and cardinality(clean_group_ids) = 0 then
    raise exception 'Published group-visible reports need at least one group' using errcode = '23514';
  end if;

  if current_report.id is not null then
    select coalesce(array_agg(acl.user_id order by acl.user_id), '{}'::uuid[])
      into current_user_ids
    from public.weekly_report_user_acl acl where acl.report_id = current_report.id;
    select coalesce(array_agg(acl.group_id order by acl.group_id), '{}'::uuid[])
      into current_group_ids
    from public.weekly_report_group_acl acl where acl.report_id = current_report.id;
    select coalesce(array_agg(target.notification_group_id order by target.notification_group_id), '{}'::uuid[])
      into current_notification_group_ids
    from public.weekly_report_notification_targets target where target.report_id = current_report.id;

    material_change := current_report.completed_text is distinct from coalesce(p_completed_text, '')
      or current_report.next_plan_text is distinct from coalesce(p_next_plan_text, '')
      or current_report.reflection_text is distinct from coalesce(p_reflection_text, '')
      or current_report.visibility is distinct from p_visibility
      or current_report.status is distinct from target_status
      or current_user_ids is distinct from (case when p_visibility = 'users' then clean_user_ids else '{}'::uuid[] end)
      or current_group_ids is distinct from (case when p_visibility = 'groups' then clean_group_ids else '{}'::uuid[] end)
      or current_notification_group_ids is distinct from clean_notification_group_ids;
  end if;

  should_notify := target_status = 'published'
    and (current_report.id is null or material_change);
  next_notification_revision := case
    when should_notify then coalesce(current_report.notification_revision, 0) + 1
    else coalesce(current_report.notification_revision, 0)
  end;

  if current_report.id is null then
    insert into public.weekly_reports (
      workspace_id, author_id, week_start, completed_text, next_plan_text,
      reflection_text, status, visibility, published_at, notification_revision
    ) values (
      p_workspace_id, (select auth.uid()), p_week_start,
      coalesce(p_completed_text, ''), coalesce(p_next_plan_text, ''),
      coalesce(p_reflection_text, ''), target_status, p_visibility,
      case when target_status = 'published' then now() else null end,
      next_notification_revision
    ) returning * into saved_report;
  elsif material_change then
    update public.weekly_reports set
      completed_text = coalesce(p_completed_text, ''),
      next_plan_text = coalesce(p_next_plan_text, ''),
      reflection_text = coalesce(p_reflection_text, ''),
      status = target_status,
      visibility = p_visibility,
      published_at = case
        when target_status = 'published' then coalesce(current_report.published_at, now())
        else null
      end,
      notification_revision = next_notification_revision
    where id = current_report.id
    returning * into saved_report;
  else
    saved_report := current_report;
  end if;

  if current_report.id is null
    or current_user_ids is distinct from (case when p_visibility = 'users' then clean_user_ids else '{}'::uuid[] end)
    or current_group_ids is distinct from (case when p_visibility = 'groups' then clean_group_ids else '{}'::uuid[] end) then
    delete from public.weekly_report_user_acl where report_id = saved_report.id;
    delete from public.weekly_report_group_acl where report_id = saved_report.id;
    if p_visibility = 'users' then
      insert into public.weekly_report_user_acl(report_id, workspace_id, user_id)
      select saved_report.id, saved_report.workspace_id, subject_id
      from unnest(clean_user_ids) subject_id
      where subject_id <> saved_report.author_id
      on conflict do nothing;
    elsif p_visibility = 'groups' then
      insert into public.weekly_report_group_acl(report_id, workspace_id, group_id)
      select saved_report.id, saved_report.workspace_id, subject_id
      from unnest(clean_group_ids) subject_id
      on conflict do nothing;
    end if;
  end if;

  if current_report.id is null
    or current_notification_group_ids is distinct from clean_notification_group_ids then
    delete from public.weekly_report_notification_targets where report_id = saved_report.id;
    insert into public.weekly_report_notification_targets(
      report_id, workspace_id, author_id, notification_group_id
    )
    select saved_report.id, saved_report.workspace_id, saved_report.author_id, selected_id
    from unnest(clean_notification_group_ids) selected_id
    on conflict do nothing;
  end if;

  if should_notify then
    update public.weekly_report_notification_deliveries
    set status = 'superseded', error_message = null
    where report_id = saved_report.id
      and revision < saved_report.notification_revision
      and status in ('pending', 'sending', 'failed');

    insert into public.weekly_report_notification_deliveries(
      report_id, workspace_id, author_id, notification_group_id, revision
    )
    select
      saved_report.id,
      saved_report.workspace_id,
      saved_report.author_id,
      selected_id,
      saved_report.notification_revision
    from unnest(clean_notification_group_ids) selected_id
    on conflict do nothing;
  end if;

  return saved_report;
end;
$$;
