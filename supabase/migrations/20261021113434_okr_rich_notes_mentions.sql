-- Shared Markdown notes and transactional, in-app-only OKR mentions.
alter table public.okr_key_results add column note text not null default '';
alter table public.okr_display_preferences alter column show_score set default false;
update public.okr_display_preferences set show_score = false;

alter table public.notifications alter column task_id drop not null;
alter table public.notifications add column objective_id uuid references public.okr_objectives(id) on delete cascade;
alter table public.notifications add column key_result_id uuid references public.okr_key_results(id) on delete cascade;
alter table public.notifications drop constraint notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check check (notification_type in (
'comment_mention','todo_mentioned','task_assigned','task_new_comment','note_mentioned','participant_added',
'participant_title_changed','participant_status_changed','participant_new_comment','participant_task_created','okr_mentioned'));
alter table public.notifications add constraint notifications_target_check check (
  (notification_type = 'okr_mentioned' and task_id is null and comment_id is null and num_nonnulls(objective_id, key_result_id) = 1)
  or (notification_type <> 'okr_mentioned' and task_id is not null and objective_id is null and key_result_id is null));

create table public.okr_note_mentions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id uuid primary key default extensions.gen_random_uuid(),
  objective_id uuid references public.okr_objectives(id) on delete cascade,
  key_result_id uuid references public.okr_key_results(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  display_name_snapshot text not null,
  constraint okr_note_mentions_target_check check (num_nonnulls(objective_id, key_result_id) = 1)
);
create unique index okr_note_mentions_objective_user on public.okr_note_mentions(objective_id, user_id);
create unique index okr_note_mentions_kr_user on public.okr_note_mentions(key_result_id, user_id);
alter table public.okr_note_mentions enable row level security;
create policy okr_note_mentions_select on public.okr_note_mentions for select to authenticated using (
  anttodo_private.can_view_okr_objective(objective_id) or anttodo_private.can_view_okr_key_result(key_result_id));
revoke all on public.okr_note_mentions from public, anon, authenticated;
grant select on public.okr_note_mentions to authenticated;
grant all on public.okr_note_mentions to service_role;

create or replace function anttodo_private.okr_set_scope_allows_for_user(target_set uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.okr_sets s
    where s.id = target_set
      and (
        s.owner_id = p_user_id
        or (
          exists (select 1 from public.workspace_members wm where wm.workspace_id = s.workspace_id and wm.user_id = p_user_id)
          and (
            s.visibility = 'workspace'
            or exists (
              select 1 from public.okr_set_user_acl a
              where a.set_id = s.id and a.user_id = p_user_id
            )
            or exists (
              select 1
              from public.okr_set_group_acl a
              join public.user_group_members m
                on m.group_id = a.group_id and m.workspace_id = s.workspace_id
              where a.set_id = s.id and m.user_id = p_user_id
            )
          )
        )
      )
  );
$$;
revoke all on function anttodo_private.okr_set_scope_allows_for_user(uuid, uuid) from public, anon, authenticated;

create or replace function anttodo_private.okr_objective_scope_allows_for_user(target_objective uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.okr_objectives o
    join public.okr_sets s on s.id = o.set_id
    where o.id = target_objective
      and (
        s.owner_id = p_user_id
        or (
          exists (select 1 from public.workspace_members wm where wm.workspace_id = o.workspace_id and wm.user_id = p_user_id)
          and (
            (o.visibility = 'inherit' and anttodo_private.okr_set_scope_allows_for_user(s.id, p_user_id))
            or o.visibility = 'workspace'
            or (
              o.visibility = 'restricted'
              and (
                exists (
                  select 1 from public.okr_objective_user_acl a
                  where a.objective_id = o.id and a.user_id = p_user_id
                )
                or exists (
                  select 1
                  from public.okr_objective_group_acl a
                  join public.user_group_members m
                    on m.group_id = a.group_id and m.workspace_id = o.workspace_id
                  where a.objective_id = o.id and m.user_id = p_user_id
                )
              )
            )
          )
        )
      )
  );
