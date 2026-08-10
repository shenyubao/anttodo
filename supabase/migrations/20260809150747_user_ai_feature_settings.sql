create table public.user_ai_feature_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  smart_format_enabled boolean not null default true,
  smart_format_prompt_override text,
  subtask_decompose_enabled boolean not null default true,
  subtask_decompose_prompt_override text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_ai_feature_settings_format_prompt_check check (
    smart_format_prompt_override is null
    or char_length(btrim(smart_format_prompt_override)) between 1 and 8000
  ),
  constraint user_ai_feature_settings_decompose_prompt_check check (
    subtask_decompose_prompt_override is null
    or char_length(btrim(subtask_decompose_prompt_override)) between 1 and 8000
  )
);

create trigger user_ai_feature_settings_updated_at
before update on public.user_ai_feature_settings
for each row execute function anttodo_private.set_updated_at();

alter table public.user_ai_feature_settings enable row level security;

create policy user_ai_feature_settings_select_self
on public.user_ai_feature_settings for select to authenticated
using ((select auth.uid()) = user_id);

create policy user_ai_feature_settings_insert_self
on public.user_ai_feature_settings for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy user_ai_feature_settings_update_self
on public.user_ai_feature_settings for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update on public.user_ai_feature_settings to authenticated;
