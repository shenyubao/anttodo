create or replace function anttodo_private.is_valid_task_matrix_definition(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    jsonb_typeof(value) = 'object'
    and value ?& array['labels', 'due', 'priorities', 'kinds', 'assignee']
    and value - array['labels', 'due', 'priorities', 'kinds', 'assignee'] = '{}'::jsonb
    and (
      value -> 'labels' = '"all"'::jsonb
      or (
        jsonb_typeof(value -> 'labels') = 'array'
        and jsonb_array_length(value -> 'labels') > 0
        and not exists (
          select 1 from jsonb_array_elements(value -> 'labels') item
          where jsonb_typeof(item) <> 'string' or item #>> '{}' = ''
        )
      )
    )
    and (
      value -> 'due' = '"all"'::jsonb
      or (
        jsonb_typeof(value -> 'due') = 'array'
        and jsonb_array_length(value -> 'due') > 0
        and not exists (
          select 1 from jsonb_array_elements_text(value -> 'due') item
          where item not in ('overdue', 'today', 'tomorrow', 'later', 'none')
        )
      )
    )
    and (
      value -> 'priorities' = '"all"'::jsonb
      or (
        jsonb_typeof(value -> 'priorities') = 'array'
        and jsonb_array_length(value -> 'priorities') > 0
        and not exists (
          select 1 from jsonb_array_elements_text(value -> 'priorities') item
          where item not in ('high', 'medium', 'low', 'none')
        )
      )
    )
    and (
      value -> 'kinds' = '"all"'::jsonb
      or (
        jsonb_typeof(value -> 'kinds') = 'array'
        and jsonb_array_length(value -> 'kinds') > 0
        and not exists (
          select 1 from jsonb_array_elements_text(value -> 'kinds') item
          where item not in ('todo', 'note')
        )
      )
    )
    and jsonb_typeof(value -> 'assignee') = 'string'
    and value ->> 'assignee' <> '';
$$;

update public.task_matrix_quadrants
set definition = definition || jsonb_build_object('assignee', user_id::text)
where not definition ? 'assignee';

revoke all on function anttodo_private.is_valid_task_matrix_definition(jsonb) from public;
grant execute on function anttodo_private.is_valid_task_matrix_definition(jsonb) to authenticated;