$$;
revoke all on function anttodo_private.okr_objective_scope_allows_for_user(uuid, uuid) from public, anon, authenticated;

create or replace function anttodo_private.okr_key_result_scope_allows_for_user(target_key_result uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.okr_key_results kr
    join public.okr_objectives o on o.id = kr.objective_id
    join public.okr_sets s on s.id = o.set_id
    where kr.id = target_key_result
      and (
        s.owner_id = p_user_id
        or (
          exists (select 1 from public.workspace_members wm where wm.workspace_id = kr.workspace_id and wm.user_id = p_user_id)
          and (
            (kr.visibility = 'inherit' and anttodo_private.okr_objective_scope_allows_for_user(o.id, p_user_id))
            or kr.visibility = 'workspace'
            or (
              kr.visibility = 'restricted'
              and (
                exists (
                  select 1 from public.okr_key_result_user_acl a
                  where a.key_result_id = kr.id and a.user_id = p_user_id
                )
                or exists (
                  select 1
                  from public.okr_key_result_group_acl a
                  join public.user_group_members m
                    on m.group_id = a.group_id and m.workspace_id = kr.workspace_id
                  where a.key_result_id = kr.id and m.user_id = p_user_id
                )
              )
            )
          )
        )
      )
  );
$$;
revoke all on function anttodo_private.okr_key_result_scope_allows_for_user(uuid, uuid) from public, anon, authenticated;

create or replace function anttodo_private.can_view_okr_objective_for_user(target_objective uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.okr_objectives o
    join public.okr_sets s on s.id = o.set_id
    where o.id = target_objective
      and (
        s.owner_id = p_user_id
        or (
          o.published_at is not null
          and (
            anttodo_private.okr_objective_scope_allows_for_user(o.id, p_user_id)
            or exists (
              select 1 from public.okr_key_results kr
              where kr.objective_id = o.id
                and kr.published_at is not null
                and anttodo_private.okr_key_result_scope_allows_for_user(kr.id, p_user_id)
            )
          )
        )
      )
  );
$$;
revoke all on function anttodo_private.can_view_okr_objective_for_user(uuid, uuid) from public, anon, authenticated;

create or replace function anttodo_private.can_view_okr_key_result_for_user(target_key_result uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.okr_key_results kr
    join public.okr_objectives o on o.id = kr.objective_id
    join public.okr_sets s on s.id = o.set_id
    where kr.id = target_key_result
      and (
        s.owner_id = p_user_id
        or (
          kr.published_at is not null
          and anttodo_private.okr_key_result_scope_allows_for_user(kr.id, p_user_id)
        )
      )
  );
$$;
revoke all on function anttodo_private.can_view_okr_key_result_for_user(uuid, uuid) from public, anon, authenticated;

create function anttodo_private.load_okr_note_mention_candidates(p_kind text, p_id uuid)
returns uuid[] language plpgsql stable security definer set search_path = '' as $$
declare result uuid[]; v_workspace uuid;
begin
  if auth.uid() is null or not (case p_kind
    when 'objective' then anttodo_private.can_view_okr_objective(p_id)
    when 'key_result' then anttodo_private.can_view_okr_key_result(p_id) else false end) then
    raise exception 'OKR is unavailable' using errcode = '42501';
  end if;
  if p_kind = 'objective' then select workspace_id into v_workspace from public.okr_objectives where id=p_id;
  else select workspace_id into v_workspace from public.okr_key_results where id=p_id; end if;
  select coalesce(array_agg(m.user_id), '{}') into result from public.workspace_members m
  where m.workspace_id=v_workspace and m.user_id <> auth.uid() and (case p_kind
    when 'objective' then anttodo_private.can_view_okr_objective_for_user(p_id,m.user_id)
    else anttodo_private.can_view_okr_key_result_for_user(p_id,m.user_id) end);
  return result;
end; $$;
revoke all on function anttodo_private.load_okr_note_mention_candidates(text, uuid) from public, anon;
grant execute on function anttodo_private.load_okr_note_mention_candidates(text, uuid) to authenticated;
create function public.load_okr_note_mention_candidates(p_kind text, p_id uuid)
returns uuid[] language sql stable security invoker set search_path = '' as $$
  select anttodo_private.load_okr_note_mention_candidates(p_kind, p_id);
