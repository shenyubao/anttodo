create or replace function anttodo_private.find_user_id_by_phone(p_phone text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with input_phone as (
    select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as digits
  ),
  normalized_input as (
    select
      digits,
      case
        when length(digits) = 11 and digits ~ '^1[3-9][0-9]{9}$' then digits
        when length(digits) = 13 and digits like '86%' then substring(digits from 3)
        when length(digits) = 15 and digits like '0086%' then substring(digits from 5)
        else null
      end as mainland_mobile
    from input_phone
  ),
  user_phones as (
    select
      id,
      regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') as digits
    from auth.users
    where phone is not null and phone <> ''
  ),
  normalized_users as (
    select
      id,
      digits,
      case
        when length(digits) = 11 and digits ~ '^1[3-9][0-9]{9}$' then digits
        when length(digits) = 13 and digits like '86%' then substring(digits from 3)
        when length(digits) = 15 and digits like '0086%' then substring(digits from 5)
        else null
      end as mainland_mobile
    from user_phones
  )
  select u.id
  from normalized_users u
  cross join normalized_input i
  where i.digits <> ''
    and (
      u.digits = i.digits
      or (
        i.mainland_mobile is not null
        and u.mainland_mobile = i.mainland_mobile
      )
    )
  order by (u.digits = i.digits) desc
  limit 1;
$$;

revoke all on function anttodo_private.find_user_id_by_phone(text)
  from public, anon, authenticated;

grant execute on function anttodo_private.find_user_id_by_phone(text)
  to service_role;
