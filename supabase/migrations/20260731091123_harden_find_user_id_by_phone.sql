create or replace function anttodo_private.find_user_id_by_phone(p_phone text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with normalized as (
    select nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '') as digits
  ),
  candidates as (
    select
      digits,
      case
        when length(digits) = 11 and digits ~ '^1[3-9]' then '+86' || digits
        when length(digits) = 13 and digits like '86%' then '+' || digits
        when length(digits) >= 8 then '+' || digits
        else null
      end as e164,
      case
        when length(digits) = 11 and digits ~ '^1[3-9]' then digits
        when length(digits) = 13 and digits like '86%' then substring(digits from 3)
        else null
      end as local_mobile,
      case
        when length(digits) = 11 and digits ~ '^1[3-9]' then '86' || digits
        when length(digits) = 13 and digits like '86%' then digits
        else null
      end as cn_digits
    from normalized
  )
  select u.id
  from auth.users u
  cross join candidates c
  where c.digits is not null
    and (
      u.phone = p_phone
      or (c.e164 is not null and u.phone = c.e164)
      or (c.cn_digits is not null and u.phone = c.cn_digits)
      or (c.local_mobile is not null and u.phone = c.local_mobile)
      or regexp_replace(coalesce(u.phone, ''), '\D', '', 'g') = c.digits
      or (
        c.local_mobile is not null
        and regexp_replace(coalesce(u.phone, ''), '\D', '', 'g') in (
          c.local_mobile,
          c.cn_digits
        )
      )
    )
  limit 1;
$$;

create or replace function public.find_user_id_by_phone(p_phone text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select anttodo_private.find_user_id_by_phone(p_phone);
$$;

revoke all on function public.find_user_id_by_phone(text)
  from public, anon, authenticated;
revoke all on function anttodo_private.find_user_id_by_phone(text)
  from public, anon, authenticated;

grant execute on function public.find_user_id_by_phone(text)
  to service_role;
grant execute on function anttodo_private.find_user_id_by_phone(text)
  to service_role;
