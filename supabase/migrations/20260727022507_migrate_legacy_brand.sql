do $migration$
declare
  function_record record;
begin
  if to_regnamespace('actionhub_private') is null then
    return;
  end if;

  if to_regnamespace('anttodo_private') is not null then
    raise exception
      'Cannot migrate legacy schema: anttodo_private already exists';
  end if;

  alter schema actionhub_private rename to anttodo_private;

  for function_record in
    select procedure.oid
    from pg_proc as procedure
    join pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('public', 'anttodo_private')
      and pg_get_functiondef(procedure.oid) like '%actionhub_private%'
  loop
    execute replace(
      pg_get_functiondef(function_record.oid),
      'actionhub_private',
      'anttodo_private'
    );
  end loop;

  update vault.secrets
  set name = replace(name, 'actionhub_', 'anttodo_'),
      description = replace(
        coalesce(description, ''),
        'ActionHub',
        'AntTodo'
      )
  where name like 'actionhub_%';

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (
      select 1
      from cron.job
      where jobname = 'actionhub-mock-sync'
    ) then
      perform cron.unschedule('actionhub-mock-sync');
    end if;

    if not exists (
      select 1
      from cron.job
      where jobname = 'anttodo-mock-sync'
    ) then
      perform cron.schedule(
        'anttodo-mock-sync',
        '*/5 * * * *',
        'select anttodo_private.run_due_mock_connectors()'
      );
    end if;
  end if;
end
$migration$;
