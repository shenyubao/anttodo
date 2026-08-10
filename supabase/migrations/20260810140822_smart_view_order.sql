-- Persist system smart-view order alongside visibility.
alter table public.task_system_view_preferences
  add column if not exists position integer not null default 0;

create index if not exists task_system_view_preferences_user_position_idx
  on public.task_system_view_preferences(workspace_id, user_id, position);

-- Assign stable default positions for rows that only stored visibility.
update public.task_system_view_preferences as prefs
set position = defaults.position
from (
  values
    ('all', 0),
    ('today', 1),
    ('week', 2),
    ('assigned', 3),
    ('watching', 4),
    ('inbox', 5),
    ('trash', 6)
) as defaults(view_key, position)
where prefs.view_key = defaults.view_key;
