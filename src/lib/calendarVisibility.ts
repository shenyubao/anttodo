import type { Member, Task, UserGroupMember } from "../types";

export const CALENDAR_UNASSIGNED_ID = "unassigned";

export function calendarAssigneeFilterIds(members: Iterable<Pick<Member, "user_id">>) {
  return [CALENDAR_UNASSIGNED_ID, ...Array.from(members, (member) => member.user_id)];
}

export function memberIdsForUserGroup(
  groupId: string,
  memberships: Iterable<Pick<UserGroupMember, "group_id" | "user_id">>,
) {
  return Array.from(memberships)
    .filter((membership) => membership.group_id === groupId)
    .map((membership) => membership.user_id);
}

export function isUserGroupFullyVisible(
  groupId: string,
  visibleAssigneeIds: ReadonlySet<string>,
  memberships: Iterable<Pick<UserGroupMember, "group_id" | "user_id">>,
) {
  const memberIds = memberIdsForUserGroup(groupId, memberships);
  return memberIds.length > 0 && memberIds.every((userId) => visibleAssigneeIds.has(userId));
}

export function areAllUserGroupsFullyVisible(
  groupIds: Iterable<string>,
  visibleAssigneeIds: ReadonlySet<string>,
  memberships: Iterable<Pick<UserGroupMember, "group_id" | "user_id">>,
) {
  const ids = Array.from(groupIds);
  if (ids.length === 0) return false;
  return ids.every((groupId) => isUserGroupFullyVisible(groupId, visibleAssigneeIds, memberships));
}

export function toggleUserGroupInAssigneeFilter(
  current: ReadonlySet<string>,
  groupId: string,
  memberships: Iterable<Pick<UserGroupMember, "group_id" | "user_id">>,
) {
  const next = new Set(current);
  const memberIds = memberIdsForUserGroup(groupId, memberships);
  if (memberIds.length === 0) return next;
  if (memberIds.every((userId) => next.has(userId))) {
    for (const userId of memberIds) next.delete(userId);
  } else {
    for (const userId of memberIds) next.add(userId);
  }
  return next;
}

export function toggleAllUserGroupsInAssigneeFilter(
  current: ReadonlySet<string>,
  groupIds: Iterable<string>,
  memberships: Iterable<Pick<UserGroupMember, "group_id" | "user_id">>,
) {
  const next = new Set(current);
  const ids = Array.from(groupIds);
  const membershipList = Array.from(memberships);
  const allVisible = areAllUserGroupsFullyVisible(ids, next, membershipList);
  for (const groupId of ids) {
    const memberIds = memberIdsForUserGroup(groupId, membershipList);
    for (const userId of memberIds) {
      if (allVisible) next.delete(userId);
      else next.add(userId);
    }
  }
  return next;
}

export function taskMatchesCalendarLabels(
  task: Pick<Task, "label_ids">,
  visibleCalendarIds: ReadonlySet<string>,
) {
  return task.label_ids.length === 0
    ? visibleCalendarIds.has("inbox")
    : task.label_ids.some((labelId) => visibleCalendarIds.has(labelId));
}

export function taskMatchesCalendarAssignees(
  task: Pick<Task, "assignee_id">,
  visibleAssigneeIds: ReadonlySet<string>,
) {
  if (task.assignee_id == null) return visibleAssigneeIds.has(CALENDAR_UNASSIGNED_ID);
  return visibleAssigneeIds.has(task.assignee_id);
}

export function taskIsVisibleOnCalendar(
  task: Pick<Task, "label_ids" | "assignee_id">,
  visibleCalendarIds: ReadonlySet<string>,
  visibleAssigneeIds: ReadonlySet<string>,
) {
  return taskMatchesCalendarLabels(task, visibleCalendarIds)
    && taskMatchesCalendarAssignees(task, visibleAssigneeIds);
}
