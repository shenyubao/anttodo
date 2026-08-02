import { describe, expect, it } from "vitest";
import {
  createAuthCallbackQueue,
  isAllowedDingtalkExternalUrl,
  parseAuthDeepLink,
} from "./auth-deep-link.mjs";

const code = "a".repeat(43);

describe("desktop auth deep links", () => {
  it("accepts only the exact auth callback shape", () => {
    expect(parseAuthDeepLink(`anttodo://auth/callback?code=${code}`)).toBe(code);
    expect(parseAuthDeepLink(`anttodo://evil/callback?code=${code}`)).toBeNull();
    expect(parseAuthDeepLink(`anttodo://auth/callback?code=short`)).toBeNull();
    expect(parseAuthDeepLink(`anttodo://auth/callback?code=${code}&next=/`)).toBeNull();
    expect(parseAuthDeepLink(`https://app.anttodo.com/?code=${code}`)).toBeNull();
  });

  it("allows only DingTalk authorize and the production callback", () => {
    expect(
      isAllowedDingtalkExternalUrl("https://login.dingtalk.com/oauth2/auth?state=x"),
    ).toBe(true);
    expect(
      isAllowedDingtalkExternalUrl(
        "https://app.anttodo.com/auth/dingtalk/callback?authCode=x",
      ),
    ).toBe(true);
    expect(isAllowedDingtalkExternalUrl("https://app.anttodo.com/other")).toBe(false);
    expect(isAllowedDingtalkExternalUrl("http://login.dingtalk.com/oauth2/auth")).toBe(false);
  });

  it("deduplicates and bounds pending callbacks", () => {
    const queue = createAuthCallbackQueue(2);
    expect(queue.enqueue("first")).toBe(true);
    expect(queue.enqueue("first")).toBe(false);
    expect(queue.enqueue("second")).toBe(true);
    expect(queue.enqueue("third")).toBe(true);
    expect(queue.take()).toBe("second");
    expect(queue.take()).toBe("third");
    expect(queue.take()).toBeNull();
  });
});
