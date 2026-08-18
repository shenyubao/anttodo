\set ON_ERROR_STOP on

do $$
begin
  if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='subtasks')
    then raise exception 'legacy table was removed despite rollback'; end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='parent_task_id')
    then raise exception 'task tree columns survived a failed transaction'; end if;
  if exists(select 1 from supabase_migrations.schema_migrations where version='20260814133125')
    then raise exception 'failed migration was recorded as applied'; end if;
end $$;
select 'unify_task_tree collision rollback passed' as result;
