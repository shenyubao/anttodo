import type { Member } from "../types";

export type MentionQuery = { start: number; query: string };

export function memberDisplayName(member: Member) {
  return member.profile?.display_name?.trim() || "团队成员";
}

export function detectMentionQuery(value: string, caret: number): MentionQuery | null {
  const prefix = value.slice(0, caret);
  const match = /(?:^|\s)@([^\s@]*)$/.exec(prefix);
  if (!match) return null;
  return {
    start: caret - match[1].length - 1,
    query: match[1],
  };
}

export function visibleMentionIds(
  body: string,
  selectedIds: Iterable<string>,
  members: Member[],
) {
  const names = new Map(members.map((member) => [member.user_id, memberDisplayName(member)]));
  return [...new Set(selectedIds)].filter((id) => {
    const name = names.get(id);
    return name ? body.includes(`@${name}`) : false;
  });
}

export function filterMentionCandidates(input: {
  members: Member[];
  candidateIds: string[] | null;
  currentUserId: string;
  query: string;
}) {
  const allowed = new Set(input.candidateIds ?? []);
  const query = input.query.toLocaleLowerCase("zh-CN");
  return input.members.filter((member) =>
    member.user_id !== input.currentUserId
    && allowed.has(member.user_id)
    && memberDisplayName(member).toLocaleLowerCase("zh-CN").includes(query));
}

/** Expand a collapsed caret selection backward by `count` characters. */
export function expandSelectionBackward(count: number) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed || count <= 0) {
    return false;
  }
  for (let index = 0; index < count; index += 1) {
    selection.modify("extend", "backward", "character");
  }
  return !selection.isCollapsed;
}

export function getPlainTextBeforeCaret(root: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;
  const caret = selection.getRangeAt(0);
  if (!root.contains(caret.startContainer)) return null;
  const prefix = document.createRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(caret.startContainer, caret.startOffset);
  return prefix.toString();
}

export function caretClientRect() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.left === 0) {
    return null;
  }
  return rect;
}
