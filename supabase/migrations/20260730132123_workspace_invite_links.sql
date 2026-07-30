create table public.workspace_invite_links (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  role public.workspace_role not null default 'member',
  created_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (role <> 'owner')
);

create unique index workspace_invite_links_one_active_idx
  on public.workspace_invite_links (workspace_id)
  where revoked_at is null;

create index workspace_invite_links_created_by_idx
  on public.workspace_invite_links (created_by)
  where created_by is not null;

alter table public.workspace_invite_links enable row level security;
revoke all on table public.workspace_invite_links from public, anon, authenticated;
grant select, insert, update on table public.workspace_invite_links to service_role;

create or replace function anttodo_private.accept_workspace_invite_link(
  p_link_id uuid,
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite_link public.workspace_invite_links%rowtype;
begin
  if p_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select *
  into invite_link
  from public.workspace_invite_links
  where id = p_link_id
  for update;

  if not found then
    raise exception 'Invite link not found' using errcode = 'P0002';
  end if;

  if invite_link.revoked_at is not null then
    raise exception 'Invite link revoked' using errcode = '22023';
  end if;

  insert into public.workspace_members as member (workspace_id, user_id, role)
  values (invite_link.workspace_id, p_user_id, invite_link.role)
  on conflict (workspace_id, user_id) do update
  set role = case
    when member.role = 'owner' then 'owner'::public.workspace_role
    when member.role = 'admin' or excluded.role = 'admin'
      then 'admin'::public.workspace_role
    else 'member'::public.workspace_role
  end;

  return invite_link.workspace_id;
end;
$$;

revoke all on function anttodo_private.accept_workspace_invite_link(uuid, uuid)
  from public, anon, authenticated;
grant execute on function anttodo_private.accept_workspace_invite_link(uuid, uuid)
  to service_role;

-- PostgREST only exposes the public schema. This invoker wrapper remains harmless
-- to browser roles and delegates to the private implementation for service calls.
create or replace function public.accept_workspace_invite_link(
  p_link_id uuid,
  p_user_id uuid
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select anttodo_private.accept_workspace_invite_link(p_link_id, p_user_id);
$$;

revoke all on function public.accept_workspace_invite_link(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.accept_workspace_invite_link(uuid, uuid)
  to service_role;
