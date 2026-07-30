import { describe, expect, it } from "vitest";
import {
  isValidSmsOtp,
  maskPhone,
  normalizeMainlandPhone,
  phoneAuthErrorMessage,
} from "./auth";

describe("phone authentication helpers", () => {
  it("normalizes a mainland phone number to E.164", () => {
    expect(normalizeMainlandPhone("138 0013 8000")).toBe("+8613800138000");
    expect(normalizeMainlandPhone("12800138000")).toBeNull();
    expect(normalizeMainlandPhone("1380013800")).toBeNull();
  });

  it("validates six digit SMS codes", () => {
    expect(isValidSmsOtp("123456")).toBe(true);
    expect(isValidSmsOtp("12345")).toBe(false);
    expect(isValidSmsOtp("12345a")).toBe(false);
  });

  it("masks mainland phone numbers", () => {
    expect(maskPhone("+8613800138000")).toBe("138****8000");
    expect(maskPhone("13800138000")).toBe("138****8000");
    expect(maskPhone("")).toBe("");
  });

  it("maps provider errors to safe Chinese messages", () => {
    expect(phoneAuthErrorMessage("SMS rate limit exceeded", "send")).toContain("频繁");
    expect(phoneAuthErrorMessage("Token has expired", "verify")).toContain("过期");
    expect(phoneAuthErrorMessage("Invalid OTP token", "verify")).toContain("不正确");
    expect(phoneAuthErrorMessage("provider unavailable", "send")).not.toContain("provider");
  });
});
