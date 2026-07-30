import { describe, expect, it } from "vitest";
import {
  aliyunErrorStatus,
  normalizeWebhookSignature,
  parseSmsHookPayload,
} from "../../supabase/functions/_shared/sms-hook";

describe("send SMS hook helpers", () => {
  it("normalizes multiple signatures emitted during hook-secret rotation", () => {
    expect(normalizeWebhookSignature("v1,first, v1,second")).toBe(
      "v1,first v1,second",
    );
    expect(normalizeWebhookSignature("v1,single")).toBe("v1,single");
  });

  it("accepts a signed-hook payload shape and strips +86 for Aliyun", () => {
    expect(parseSmsHookPayload({
      user: { phone: "+8613800138000" },
      sms: { otp: "123456" },
    })).toEqual({
      phone: "+8613800138000",
      domesticPhone: "13800138000",
      otp: "123456",
      maskedPhone: "138****8000",
    });
  });

  it("prefers the delivery phone in SMS metadata for new users", () => {
    expect(parseSmsHookPayload({
      user: { phone: "" },
      sms: { phone: "8618600201337", otp: "654321" },
    })).toEqual({
      phone: "+8618600201337",
      domesticPhone: "18600201337",
      otp: "654321",
      maskedPhone: "186****1337",
    });
  });

  it("normalizes a domestic mainland phone from SMS metadata", () => {
    expect(parseSmsHookPayload({
      sms: { phone: "186 0020 1337", otp: "654321" },
    }).phone).toBe("+8618600201337");
  });

  it("rejects unsupported phones and invalid OTP values", () => {
    expect(() => parseSmsHookPayload({
      user: { phone: "+14155552671" },
      sms: { otp: "123456" },
    })).toThrow("invalid_phone");
    expect(() => parseSmsHookPayload({
      user: { phone: "+8613800138000" },
      sms: { otp: "12345a" },
    })).toThrow("invalid_otp");
  });

  it("maps provider failures without returning provider messages", () => {
    expect(aliyunErrorStatus("isv.BUSINESS_LIMIT_CONTROL")).toBe(429);
    expect(aliyunErrorStatus("SignatureDoesNotMatch")).toBe(500);
    expect(aliyunErrorStatus("ServiceUnavailable")).toBe(503);
  });
});
