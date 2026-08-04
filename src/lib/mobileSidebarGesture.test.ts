import { describe, expect, it } from "vitest";
import {
  canStartMobileSidebarOpenGesture,
  mobileSidebarDragOffset,
  mobileSidebarDragProgress,
  mobileSidebarWidth,
  shouldCompleteMobileSidebarGesture,
} from "./mobileSidebarGesture";

describe("mobileSidebarGesture", () => {
  it("caps drawer width to 320px and 88vw", () => {
    expect(mobileSidebarWidth(400)).toBe(320);
    expect(mobileSidebarWidth(300)).toBeCloseTo(264);
  });

  it("only starts an open gesture from the left edge", () => {
    expect(canStartMobileSidebarOpenGesture(0)).toBe(true);
    expect(canStartMobileSidebarOpenGesture(24)).toBe(true);
    expect(canStartMobileSidebarOpenGesture(25)).toBe(false);
  });

  it("clamps drag offsets while opening and closing", () => {
    expect(mobileSidebarDragOffset("open", 320, 80)).toBe(-240);
    expect(mobileSidebarDragOffset("open", 320, 400)).toBe(0);
    expect(mobileSidebarDragOffset("open", 320, -20)).toBe(-320);
    expect(mobileSidebarDragOffset("close", 320, -80)).toBe(-80);
    expect(mobileSidebarDragOffset("close", 320, 40)).toBe(0);
    expect(mobileSidebarDragOffset("close", 320, -400)).toBe(-320);
  });

  it("maps drawer offset to scrim progress", () => {
    expect(mobileSidebarDragProgress(320, -320)).toBe(0);
    expect(mobileSidebarDragProgress(320, -160)).toBe(0.5);
    expect(mobileSidebarDragProgress(320, 0)).toBe(1);
  });

  it("completes open/close from distance or velocity", () => {
    expect(shouldCompleteMobileSidebarGesture({
      kind: "open",
      width: 320,
      deltaX: 120,
      velocityX: 0,
    })).toBe(true);
    expect(shouldCompleteMobileSidebarGesture({
      kind: "open",
      width: 320,
      deltaX: 40,
      velocityX: 0,
    })).toBe(false);
    expect(shouldCompleteMobileSidebarGesture({
      kind: "open",
      width: 320,
      deltaX: 20,
      velocityX: 0.5,
    })).toBe(true);
    expect(shouldCompleteMobileSidebarGesture({
      kind: "close",
      width: 320,
      deltaX: -120,
      velocityX: 0,
    })).toBe(true);
    expect(shouldCompleteMobileSidebarGesture({
      kind: "close",
      width: 320,
      deltaX: -20,
      velocityX: -0.5,
    })).toBe(true);
    expect(shouldCompleteMobileSidebarGesture({
      kind: "close",
      width: 320,
      deltaX: -20,
      velocityX: 0.5,
    })).toBe(false);
  });
});
