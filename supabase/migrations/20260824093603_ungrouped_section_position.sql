-- Leave slot 0 for the virtual ungrouped bucket so existing lists keep it first.
-- Custom section positions are visual indexes in 0..N; ungrouped occupies the missing integer.
update public.task_sections
set position = position + 1;
