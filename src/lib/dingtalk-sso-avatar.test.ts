import { describe, expect, it } from "vitest";
import { normalizeDingtalkAvatarUrl } from "../../supabase/functions/_shared/dingtalk-sso-avatar";

describe("DingTalk SSO avatar helpers", () => {
  it("accepts http(s) DingTalk avatar URLs", () => {
    expect(
      normalizeDingtalkAvatarUrl(
        "https://static-legacy.dingtalk.com/media/lADPGT5i9m5ZyXDNA4LNAtA_720.jpg",
      ),
    ).toBe(
      "https://static-legacy.dingtalk.com/media/lADPGT5i9m5ZyXDNA4LNAtA_720.jpg",
    );
    expect(
      normalizeDingtalkAvatarUrl(
        "  https://static-legacy.dingtalk.com/media/avatar.png  ",
      ),
    ).toBe("https://static-legacy.dingtalk.com/media/avatar.png");
  });

  it("rejects empty or non-http values", () => {
    expect(normalizeDingtalkAvatarUrl("")).toBeNull();
    expect(normalizeDingtalkAvatarUrl("   ")).toBeNull();
    expect(normalizeDingtalkAvatarUrl(null)).toBeNull();
    expect(normalizeDingtalkAvatarUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeDingtalkAvatarUrl("not-a-url")).toBeNull();
  });
});
