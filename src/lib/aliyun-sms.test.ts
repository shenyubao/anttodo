import { describe, expect, it } from "vitest";
import {
  buildAliyunSmsRequest,
  resolveAliyunSmsRelayUrl,
} from "../../supabase/functions/_shared/aliyun-sms";

describe("Aliyun SMS relay URL", () => {
  it("accepts https relay URLs and rejects insecure ones", () => {
    expect(resolveAliyunSmsRelayUrl("https://fc.example.com/sms/")).toBe(
      "https://fc.example.com/sms",
    );
    expect(resolveAliyunSmsRelayUrl("http://fc.example.com/sms")).toBeNull();
    expect(resolveAliyunSmsRelayUrl("")).toBeNull();
    expect(resolveAliyunSmsRelayUrl(undefined)).toBeNull();
  });
});

describe("Aliyun SendSms V3 request signing", () => {
  it("builds a deterministic signed request without exposing the secret", async () => {
    const request = await buildAliyunSmsRequest({
      accessKeyId: "test-access-key",
      accessKeySecret: "test-secret-key",
      endpoint: "dysmsapi.aliyuncs.com",
      region: "cn-hangzhou",
      phone: "13800138000",
      signName: "AntTodo",
      templateCode: "SMS_123456",
      otp: "654321",
      outId: "webhook-1",
      now: new Date("2026-07-27T10:00:00.000Z"),
      nonce: "nonce-1",
    });

    expect(request.url).toContain("PhoneNumbers=13800138000");
    expect(request.url).toContain("TemplateParam=%7B%22code%22%3A%22654321%22%7D");
    expect(request.url).not.toContain("test-secret-key");
    expect(request.headers["x-acs-action"]).toBe("SendSms");
    expect(request.headers["x-acs-date"]).toBe("2026-07-27T10:00:00Z");
    expect(request.headers.Authorization).toMatch(
      /^ACS3-HMAC-SHA256 Credential=test-access-key,SignedHeaders=.*Signature=[a-f0-9]{64}$/,
    );
    expect(request.headers.Authorization).not.toContain("test-secret-key");
  });
});
