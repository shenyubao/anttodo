import { describe, expect, it } from "vitest";
import {
  APP_ORIGIN,
  SESSION_MESSAGE_TYPE,
  isTrustedSessionMessage,
  sessionBridgeUrl,
} from "./sessionRedirect";

describe("landing session redirect", () => {
  it("builds a bridge URL with an explicit parent origin", () => {
    expect(sessionBridgeUrl("https://anttodo.com")).toBe(
      "https://app.anttodo.com/auth/session-bridge?parent_origin=https%3A%2F%2Fanttodo.com",
    );
  });

  it("accepts only a boolean status from the expected frame and app origin", () => {
    const frame = {} as Window;
    const valid = { origin: APP_ORIGIN, source: frame, data: { type: SESSION_MESSAGE_TYPE, authenticated: true } };
    expect(isTrustedSessionMessage(valid, frame)).toBe(true);
    expect(isTrustedSessionMessage({ ...valid, origin: "https://evil.example" }, frame)).toBe(false);
    expect(isTrustedSessionMessage({ ...valid, source: {} as Window }, frame)).toBe(false);
    expect(isTrustedSessionMessage({ ...valid, data: { type: SESSION_MESSAGE_TYPE, authenticated: "yes" } }, frame)).toBe(false);
  });
});
