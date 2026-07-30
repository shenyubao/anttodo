alter table public.workspace_invites
  alter column created_by drop not null,
  drop constraint workspace_invites_created_by_fkey,
  add constraint workspace_invites_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

alter table public.labels
  alter column created_by drop not null,
  drop constraint labels_created_by_fkey,
  add constraint labels_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

alter table public.tasks
  alter column created_by drop not null,
  drop constraint tasks_created_by_fkey,
  add constraint tasks_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

alter table public.connector_instances
  alter column created_by drop not null,
  drop constraint connector_instances_created_by_fkey,
  add constraint connector_instances_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

create or replace function anttodo_private.prepare_account_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owned_workspace record;
  successor_id uuid;
begin
  for owned_workspace in
    select workspace_id
    from public.workspace_members
    where user_id = old.id
      and role = 'owner'
  loop
    select member.user_id
    into successor_id
    from public.workspace_members member
    where member.workspace_id = owned_workspace.workspace_id
      and member.user_id <> old.id
    order by
      case member.role
        when 'admin' then 0
        when 'member' then 1
        else 2
      end,
      member.joined_at,
      member.user_id
    limit 1;

    if successor_id is null then
      delete from public.workspaces
      where id = owned_workspace.workspace_id;
    else
      update public.workspace_members
      set role = 'owner'
      where workspace_id = owned_workspace.workspace_id
        and user_id = successor_id;

      update public.workspaces
      set created_by = successor_id
      where id = owned_workspace.workspace_id
        and created_by = old.id;
    end if;
  end loop;

  return old;
end;
$$;

revoke all on function anttodo_private.prepare_account_deletion()
from public, anon, authenticated;

create trigger prepare_account_deletion
before delete on auth.users
for each row execute function anttodo_private.prepare_account_deletion();
