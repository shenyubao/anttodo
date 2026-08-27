import { describe, expect, it } from "vitest";
import { cliAuthorizationUserCode, cliOAuthAuthorizationId } from "./cliDeviceAuth";

describe("CLI device authorization helpers", () => {
  it("recognizes only the dedicated route and normalizes the code", () => {
    expect(cliAuthorizationUserCode("/auth/cli", "?user_code=abcd-2345")).toBe("ABCD-2345");
    expect(cliAuthorizationUserCode("/auth/cli", "")).toBe("");
    expect(cliAuthorizationUserCode("/workspaces/1/tasks", "?user_code=x")).toBeNull();
  });

  it("recognizes only the OAuth consent route", () => {
    expect(cliOAuthAuthorizationId("/oauth/consent", "?authorization_id=request")).toBe("request");
    expect(cliOAuthAuthorizationId("/auth/cli", "?authorization_id=request")).toBeNull();
  });
});
