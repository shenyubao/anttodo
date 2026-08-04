import { describe, expect, it } from "vitest";
import { cliAuthorizationAad, cliAuthorizationUserCode } from "./cliDeviceAuth";

describe("CLI device authorization helpers", () => {
  it("recognizes only the dedicated route and normalizes the code", () => {
    expect(cliAuthorizationUserCode("/auth/cli", "?user_code=abcd-2345")).toBe("ABCD-2345");
    expect(cliAuthorizationUserCode("/auth/cli", "")).toBe("");
    expect(cliAuthorizationUserCode("/workspaces/1/tasks", "?user_code=x")).toBeNull();
  });

  it("binds ciphertext to request and user", () => {
    expect(cliAuthorizationAad("request", "user")).toBe(
      "anttodo-cli-device-auth-v1:request:user",
    );
  });
});
