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
