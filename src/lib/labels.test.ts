import { describe, expect, it } from "vitest";
import {
  DEFAULT_LABEL_COLOR,
  hasExplicitLabelColor,
  LABEL_COLORS,
} from "./labels";

describe("label colors", () => {
  it("treats the default task-label gray as no explicit label color", () => {
    expect(hasExplicitLabelColor(DEFAULT_LABEL_COLOR)).toBe(false);
    expect(hasExplicitLabelColor(DEFAULT_LABEL_COLOR.toUpperCase())).toBe(false);
  });

  it("keeps gray out of the user-selectable palette", () => {
    expect(LABEL_COLORS).not.toContain(DEFAULT_LABEL_COLOR);
    expect(LABEL_COLORS.every(hasExplicitLabelColor)).toBe(true);
  });
});
