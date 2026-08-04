import { orderedLabels } from "./taskList";
import type {
  Label,
  LabelPermissionLevel,
  Member,
  UserLabelOrder,
} from "../types";

export type TitleTokenKind = "assignee" | "label";

export type TitleTokenFeatures = {
  assignee: boolean;
  labels: boolean;
};

export type DetectedTitleToken = {
  kind: TitleTokenKind;
  /** Index of the `@` or `#` trigger character. */
  start: number;
  query: string;
};

export function memberDisplayName(member: Member) {
  return member.profile?.display_name?.trim() || "团队成员";
}

export function detectTitleTokenAtCaret(
  value: string,
  caret: number,
  features: TitleTokenFeatures,
): DetectedTitleToken | null {
  const prefix = value.slice(0, Math.max(0, Math.min(caret, value.length)));
  if (features.assignee) {
    const assignee = /(?:^|\s)@([^\s@#]*)$/.exec(prefix);
    if (assignee) {
      return {
        kind: "assignee",
        start: prefix.length - assignee[1].length - 1,
        query: assignee[1],
      };
    }
  }
  if (features.labels) {
    const label = /(?:^|\s)#([^\s@#]*)$/.exec(prefix);
    if (label) {
      return {
        kind: "label",
        start: prefix.length - label[1].length - 1,
        query: label[1],
      };
    }
  }
  return null;
}

/** Strip the active `@query` / `#query` (and a trailing space if present) from the title. */
export function applyTitleTokenSelection(
  value: string,
  caret: number,
  token: DetectedTitleToken,
): { title: string; caret: number } {
  let end = caret;
  if (value[end] === " ") end += 1;
  const title = `${value.slice(0, token.start)}${value.slice(end)}`;
  return { title, caret: token.start };
}

export function filterAssigneeCandidates(
  members: Member[],
  currentUserId: string,
  query: string,
) {
  const normalized = query.toLocaleLowerCase("zh-CN");
  return members
    .filter((member) =>
      memberDisplayName(member).toLocaleLowerCase("zh-CN").includes(normalized))
    .sort((left, right) => {
      if (left.user_id === currentUserId) return -1;
      if (right.user_id === currentUserId) return 1;
      return memberDisplayName(left).localeCompare(
        memberDisplayName(right),
        "zh-CN",
      );
    });
}

export function filterLabelCandidates(
  labels: Label[],
  labelPermissionLevels: Record<string, LabelPermissionLevel | undefined>,
  query: string,
  userLabelOrder?: Iterable<Pick<UserLabelOrder, "label_id" | "position">>,
  excludeIds?: Iterable<string>,
) {
  const excluded = excludeIds ? new Set(excludeIds) : null;
  const normalized = query.toLocaleLowerCase("zh-CN");
  return orderedLabels(labels, userLabelOrder).filter((label) => {
    if (excluded?.has(label.id)) return false;
    if ((labelPermissionLevels[label.id] ?? 0) < 2) return false;
    return label.name.toLocaleLowerCase("zh-CN").includes(normalized);
  });
}

export function mergeLabelIds(defaults: string[], picked: string[]) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const id of [...defaults, ...picked]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}
