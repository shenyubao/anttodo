create extension if not exists pg_net with schema extensions;

create table public.task_reminders (
  id uuid primary key default extensions.gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  anchor text not null check (anchor in ('start', 'end')),
  offset_value integer not null check (offset_value between 0 and 525600),
  offset_unit text not null check (offset_unit in ('minute', 'hour', 'day', 'week')),
  local_time time,
  trigger_at timestamptz not null,
  position smallint not null check (position between 0 and 9),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (local_time is null or offset_unit in ('day', 'week')),
  unique nulls not distinct (task_id, anchor, offset_value, offset_unit, local_time),
  unique (task_id, position),
  check (
    offset_value * case offset_unit
      when 'minute' then 1
      when 'hour' then 60
      when 'day' then 1440
      when 'week' then 10080
    end <= 525600
  )
);

create table public.task_reminder_settings (
  task_id uuid primary key references public.tasks(id) on delete cascade,
  persistent boolean not null default false,
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Push credentials and delivery acknowledgements never receive authenticated
-- Data API grants. Edge Functions access them with the service role only.
create table public.web_push_subscriptions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  expires_at timestamptz,
  user_agent text,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reminder_delivery_states (
  id uuid primary key default extensions.gen_random_uuid(),
  reminder_id uuid not null references public.task_reminders(id) on delete cascade,
  scheduled_for timestamptz not null,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  persistent boolean not null default false,
  first_sent_at timestamptz,
  next_delivery_at timestamptz not null,
  repeat_count smallint not null default 0 check (repeat_count between 0 and 15),
  acknowledgement_token_hash text not null,
  acknowledged_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reminder_id, scheduled_for, recipient_id)
);

create index task_reminders_due_idx
on public.task_reminders(trigger_at)
where trigger_at is not null;

create index reminder_delivery_states_due_idx
on public.reminder_delivery_states(next_delivery_at)
where acknowledged_at is null and cancelled_at is null;

create index web_push_subscriptions_user_idx
on public.web_push_subscriptions(user_id)
where disabled_at is null;

create trigger task_reminders_updated_at before update on public.task_reminders
for each row execute function anttodo_private.set_updated_at();
create trigger task_reminder_settings_updated_at before update on public.task_reminder_settings
for each row execute function anttodo_private.set_updated_at();
create trigger web_push_subscriptions_updated_at before update on public.web_push_subscriptions
for each row execute function anttodo_private.set_updated_at();
create trigger reminder_delivery_states_updated_at before update on public.reminder_delivery_states
for each row execute function anttodo_private.set_updated_at();

alter table public.task_reminders enable row level security;
alter table public.task_reminder_settings enable row level security;
alter table public.web_push_subscriptions enable row level security;
alter table public.reminder_delivery_states enable row level security;

create policy task_reminders_select
on public.task_reminders for select to authenticated
using ((select anttodo_private.can_view_task(task_id)));

create policy task_reminder_settings_select
on public.task_reminder_settings for select to authenticated
using ((select anttodo_private.can_view_task(task_id)));

grant select on public.task_reminders, public.task_reminder_settings to authenticated;
revoke all on public.web_push_subscriptions, public.reminder_delivery_states
  from public, anon, authenticated;
grant all on public.task_reminders, public.task_reminder_settings,
  public.web_push_subscriptions, public.reminder_delivery_states to service_role;

