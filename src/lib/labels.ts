import type { Label, LabelAccessScope, LabelKind } from "../types";

export const DEFAULT_LABEL_COLOR = "#b8bdc8";

export const LABEL_COLORS = [
  "#ff6161",
  "#ffac38",
  "#ffd324",
  "#e6ea49",
  "#35d870",
  "#4ca1ff",
  "#6e75f4",
] as const;

export function hasExplicitLabelColor(color: string) {
  return color.toLowerCase() !== DEFAULT_LABEL_COLOR;
}

export type NewLabelAccessDefaults = {
  kind: LabelKind;
  viewScope: LabelAccessScope;
  manageScope: LabelAccessScope;
};

export function newLabelAccessDefaults(
  labels: Label[],
  parentId: string | null,
): NewLabelAccessDefaults {
  const parent = parentId
    ? labels.find((label) => label.id === parentId)
    : undefined;

  if (!parent) {
    return {
      kind: "private",
      viewScope: "all",
      manageScope: "users",
    };
  }

  return {
    kind: parent.kind,
    viewScope: "inherit",
    manageScope: "inherit",
  };
}
