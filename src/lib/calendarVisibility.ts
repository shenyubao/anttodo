import type {
  CustomTaskView,
  DateTimePreferences,
  Member,
  Task,
  UserGroupMember,
} from "../types";
import { applyTaskListFilters, customTaskViewKey } from "./taskList";
import { taskHasUserLabels, taskUserLabelIds } from "./labels";

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
  labels: Iterable<{ id: string; is_system?: boolean }> = [],
) {
  const userLabelIds = taskUserLabelIds(task.label_ids, labels);
  return userLabelIds.length === 0
    ? visibleCalendarIds.has("inbox")
    : userLabelIds.some((labelId) => visibleCalendarIds.has(labelId));
}

export function taskMatchesCalendarAssignees(
  task: Pick<Task, "assignee_id">,
  visibleAssigneeIds: ReadonlySet<string>,
) {
  if (task.assignee_id == null) return visibleAssigneeIds.has(CALENDAR_UNASSIGNED_ID);
  return visibleAssigneeIds.has(task.assignee_id);
}

export function taskMatchesCalendarSmartViews(
  task: Task,
  activeViewIds: ReadonlySet<string>,
  customViews: Iterable<CustomTaskView>,
  currentUserId: string,
  now = new Date(),
  weekStartsOn: DateTimePreferences["weekStartsOn"] = 1,
  labels: Iterable<{ id: string; is_system?: boolean }> = [],
) {
  if (activeViewIds.size === 0) return true;
  const customViewsByKey = new Map<string, CustomTaskView>(
    Array.from(customViews, (view) => [customTaskViewKey(view.id), view]),
  );

  for (const viewId of activeViewIds) {
    if (viewId === "assigned" && task.assignee_id === currentUserId) return true;
    if (viewId === "watching" && task.participant_ids.includes(currentUserId)) return true;

    const customView = customViewsByKey.get(viewId);
    if (!customView || customView.definition.scope === "trash") continue;
    if (customView.definition.scope === "inbox" && taskHasUserLabels(task, labels)) continue;
    if (
      customView.definition.scope === "label"
      && !task.label_ids.some((labelId) => customView.definition.label_ids.includes(labelId))
    ) continue;

    const matches = applyTaskListFilters({
      tasks: [task],
      filterAssignee: customView.definition.filter_assignee,
      filterAssigneeIds: customView.definition.filter_assignee_ids,
      filterWatching: customView.definition.filter_watching,
      filterCreator: customView.definition.filter_creator,
      filterDue: customView.definition.filter_due,
      currentUserId,
      now,
      weekStartsOn,
    });
    if (matches.length > 0) return true;
  }
  return false;
}

export function taskIsVisibleOnCalendar(
  task: Pick<Task, "label_ids" | "assignee_id">,
  visibleCalendarIds: ReadonlySet<string>,
  visibleAssigneeIds: ReadonlySet<string>,
  labels: Iterable<{ id: string; is_system?: boolean }> = [],
) {
  return taskMatchesCalendarLabels(task, visibleCalendarIds, labels)
    && taskMatchesCalendarAssignees(task, visibleAssigneeIds);
}