$$;
revoke all on function public.load_okr_note_mention_candidates(text, uuid) from public, anon;
grant execute on function public.load_okr_note_mention_candidates(text, uuid) to authenticated;

create function anttodo_private.sync_okr_note_mentions(p_kind text, p_id uuid, p_change jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_set public.okr_sets; v_note text; v_title text; v_ids uuid[]; v_user uuid; v_name text; v_mention public.okr_note_mentions;
begin
  if p_kind = 'objective' then
    select s.* into v_set from public.okr_objectives o join public.okr_sets s on s.id=o.set_id where o.id=p_id;
    select note,title into v_note,v_title from public.okr_objectives where id=p_id;
  elsif p_kind = 'key_result' then
    select s.* into v_set from public.okr_key_results kr join public.okr_objectives o on o.id=kr.objective_id join public.okr_sets s on s.id=o.set_id where kr.id=p_id;
    select note,title into v_note,v_title from public.okr_key_results where id=p_id;
  else raise exception 'Invalid OKR kind'; end if;
  if auth.uid() is null or not coalesce(anttodo_private.can_edit_okr_set(v_set.id), false) then
    raise exception 'OKR edit denied' using errcode = '42501';
  end if;
  if p_change ? 'mentioned_user_ids' then
    if jsonb_typeof(p_change->'mentioned_user_ids') <> 'array' then raise exception 'Invalid mention list'; end if;
    select coalesce(array_agg(distinct value::uuid), '{}') into v_ids from jsonb_array_elements_text(p_change->'mentioned_user_ids');
    foreach v_user in array v_ids loop
      select coalesce(nullif(btrim(display_name), ''), '团队成员') into v_name from public.profiles where id=v_user;
      if v_user=auth.uid() or v_name is null or not exists (
        select 1 from public.workspace_members where workspace_id=v_set.workspace_id and user_id=v_user)
        or not (case p_kind when 'objective' then anttodo_private.can_view_okr_objective_for_user(p_id,v_user)
          else anttodo_private.can_view_okr_key_result_for_user(p_id,v_user) end) then
        raise exception 'Mention recipient cannot view this OKR' using errcode='42501';
      end if;
      if strpos(v_note, '@'||v_name)=0 and not exists (select 1 from public.okr_note_mentions m
        where m.user_id=v_user and (case p_kind when 'objective' then m.objective_id=p_id else m.key_result_id=p_id end)
          and strpos(v_note,'@'||m.display_name_snapshot)>0) then raise exception 'Mention is absent from note'; end if;
    end loop;
  else
    select coalesce(array_agg(user_id), '{}') into v_ids from public.okr_note_mentions m
    where (case p_kind when 'objective' then m.objective_id=p_id else m.key_result_id=p_id end)
      and strpos(v_note,'@'||m.display_name_snapshot)>0;
  end if;
  delete from public.okr_note_mentions m where (case p_kind when 'objective' then m.objective_id=p_id else m.key_result_id=p_id end) and not(m.user_id=any(v_ids));
  foreach v_user in array v_ids loop
    select coalesce(nullif(btrim(display_name), ''), '团队成员') into v_name from public.profiles where id=v_user;
    insert into public.okr_note_mentions(workspace_id,objective_id,key_result_id,user_id,display_name_snapshot)
      values(v_set.workspace_id,case when p_kind='objective' then p_id end,case when p_kind='key_result' then p_id end,v_user,v_name)
      on conflict do nothing returning * into v_mention;
    if v_mention.id is not null then
      insert into public.notifications(workspace_id,task_id,objective_id,key_result_id,recipient_id,actor_id,notification_type,payload,dedupe_key)
      values(v_set.workspace_id,null,v_mention.objective_id,v_mention.key_result_id,v_user,auth.uid(),'okr_mentioned',
        jsonb_build_object('owner_id',v_set.owner_id,'cycle_id',v_set.cycle_id,'title',v_title,'summary',left(regexp_replace(v_note,'[[:space:]]+',' ','g'),120)),
        'okr-note:'||p_id::text||':'||v_user::text);
      -- In-app only: deliberately bypass the external dispatch buffer.
    end if;
  end loop;
end; $$;
revoke all on function anttodo_private.sync_okr_note_mentions(text,uuid,jsonb) from public, anon;
grant execute on function anttodo_private.sync_okr_note_mentions(text,uuid,jsonb) to authenticated;

create function anttodo_private.remove_okr_mention_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.notifications where notification_type='okr_mentioned'
    and dedupe_key='okr-note:'||coalesce(old.objective_id,old.key_result_id)::text||':'||old.user_id::text;
  return old;
end; $$;
revoke all on function anttodo_private.remove_okr_mention_notification() from public, anon, authenticated;
create trigger okr_note_mentions_remove_notification after delete on public.okr_note_mentions
for each row execute function anttodo_private.remove_okr_mention_notification();

-- Notifications remain visible only to their recipient while the target is accessible.
drop policy notifications_select on public.notifications;
drop policy notifications_update on public.notifications;
create policy notifications_select on public.notifications for select to authenticated using (
  recipient_id=(select auth.uid()) and (
    (task_id is not null and anttodo_private.can_view_task(task_id)) or
    (objective_id is not null and anttodo_private.can_view_okr_objective(objective_id)) or
    (key_result_id is not null and anttodo_private.can_view_okr_key_result(key_result_id))));
create policy notifications_update on public.notifications for update to authenticated using (
  recipient_id=(select auth.uid()) and (
    (task_id is not null and anttodo_private.can_view_task(task_id)) or
    (objective_id is not null and anttodo_private.can_view_okr_objective(objective_id)) or
    (key_result_id is not null and anttodo_private.can_view_okr_key_result(key_result_id))))
with check (recipient_id=(select auth.uid()) and (
    (task_id is not null and anttodo_private.can_view_task(task_id)) or
    (objective_id is not null and anttodo_private.can_view_okr_objective(objective_id)) or
    (key_result_id is not null and anttodo_private.can_view_okr_key_result(key_result_id))));

-- Apply existing Objective/KR changes under the caller's RLS, in one transaction.
create or replace function anttodo_private.apply_okr_change(
  p_kind text, p_id uuid, p_workspace_id uuid, p_change jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  entity_table text;
  entity_key text;
  allowed_fields text[];
  old_row jsonb;
  fields jsonb := coalesce(p_change -> 'fields', '{}'::jsonb);
  assignments text;
  relation_name text;
  relation_table text;
  subject_key text;
  ids uuid[];
  old_breakdowns jsonb;
begin
  if p_kind not in ('objective', 'key_result') then
    raise exception 'Invalid OKR entity kind';
  end if;
  entity_table := case p_kind when 'objective' then 'okr_objectives' else 'okr_key_results' end;
  entity_key := p_kind || '_id';
  allowed_fields := array['title', 'position', 'visibility', 'status_mode', 'progress_status',
    'start_value', 'target_value', 'current_value', 'metric_unit', 'custom_unit', 'score'];
  allowed_fields := allowed_fields || case p_kind
    when 'objective' then array['note', 'progress_mode'] else array['note', 'weight'] end;
  if jsonb_typeof(fields) <> 'object' or exists (
    select 1 from jsonb_object_keys(fields) k where not (k = any(allowed_fields))
  ) then
    raise exception 'Invalid OKR fields';
  end if;
  if fields ? 'title' then
    fields := jsonb_set(fields, '{title}', coalesce(to_jsonb(btrim(fields ->> 'title')), 'null'::jsonb));
  end if;
  execute format('select to_jsonb(t) from public.%I t where id = $1 and workspace_id = $2 for update', entity_table)
    into old_row using p_id, p_workspace_id;
  if old_row is null then
    raise exception 'OKR entity is unavailable';
  end if;
  -- Only name columns whose value actually changes, avoiding visibility triggers on title edits.
  select string_agg(format('%I = v.%I', k, k), ', ' order by k)
    into assignments
  from jsonb_object_keys(fields) k
  where fields -> k is distinct from old_row -> k;
  if assignments is not null then
    execute format('update public.%I t set %s, updated_at = now()
      from jsonb_populate_record(null::public.%I, $1) v where t.id = $2',
      entity_table, assignments, entity_table) using fields, p_id;
  end if;

  foreach relation_name in array array['responsible_ids', 'user_acl_ids', 'group_acl_ids'] loop
    if not (p_change ? relation_name) then continue; end if;
    if jsonb_typeof(p_change -> relation_name) <> 'array' then
      raise exception 'Invalid OKR member list';
    end if;
    select coalesce(array_agg(value::uuid order by ordinality), '{}'::uuid[]) into ids
      from jsonb_array_elements_text(p_change -> relation_name) with ordinality;
    if cardinality(ids) <> (select count(distinct x) from unnest(ids) x) then
      raise exception 'Duplicate OKR members';
    end if;
    relation_table := 'okr_' || p_kind || case relation_name
      when 'responsible_ids' then '_responsibles'
      when 'user_acl_ids' then '_user_acl' else '_group_acl' end;
    subject_key := case relation_name when 'group_acl_ids' then 'group_id' else 'user_id' end;
    if relation_name = 'responsible_ids' then
      -- These relation tables intentionally allow INSERT/DELETE, not UPDATE.
      -- Replace only moved/removed rows and keep unchanged memberships intact.
      execute format('delete from public.%I where %I = $1 and
        (not (user_id = any($2)) or position is distinct from array_position($2, user_id) - 1)',
        relation_table, entity_key) using p_id, ids;
      execute format('insert into public.%I (%I, workspace_id, user_id, position)
        select $1, $2, value, (ordinality - 1)::integer from unnest($3::uuid[]) with ordinality as x(value, ordinality)
        on conflict do nothing', relation_table, entity_key) using p_id, p_workspace_id, ids;
    else
      execute format('delete from public.%I where %I = $1 and not (%I = any($2))',
        relation_table, entity_key, subject_key) using p_id, ids;
      execute format('insert into public.%I (%I, workspace_id, %I)
        select $1, $2, value from unnest($3::uuid[]) value on conflict do nothing',
        relation_table, entity_key, subject_key) using p_id, p_workspace_id, ids;
    end if;
  end loop;

  if p_kind = 'objective' and p_change ? 'alignment_target_id' then
    delete from public.okr_objective_alignments
      where source_objective_id = p_id
        and target_objective_id is distinct from (p_change ->> 'alignment_target_id')::uuid;
    if p_change ->> 'alignment_target_id' is not null then
      insert into public.okr_objective_alignments(source_objective_id, target_objective_id, workspace_id)
        values (p_id, (p_change ->> 'alignment_target_id')::uuid, p_workspace_id)
        on conflict do nothing;
    end if;
  end if;
  if p_kind = 'key_result' and p_change ? 'breakdowns' then
    if jsonb_typeof(p_change -> 'breakdowns') <> 'array' then
      raise exception 'Invalid OKR breakdowns';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'allocated_value', allocated_value)
      order by position, id), '[]'::jsonb) into old_breakdowns
      from public.okr_kr_breakdowns where key_result_id = p_id;
    if old_breakdowns is distinct from p_change -> 'breakdowns' then
      delete from public.okr_kr_breakdowns where key_result_id = p_id;
      insert into public.okr_kr_breakdowns(key_result_id, workspace_id, user_id, allocated_value, position)
        select p_id, p_workspace_id, (value ->> 'user_id')::uuid,
          (value ->> 'allocated_value')::numeric, (ordinality - 1)::integer
        from jsonb_array_elements(p_change -> 'breakdowns') with ordinality;
    end if;
  end if;
  if fields ? 'note' or p_change ? 'mentioned_user_ids' then
    perform anttodo_private.sync_okr_note_mentions(p_kind,p_id,p_change);
  end if;
