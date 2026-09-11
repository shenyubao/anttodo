create type public.weekly_report_status as enum ('draft', 'published');
create type public.weekly_report_visibility as enum ('workspace', 'users', 'groups');

create table public.weekly_reports (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  completed_text text not null default '',
  next_plan_text text not null default '',
  reflection_text text not null default '',
  status public.weekly_report_status not null default 'draft',
  visibility public.weekly_report_visibility not null default 'workspace',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, author_id, week_start),
  unique (id, workspace_id),
  foreign key (workspace_id, author_id)
    references public.workspace_members(workspace_id, user_id) on delete cascade,
  check (extract(isodow from week_start) = 1),
  check (
    status = 'draft'
    or nullif(btrim(completed_text), '') is not null
    or nullif(btrim(next_plan_text), '') is not null
    or nullif(btrim(reflection_text), '') is not null
  ),
  check (
    (status = 'draft' and published_at is null)
    or (status = 'published' and published_at is not null)
  )
);

create table public.weekly_report_user_acl (
  report_id uuid not null references public.weekly_reports(id) on delete cascade,
  workspace_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (report_id, user_id),
  foreign key (report_id, workspace_id)
    references public.weekly_reports(id, workspace_id) on delete cascade,
  foreign key (workspace_id, user_id)
    references public.workspace_members(workspace_id, user_id) on delete cascade
);

create table public.weekly_report_group_acl (
  report_id uuid not null references public.weekly_reports(id) on delete cascade,
  workspace_id uuid not null,
  group_id uuid not null references public.user_groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (report_id, group_id),
  foreign key (report_id, workspace_id)
    references public.weekly_reports(id, workspace_id) on delete cascade,
  foreign key (group_id, workspace_id)
    references public.user_groups(id, workspace_id) on delete cascade
);

create table public.weekly_report_access_revisions (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  updated_at timestamptz not null default now()
);

create index weekly_reports_workspace_week_idx
on public.weekly_reports(workspace_id, week_start, updated_at desc);
create index weekly_reports_author_idx
on public.weekly_reports(workspace_id, author_id, week_start desc);
create index weekly_report_user_acl_user_idx
on public.weekly_report_user_acl(workspace_id, user_id, report_id);
create index weekly_report_group_acl_group_idx
on public.weekly_report_group_acl(workspace_id, group_id, report_id);

create trigger weekly_reports_updated_at
before update on public.weekly_reports
for each row execute function anttodo_private.set_updated_at();

create or replace function anttodo_private.validate_weekly_report_creation_week()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  current_week date := date_trunc('week', current_date)::date;
begin
  if new.week_start not in (current_week, current_week - 7) then
    raise exception 'Weekly reports can only be created for this week or last week'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger weekly_reports_creation_week
before insert on public.weekly_reports
for each row execute function anttodo_private.validate_weekly_report_creation_week();

create or replace function anttodo_private.weekly_report_identity_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id
    or new.workspace_id <> old.workspace_id
    or new.author_id <> old.author_id
    or new.week_start <> old.week_start then
    raise exception 'Weekly report identity fields cannot be changed' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger weekly_reports_identity_immutable
before update on public.weekly_reports
for each row execute function anttodo_private.weekly_report_identity_immutable();

create or replace function anttodo_private.is_weekly_report_owner(target_report uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.weekly_reports report
    where report.id = target_report
      and report.author_id = (select auth.uid())
  );
$$;

create or replace function anttodo_private.can_view_weekly_report(target_report uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.weekly_reports report
    where report.id = target_report
      and (
        report.author_id = (select auth.uid())
        or (
          report.status = 'published'
          and anttodo_private.is_workspace_member(report.workspace_id)
          and (
            report.visibility = 'workspace'
            or (
              report.visibility = 'users'
              and exists (
                select 1 from public.weekly_report_user_acl acl
                where acl.report_id = report.id
                  and acl.user_id = (select auth.uid())
              )
            )
            or (
              report.visibility = 'groups'
              and exists (
                select 1
                from public.weekly_report_group_acl acl
                join public.user_group_members membership
                  on membership.group_id = acl.group_id
                  and membership.workspace_id = report.workspace_id
                where acl.report_id = report.id
                  and membership.user_id = (select auth.uid())
              )
            )
          )
        )
      )
  );
$$;

