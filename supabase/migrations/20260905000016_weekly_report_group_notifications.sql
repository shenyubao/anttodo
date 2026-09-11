create type public.weekly_report_notification_group_type as enum ('dingtalk');
create type public.weekly_report_notification_delivery_status as enum (
  'pending', 'sending', 'sent', 'failed', 'superseded'
);

alter table public.weekly_reports
  add column notification_revision bigint not null default 0,
  add constraint weekly_reports_notification_revision_nonnegative
    check (notification_revision >= 0),
  add constraint weekly_reports_id_workspace_author_key
    unique (id, workspace_id, author_id);

create table public.weekly_report_notification_groups (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  type public.weekly_report_notification_group_type not null default 'dingtalk',
  name text not null,
  credential_secret_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id, owner_id),
  foreign key (workspace_id, owner_id)
    references public.workspace_members(workspace_id, user_id) on delete cascade,
  check (char_length(btrim(name)) between 1 and 100)
);

create table public.weekly_report_notification_targets (
  report_id uuid not null,
  workspace_id uuid not null,
  author_id uuid not null,
  notification_group_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (report_id, notification_group_id),
  foreign key (report_id, workspace_id, author_id)
    references public.weekly_reports(id, workspace_id, author_id) on delete cascade,
  foreign key (notification_group_id, workspace_id, author_id)
    references public.weekly_report_notification_groups(id, workspace_id, owner_id) on delete cascade
);

create table public.weekly_report_notification_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  report_id uuid not null,
  workspace_id uuid not null,
  author_id uuid not null,
  notification_group_id uuid not null,
  revision bigint not null,
  status public.weekly_report_notification_delivery_status not null default 'pending',
  attempts integer not null default 0,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_id, revision, notification_group_id),
  foreign key (report_id, workspace_id, author_id)
    references public.weekly_reports(id, workspace_id, author_id) on delete cascade,
  foreign key (notification_group_id, workspace_id, author_id)
    references public.weekly_report_notification_groups(id, workspace_id, owner_id) on delete cascade,
  check (revision > 0),
  check (attempts >= 0),
  check ((status = 'sent' and sent_at is not null) or status <> 'sent')
);

create index weekly_report_notification_groups_owner_idx
on public.weekly_report_notification_groups(workspace_id, owner_id, created_at);
create index weekly_report_notification_targets_author_idx
on public.weekly_report_notification_targets(workspace_id, author_id, report_id);
create index weekly_report_notification_deliveries_latest_idx
on public.weekly_report_notification_deliveries(report_id, revision desc, status);

create trigger weekly_report_notification_groups_updated_at
before update on public.weekly_report_notification_groups
for each row execute function anttodo_private.set_updated_at();
create trigger weekly_report_notification_deliveries_updated_at
before update on public.weekly_report_notification_deliveries
for each row execute function anttodo_private.set_updated_at();

create or replace function anttodo_private.delete_weekly_report_notification_group_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id = old.credential_secret_id;
  return old;
end;
$$;

create trigger weekly_report_notification_groups_delete_secret
before delete on public.weekly_report_notification_groups
for each row execute function anttodo_private.delete_weekly_report_notification_group_secret();

alter table public.weekly_report_notification_groups enable row level security;
alter table public.weekly_report_notification_targets enable row level security;
alter table public.weekly_report_notification_deliveries enable row level security;

create policy weekly_report_notification_groups_select
on public.weekly_report_notification_groups for select to authenticated
using (
  owner_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
);

create policy weekly_report_notification_targets_select
on public.weekly_report_notification_targets for select to authenticated
using ((select anttodo_private.is_weekly_report_owner(report_id)));
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
      and notification_group.owner_id = (select auth.uid())
  )
);
create policy weekly_report_notification_targets_delete
on public.weekly_report_notification_targets for delete to authenticated
using ((select anttodo_private.is_weekly_report_owner(report_id)));

