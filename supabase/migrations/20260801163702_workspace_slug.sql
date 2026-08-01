-- Add a globally unique workspace slug for team identity and settings edits.

alter table public.workspaces
  add column slug text;

update public.workspaces
set slug = 'team-' || replace(id::text, '-', '')
where slug is null;

alter table public.workspaces
  alter column slug set not null;

alter table public.workspaces
  add constraint workspaces_slug_format_check
  check (
    char_length(slug) between 2 and 48
    and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  );

create unique index workspaces_slug_key on public.workspaces (slug);

create or replace function anttodo_private.normalize_workspace_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug is null or btrim(new.slug) = '' then
    new.slug := 'team-' || replace(new.id::text, '-', '');
  else
    new.slug := lower(btrim(new.slug));
  end if;
  return new;
end;
$$;

revoke all on function anttodo_private.normalize_workspace_slug()
from public, anon, authenticated;

create trigger workspaces_normalize_slug
before insert or update of slug on public.workspaces
for each row execute function anttodo_private.normalize_workspace_slug();

create or replace function public.is_workspace_slug_available(
  p_slug text,
  p_workspace_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.workspaces
    where slug = lower(btrim(p_slug))
      and (p_workspace_id is null or id <> p_workspace_id)
  );
$$;

revoke all on function public.is_workspace_slug_available(text, uuid)
from public, anon;
grant execute on function public.is_workspace_slug_available(text, uuid)
to authenticated;