create or replace function anttodo_private.touch_weekly_report_access_revision(target_workspace uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.weekly_report_access_revisions(workspace_id, updated_at)
  values (target_workspace, now())
  on conflict (workspace_id) do update set updated_at = excluded.updated_at;
$$;

create or replace function anttodo_private.touch_weekly_report_access_revision_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform anttodo_private.touch_weekly_report_access_revision(
    coalesce(new.workspace_id, old.workspace_id)
  );
  return coalesce(new, old);
end;
$$;

create trigger weekly_reports_touch_access_revision
after insert or update or delete on public.weekly_reports
for each row execute function anttodo_private.touch_weekly_report_access_revision_trigger();
create trigger weekly_report_user_acl_touch_access_revision
after insert or delete on public.weekly_report_user_acl
for each row execute function anttodo_private.touch_weekly_report_access_revision_trigger();
create trigger weekly_report_group_acl_touch_access_revision
after insert or delete on public.weekly_report_group_acl
for each row execute function anttodo_private.touch_weekly_report_access_revision_trigger();
create trigger user_group_members_touch_weekly_report_access_revision
after insert or delete on public.user_group_members
for each row execute function anttodo_private.touch_weekly_report_access_revision_trigger();

alter table public.weekly_reports enable row level security;
alter table public.weekly_report_user_acl enable row level security;
alter table public.weekly_report_group_acl enable row level security;
alter table public.weekly_report_access_revisions enable row level security;

create policy weekly_reports_select on public.weekly_reports for select to authenticated
using (
  -- INSERT ... RETURNING evaluates this policy before a helper can query the
  -- just-inserted row, so authors need a direct predicate on the candidate row.
  author_id = (select auth.uid())
  or (select anttodo_private.can_view_weekly_report(id))
);
create policy weekly_reports_insert on public.weekly_reports for insert to authenticated
with check (
  author_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
);
create policy weekly_reports_update on public.weekly_reports for update to authenticated
using (author_id = (select auth.uid()))
with check (
  author_id = (select auth.uid())
  and (select anttodo_private.is_workspace_member(workspace_id))
);
create policy weekly_reports_delete on public.weekly_reports for delete to authenticated
using (author_id = (select auth.uid()));

create policy weekly_report_user_acl_select on public.weekly_report_user_acl for select to authenticated
using ((select anttodo_private.is_weekly_report_owner(report_id)));
create policy weekly_report_user_acl_insert on public.weekly_report_user_acl for insert to authenticated
with check ((select anttodo_private.is_weekly_report_owner(report_id)));
create policy weekly_report_user_acl_delete on public.weekly_report_user_acl for delete to authenticated
using ((select anttodo_private.is_weekly_report_owner(report_id)));

create policy weekly_report_group_acl_select on public.weekly_report_group_acl for select to authenticated
using ((select anttodo_private.is_weekly_report_owner(report_id)));
create policy weekly_report_group_acl_insert on public.weekly_report_group_acl for insert to authenticated
with check ((select anttodo_private.is_weekly_report_owner(report_id)));
create policy weekly_report_group_acl_delete on public.weekly_report_group_acl for delete to authenticated
using ((select anttodo_private.is_weekly_report_owner(report_id)));

create policy weekly_report_access_revisions_select
on public.weekly_report_access_revisions for select to authenticated
using ((select anttodo_private.is_workspace_member(workspace_id)));

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
  p_publish boolean default false
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
  clean_user_ids uuid[] := coalesce(p_user_ids, '{}'::uuid[]);
  clean_group_ids uuid[] := coalesce(p_group_ids, '{}'::uuid[]);
begin
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

  if current_report.id is null then
    insert into public.weekly_reports (
      workspace_id, author_id, week_start, completed_text, next_plan_text,
      reflection_text, status, visibility, published_at
    ) values (
      p_workspace_id, (select auth.uid()), p_week_start,
      coalesce(p_completed_text, ''), coalesce(p_next_plan_text, ''),
      coalesce(p_reflection_text, ''), target_status, p_visibility,
      case when target_status = 'published' then now() else null end
    ) returning * into saved_report;
  else
    update public.weekly_reports set
      completed_text = coalesce(p_completed_text, ''),
      next_plan_text = coalesce(p_next_plan_text, ''),
      reflection_text = coalesce(p_reflection_text, ''),
      status = target_status,
      visibility = p_visibility,
      published_at = case
        when target_status = 'published' then coalesce(current_report.published_at, now())
        else null
      end
    where id = current_report.id
    returning * into saved_report;
  end if;

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

  return saved_report;
end;
$$;

revoke all on public.weekly_reports from public, anon;
revoke all on public.weekly_report_user_acl from public, anon;
revoke all on public.weekly_report_group_acl from public, anon;
revoke all on public.weekly_report_access_revisions from public, anon;
grant select, insert, update, delete on public.weekly_reports to authenticated;
grant select, insert, delete on public.weekly_report_user_acl to authenticated;
grant select, insert, delete on public.weekly_report_group_acl to authenticated;
grant select on public.weekly_report_access_revisions to authenticated;
grant all on public.weekly_reports, public.weekly_report_user_acl,
  public.weekly_report_group_acl, public.weekly_report_access_revisions to service_role;

revoke all on function anttodo_private.weekly_report_identity_immutable() from public, anon;
revoke all on function anttodo_private.is_weekly_report_owner(uuid) from public, anon;
revoke all on function anttodo_private.can_view_weekly_report(uuid) from public, anon;
revoke all on function anttodo_private.touch_weekly_report_access_revision(uuid) from public, anon;
revoke all on function anttodo_private.touch_weekly_report_access_revision_trigger() from public, anon;
grant execute on function anttodo_private.is_weekly_report_owner(uuid) to authenticated;
grant execute on function anttodo_private.can_view_weekly_report(uuid) to authenticated;

revoke all on function public.save_weekly_report(
  uuid, date, text, text, text, public.weekly_report_visibility, uuid[], uuid[], uuid, boolean
) from public, anon;
grant execute on function public.save_weekly_report(
  uuid, date, text, text, text, public.weekly_report_visibility, uuid[], uuid[], uuid, boolean
) to authenticated;

alter publication supabase_realtime add table public.weekly_reports;
alter publication supabase_realtime add table public.weekly_report_user_acl;
alter publication supabase_realtime add table public.weekly_report_group_acl;
alter publication supabase_realtime add table public.weekly_report_access_revisions;