create policy weekly_report_notification_deliveries_select
on public.weekly_report_notification_deliveries for select to authenticated
using ((select anttodo_private.is_weekly_report_owner(report_id)));
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
      and notification_group.owner_id = (select auth.uid())
  )
);
create policy weekly_report_notification_deliveries_update
on public.weekly_report_notification_deliveries for update to authenticated
using ((select anttodo_private.is_weekly_report_owner(report_id)))
with check ((select anttodo_private.is_weekly_report_owner(report_id)));

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
    id, workspace_id, owner_id, type, name, credential_secret_id
  ) values (
    v_group_id, p_workspace_id, p_actor_id, p_type, btrim(p_name), v_secret_id
  ) returning * into v_group;
  return v_group;
exception when others then
  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;
  raise;
end;
$$;

create or replace function public.claim_weekly_report_notification_deliveries(
  p_report_id uuid,
  p_revision bigint,
  p_actor_id uuid,
  p_retry_failed boolean default false
)
returns table (
  delivery_id uuid,
  notification_group_id uuid,
  group_name text,
  credentials jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor_id is null or not exists (
    select 1 from public.weekly_reports report
    where report.id = p_report_id
      and report.author_id = p_actor_id
      and report.notification_revision = p_revision
      and report.status = 'published'
  ) then
    raise exception 'Weekly report notification dispatch denied' using errcode = '42501';
  end if;

  return query
  with candidates as (
    select delivery.id
    from public.weekly_report_notification_deliveries delivery
    where delivery.report_id = p_report_id
      and delivery.revision = p_revision
      and (
        delivery.status = 'pending'
        or (
          p_retry_failed and (
            delivery.status = 'failed'
            or (
              delivery.status = 'sending'
              and delivery.updated_at < now() - interval '2 minutes'
            )
          )
        )
      )
    for update skip locked
  ), claimed as (
    update public.weekly_report_notification_deliveries delivery
    set status = 'sending', attempts = delivery.attempts + 1, error_message = null
    from candidates
    where delivery.id = candidates.id
    returning delivery.id, delivery.notification_group_id
  )
  select
    claimed.id,
    notification_group.id,
    notification_group.name,
    secret.decrypted_secret::jsonb
  from claimed
  join public.weekly_report_notification_groups notification_group
    on notification_group.id = claimed.notification_group_id
  join vault.decrypted_secrets secret
    on secret.id = notification_group.credential_secret_id;
end;
$$;

revoke all on function anttodo_private.delete_weekly_report_notification_group_secret()
from public, anon, authenticated;
revoke all on function public.create_weekly_report_notification_group(
  uuid, uuid, public.weekly_report_notification_group_type, text, jsonb
) from public, anon, authenticated;
revoke all on function public.claim_weekly_report_notification_deliveries(
  uuid, bigint, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.create_weekly_report_notification_group(
  uuid, uuid, public.weekly_report_notification_group_type, text, jsonb
) to service_role;
grant execute on function public.claim_weekly_report_notification_deliveries(
  uuid, bigint, uuid, boolean
) to service_role;

drop function public.save_weekly_report(
  uuid, date, text, text, text, public.weekly_report_visibility,
  uuid[], uuid[], uuid, boolean
);

create function public.save_weekly_report(
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
        and notification_group.owner_id = (select auth.uid())
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

revoke all on public.weekly_report_notification_groups from public, anon;
revoke all on public.weekly_report_notification_targets from public, anon;
revoke all on public.weekly_report_notification_deliveries from public, anon;
grant select on public.weekly_report_notification_groups to authenticated;
grant select, insert, delete on public.weekly_report_notification_targets to authenticated;
grant select, insert, update on public.weekly_report_notification_deliveries to authenticated;
grant all on public.weekly_report_notification_groups,
  public.weekly_report_notification_targets,
  public.weekly_report_notification_deliveries to service_role;

revoke all on function public.save_weekly_report(
  uuid, date, text, text, text, public.weekly_report_visibility,
  uuid[], uuid[], uuid, boolean, uuid[]
) from public, anon;
grant execute on function public.save_weekly_report(
  uuid, date, text, text, text, public.weekly_report_visibility,
  uuid[], uuid[], uuid, boolean, uuid[]
) to authenticated;

alter publication supabase_realtime add table public.weekly_report_notification_groups;
alter publication supabase_realtime add table public.weekly_report_notification_targets;
alter publication supabase_realtime add table public.weekly_report_notification_deliveries;
