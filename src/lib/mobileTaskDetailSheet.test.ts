import { describe, expect, it } from "vitest";
import {
  mobileTaskDetailRatioFromTranslateY,
  mobileTaskDetailSnapRatio,
  mobileTaskDetailTranslateY,
  resolveMobileTaskDetailRelease,
} from "./mobileTaskDetailSheet";

describe("mobileTaskDetailSheet", () => {
  it("maps snap ratios and translateY", () => {
    expect(mobileTaskDetailSnapRatio("peek")).toBe(0.6);
    expect(mobileTaskDetailSnapRatio("full")).toBe(1);
    expect(mobileTaskDetailTranslateY(0.6, 1000)).toBe(400);
    expect(mobileTaskDetailTranslateY(1, 1000)).toBe(0);
    expect(mobileTaskDetailTranslateY(0, 1000)).toBe(1000);
    expect(mobileTaskDetailRatioFromTranslateY(400, 1000)).toBeCloseTo(0.6);
  });

  it("resolves release from velocity and position", () => {
    expect(resolveMobileTaskDetailRelease({
      ratio: 0.7,
      velocityY: -0.5,
    })).toBe("full");
    expect(resolveMobileTaskDetailRelease({
      ratio: 0.7,
      velocityY: 0.5,
    })).toBe("close");
    expect(resolveMobileTaskDetailRelease({
      ratio: 0.85,
      velocityY: 0,
    })).toBe("full");
    expect(resolveMobileTaskDetailRelease({
      ratio: 0.3,
      velocityY: 0,
    })).toBe("close");
    expect(resolveMobileTaskDetailRelease({
      ratio: 0.6,
      velocityY: 0,
    })).toBe("peek");
  });
});
