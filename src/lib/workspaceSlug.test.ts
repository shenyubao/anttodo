import { describe, expect, it } from "vitest";
import {
  isValidWorkspaceSlug,
  normalizeWorkspaceSlug,
  suggestWorkspaceSlug,
  workspaceSlugValidationMessage,
} from "./workspaceSlug";

describe("workspaceSlug", () => {
  it("normalizes whitespace and case", () => {
    expect(normalizeWorkspaceSlug("  Product-Team ")).toBe("product-team");
  });

  it("accepts valid slugs", () => {
    expect(isValidWorkspaceSlug("ab")).toBe(true);
    expect(isValidWorkspaceSlug("product-team")).toBe(true);
    expect(isValidWorkspaceSlug("team-a1b2c3d4e5")).toBe(true);
  });

  it("rejects invalid slugs", () => {
    expect(isValidWorkspaceSlug("A")).toBe(false);
    expect(isValidWorkspaceSlug("-team")).toBe(false);
    expect(isValidWorkspaceSlug("team-")).toBe(false);
    expect(isValidWorkspaceSlug("产品团队")).toBe(false);
    expect(workspaceSlugValidationMessage("Team_Name")).toContain("小写字母");
  });

  it("suggests ascii slugs from latin names and fallbacks for others", () => {
    expect(suggestWorkspaceSlug("Product Team")).toBe("product-team");
    expect(suggestWorkspaceSlug("产品研发团队")).toMatch(/^team-[a-z0-9]{10}$/);
  });
});
