import { describe, expect, it } from "vitest";
import {
  isPhoneAlreadyRegisteredError,
  normalizeMainlandMobile,
} from "../../supabase/functions/_shared/dingtalk-sso-phone";

describe("DingTalk SSO phone helpers", () => {
  it("normalizes mainland mobile numbers with DingTalk state-code variants", () => {
    expect(normalizeMainlandMobile("13800138000", "86")).toBe("+8613800138000");
    expect(normalizeMainlandMobile("13800138000", "+86")).toBe("+8613800138000");
    expect(normalizeMainlandMobile("13800138000", "0086")).toBe("+8613800138000");
    expect(normalizeMainlandMobile("+86 138 0013 8000", "+86")).toBe(
      "+8613800138000",
    );
    expect(normalizeMainlandMobile("8613800138000")).toBe("+8613800138000");
    expect(normalizeMainlandMobile("008613800138000")).toBe("+8613800138000");
  });

  it("recognizes the stable Supabase phone conflict code", () => {
    expect(
      isPhoneAlreadyRegisteredError({
        code: "phone_exists",
        message: "localized error text",
      }),
    ).toBe(true);
  });

  it("keeps compatibility with older Supabase phone conflict messages", () => {
    expect(
      isPhoneAlreadyRegisteredError({
        message: "Phone number already registered by another user",
      }),
    ).toBe(true);
    expect(isPhoneAlreadyRegisteredError({ code: "validation_failed" })).toBe(false);
  });
});