create or replace function anttodo_private.reminder_trigger_at(
  p_task_id uuid,
  p_anchor text,
  p_offset_value integer,
  p_offset_unit text,
  p_local_time time
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
  v_anchor timestamptz;
  v_minutes integer;
  v_days integer;
  v_zone text;
begin
  select * into strict v_task from public.tasks where id = p_task_id;
  v_anchor := case
    when p_anchor = 'end' then v_task.due_at
    else coalesce(v_task.due_start_at, v_task.due_at)
  end;
  if v_anchor is null then
    raise exception 'A due date is required before reminders can be saved';
  end if;

  if p_local_time is not null then
    v_zone := coalesce(v_task.due_timezone, 'UTC');
    v_days := p_offset_value * case when p_offset_unit = 'week' then 7 else 1 end;
    return (((v_anchor at time zone v_zone)::date - v_days) + p_local_time)
      at time zone v_zone;
  end if;

  v_minutes := p_offset_value * case p_offset_unit
    when 'minute' then 1
    when 'hour' then 60
    when 'day' then 1440
    when 'week' then 10080
  end;
  return v_anchor - make_interval(mins => v_minutes);
end;
$$;

create or replace function anttodo_private.validate_reminder_rules(p_reminders jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_rule jsonb;
  v_offset integer;
  v_unit text;
begin
  if jsonb_typeof(coalesce(p_reminders, '[]'::jsonb)) <> 'array' then
    raise exception 'Reminder rules must be an array';
  end if;
  if jsonb_array_length(coalesce(p_reminders, '[]'::jsonb)) > 10 then
    raise exception 'Each task supports at most 10 reminders';
  end if;
  if (
    select count(*) <> count(distinct concat_ws(':',
      value->>'anchor', value->>'offset_value', value->>'offset_unit', value->>'local_time'
    ))
    from jsonb_array_elements(coalesce(p_reminders, '[]'::jsonb))
  ) then
    raise exception 'Duplicate reminder rules are not allowed';
  end if;
  for v_rule in select value from jsonb_array_elements(coalesce(p_reminders, '[]'::jsonb)) loop
    if coalesce(v_rule->>'anchor', '') not in ('start', 'end')
      or coalesce(v_rule->>'offset_unit', '') not in ('minute', 'hour', 'day', 'week')
      or coalesce(v_rule->>'offset_value', '') !~ '^\d+$'
      or (v_rule ? 'local_time' and jsonb_typeof(v_rule->'local_time') <> 'null'
        and coalesce(v_rule->>'local_time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
      raise exception 'Invalid reminder rule';
    end if;
    v_offset := (v_rule->>'offset_value')::integer;
    v_unit := v_rule->>'offset_unit';
    if jsonb_typeof(v_rule->'local_time') = 'string'
      and v_unit not in ('day', 'week') then
      raise exception 'All-day reminders must use day or week offsets';
    end if;
    if v_offset * (case v_unit
      when 'minute' then 1 when 'hour' then 60
      when 'day' then 1440 when 'week' then 10080 end) > 525600 then
      raise exception 'A reminder cannot be more than 365 days early';
    end if;
  end loop;
end;
$$;

create or replace function public.save_task_schedule(
  p_task_id uuid,
  p_due_at timestamptz,
  p_due_start_at timestamptz,
  p_due_is_all_day boolean,
  p_due_timezone text,
  p_reminders jsonb default '[]'::jsonb,
  p_persistent boolean default false
)
returns setof public.task_reminders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule jsonb;
  v_position integer;
  v_local_time time;
begin
  if (select auth.uid()) is null
    or not anttodo_private.can_edit_task(p_task_id) then
    raise exception 'Insufficient task permission' using errcode = '42501';
  end if;
  if p_due_timezone is not null and char_length(p_due_timezone) not between 1 and 100 then
    raise exception 'Invalid time zone';
  end if;
  perform anttodo_private.validate_reminder_rules(p_reminders);
  if p_due_at is null and jsonb_array_length(coalesce(p_reminders, '[]'::jsonb)) > 0 then
    raise exception 'A due date is required before reminders can be saved';
  end if;

  update public.tasks set
    due_at = p_due_at,
    due_start_at = p_due_start_at,
    due_is_all_day = coalesce(p_due_is_all_day, false),
    due_timezone = p_due_timezone,
    version = version + 1
  where id = p_task_id;

  delete from public.task_reminders where task_id = p_task_id;
  delete from public.task_reminder_settings where task_id = p_task_id;

  if p_due_at is null then return; end if;

  if jsonb_array_length(coalesce(p_reminders, '[]'::jsonb)) > 0 then
    insert into public.task_reminder_settings(task_id, persistent, updated_by)
    values (p_task_id, coalesce(p_persistent, false), (select auth.uid()));
  end if;

  for v_rule, v_position in
    select value, (ordinality - 1)::integer
    from jsonb_array_elements(coalesce(p_reminders, '[]'::jsonb)) with ordinality
  loop
    v_local_time := case when jsonb_typeof(v_rule->'local_time') = 'string'
      then (v_rule->>'local_time')::time else null end;
    insert into public.task_reminders(
      task_id, anchor, offset_value, offset_unit, local_time,
      trigger_at, position, created_by
    ) values (
      p_task_id,
      v_rule->>'anchor',
      (v_rule->>'offset_value')::integer,
      v_rule->>'offset_unit',
      v_local_time,
      anttodo_private.reminder_trigger_at(
        p_task_id, v_rule->>'anchor', (v_rule->>'offset_value')::integer,
        v_rule->>'offset_unit', v_local_time
      ),
      v_position,
      (select auth.uid())
    );
  end loop;

  return query select * from public.task_reminders
    where task_id = p_task_id order by position;
end;
$$;

revoke all on function public.save_task_schedule(
  uuid, timestamptz, timestamptz, boolean, text, jsonb, boolean
) from public, anon;
grant execute on function public.save_task_schedule(
  uuid, timestamptz, timestamptz, boolean, text, jsonb, boolean
) to authenticated;

create or replace function anttodo_private.on_task_schedule_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.due_at is null or new.status <> 'open' or new.deleted_at is not null then
    update public.reminder_delivery_states d set cancelled_at = coalesce(cancelled_at, now())
    from public.task_reminders r where r.task_id = new.id and d.reminder_id = r.id
      and d.acknowledged_at is null;
    if new.due_at is null then
      delete from public.task_reminders where task_id = new.id;
      delete from public.task_reminder_settings where task_id = new.id;
    end if;
    return new;
  end if;

  if old.due_at is distinct from new.due_at
    or old.due_start_at is distinct from new.due_start_at
    or old.due_is_all_day is distinct from new.due_is_all_day
    or old.due_timezone is distinct from new.due_timezone then
    update public.task_reminders r set trigger_at =
      anttodo_private.reminder_trigger_at(
        r.task_id, r.anchor, r.offset_value, r.offset_unit, r.local_time
      )
    where r.task_id = new.id;
    update public.reminder_delivery_states d set cancelled_at = coalesce(cancelled_at, now())
    from public.task_reminders r where r.task_id = new.id and d.reminder_id = r.id
      and d.scheduled_for is distinct from r.trigger_at
      and d.acknowledged_at is null;
  end if;
  return new;
end;
$$;

create trigger tasks_schedule_changed
after update of due_at, due_start_at, due_is_all_day, due_timezone, status, deleted_at
on public.tasks for each row execute function anttodo_private.on_task_schedule_changed();

create or replace function anttodo_private.invoke_reminder_dispatch()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets
    where name = 'anttodo_project_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets
    where name = 'anttodo_reminder_dispatch_secret' limit 1;
  if nullif(v_url, '') is null or nullif(v_secret, '') is null then return null; end if;
  select net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/reminder-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-anttodo-dispatch-secret', v_secret),
    body := jsonb_build_object('scheduled_at', now())
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function anttodo_private.invoke_reminder_dispatch()
from public, anon, authenticated;
grant execute on function anttodo_private.invoke_reminder_dispatch() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'anttodo-reminder-dispatch') then
      perform cron.unschedule('anttodo-reminder-dispatch');
    end if;
    perform cron.schedule(
      'anttodo-reminder-dispatch', '* * * * *',
      'select anttodo_private.invoke_reminder_dispatch()'
    );
  end if;
end
$$;

do $$
declare v_table text;
begin
  foreach v_table in array array['task_reminders', 'task_reminder_settings'] loop
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end
$$;
