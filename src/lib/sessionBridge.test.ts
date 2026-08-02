import { describe, expect, it } from "vitest";
import {
  SESSION_BRIDGE_PATH,
  SESSION_STATUS_MESSAGE_TYPE,
  isSessionBridgePath,
  resolveSessionBridgeParentOrigin,
  sessionStatusMessage,
} from "./sessionBridge";

describe("session bridge", () => {
  it("matches only the dedicated bridge route", () => {
    expect(isSessionBridgePath(SESSION_BRIDGE_PATH)).toBe(true);
    expect(isSessionBridgePath(`${SESSION_BRIDGE_PATH}/`)).toBe(true);
    expect(isSessionBridgePath("/auth/dingtalk/callback")).toBe(false);
  });

  it("allows only the two production landing origins", () => {
    expect(resolveSessionBridgeParentOrigin(
      "?parent_origin=https%3A%2F%2Fanttodo.com",
      "https://anttodo.com/",
    )).toBe("https://anttodo.com");
    expect(resolveSessionBridgeParentOrigin(
      "?parent_origin=https%3A%2F%2Fwww.anttodo.com",
      "",
    )).toBe("https://www.anttodo.com");
    expect(resolveSessionBridgeParentOrigin(
      "?parent_origin=https%3A%2F%2Fevil.example",
      "https://evil.example/",
    )).toBeNull();
  });

  it("rejects a query/referrer mismatch and gates local development", () => {
    expect(resolveSessionBridgeParentOrigin(
      "?parent_origin=https%3A%2F%2Fanttodo.com",
      "https://www.anttodo.com/",
    )).toBeNull();
    expect(resolveSessionBridgeParentOrigin(
      "?parent_origin=http%3A%2F%2F127.0.0.1%3A4174",
      "http://127.0.0.1:4174/",
    )).toBeNull();
    expect(resolveSessionBridgeParentOrigin(
      "?parent_origin=http%3A%2F%2F127.0.0.1%3A4174",
      "http://127.0.0.1:4174/",
      true,
    )).toBe("http://127.0.0.1:4174");
  });

  it("returns only the public boolean status contract", () => {
    expect(sessionStatusMessage(true)).toEqual({
      type: SESSION_STATUS_MESSAGE_TYPE,
      authenticated: true,
    });
  });
});
