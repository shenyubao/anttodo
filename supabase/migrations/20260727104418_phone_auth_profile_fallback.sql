create or replace function anttodo_private.on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  default_name text;
begin
  default_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(split_part(new.email, '@', 1), ''),
    case
      when new.phone ~ '^\+86[0-9]{11}$'
        then substring(new.phone from 4 for 3) || '****' || right(new.phone, 4)
      else nullif(new.phone, '')
    end,
    'AntTodo 用户'
  );

  insert into public.profiles (id, display_name)
  values (new.id, default_name)
  on conflict (id) do nothing;
  return new;
end;
$$;
