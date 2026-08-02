-- The hosted project can carry an explicit anon grant from legacy default
-- privileges even though PUBLIC was revoked in the original migration.
revoke all on function public.merge_label_into(uuid, uuid)
from public, anon;

grant execute on function public.merge_label_into(uuid, uuid)
to authenticated;