end;
$$;
revoke all on function anttodo_private.apply_okr_change(text, uuid, uuid, jsonb) from public, anon;
grant execute on function anttodo_private.apply_okr_change(text, uuid, uuid, jsonb) to authenticated;

create or replace function public.load_okr_set(
  p_workspace_id uuid,
  p_cycle_id uuid,
  p_owner_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select to_jsonb(s) || jsonb_build_object(
    'user_acl_ids', coalesce((
      select jsonb_agg(a.user_id order by a.user_id)
      from public.okr_set_user_acl a
      where a.set_id = s.id
    ), '[]'::jsonb),
    'group_acl_ids', coalesce((
      select jsonb_agg(a.group_id order by a.group_id)
      from public.okr_set_group_acl a
      where a.set_id = s.id
    ), '[]'::jsonb),
    'objectives', coalesce((
      select jsonb_agg(
        to_jsonb(o) || jsonb_build_object(
          'note_mentions', coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'display_name_snapshot',m.display_name_snapshot) order by m.user_id) from public.okr_note_mentions m where m.objective_id=o.id),'[]'::jsonb),
          'responsible_ids', coalesce((
            select jsonb_agg(r.user_id order by r.position, r.user_id)
            from public.okr_objective_responsibles r
            where r.objective_id = o.id
          ), '[]'::jsonb),
          'user_acl_ids', coalesce((
            select jsonb_agg(a.user_id order by a.user_id)
            from public.okr_objective_user_acl a
            where a.objective_id = o.id
          ), '[]'::jsonb),
          'group_acl_ids', coalesce((
            select jsonb_agg(a.group_id order by a.group_id)
            from public.okr_objective_group_acl a
            where a.objective_id = o.id
          ), '[]'::jsonb),
          'alignment_target_id', (
            select a.target_objective_id
            from public.okr_objective_alignments a
            where a.source_objective_id = o.id
          ),
          'key_results', coalesce((
            select jsonb_agg(
              to_jsonb(kr) || jsonb_build_object(
          'note_mentions', coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'display_name_snapshot',m.display_name_snapshot) order by m.user_id) from public.okr_note_mentions m where m.key_result_id=kr.id),'[]'::jsonb),
                'responsible_ids', coalesce((
                  select jsonb_agg(r.user_id order by r.position, r.user_id)
                  from public.okr_key_result_responsibles r
                  where r.key_result_id = kr.id
                ), '[]'::jsonb),
                'user_acl_ids', coalesce((
                  select jsonb_agg(a.user_id order by a.user_id)
                  from public.okr_key_result_user_acl a
                  where a.key_result_id = kr.id
                ), '[]'::jsonb),
                'group_acl_ids', coalesce((
                  select jsonb_agg(a.group_id order by a.group_id)
                  from public.okr_key_result_group_acl a
                  where a.key_result_id = kr.id
                ), '[]'::jsonb),
                'breakdowns', coalesce((
                  select jsonb_agg(to_jsonb(b) order by b.position, b.id)
                  from public.okr_kr_breakdowns b
                  where b.key_result_id = kr.id
                ), '[]'::jsonb)
              ) order by kr.position, kr.id
            )
            from public.okr_key_results kr
            where kr.objective_id = o.id
          ), '[]'::jsonb)
        ) order by o.position, o.id
      )
      from public.okr_objectives o
      where o.set_id = s.id
    ), '[]'::jsonb)
  )
  from public.okr_sets s
  where s.workspace_id = p_workspace_id
    and s.cycle_id = p_cycle_id
    and s.owner_id = p_owner_id
  limit 1
$$;

revoke all on function public.load_okr_set(uuid, uuid, uuid) from public, anon;
grant execute on function public.load_okr_set(uuid, uuid, uuid) to authenticated, service_role;


alter publication supabase_realtime add table public.okr_note_mentions;

create index okr_note_mentions_user_idx on public.okr_note_mentions(user_id);
create index okr_note_mentions_workspace_idx on public.okr_note_mentions(workspace_id);
create index notifications_objective_idx on public.notifications(objective_id) where objective_id is not null;
create index notifications_key_result_idx on public.notifications(key_result_id) where key_result_id is not null;
