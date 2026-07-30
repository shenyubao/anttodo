import "@supabase/functions-js/edge-runtime.d.ts";
import { Webhook } from "standardwebhooks";
import { buildAliyunSmsRequest } from "../_shared/aliyun-sms.ts";
import {
  aliyunErrorStatus,
  normalizeWebhookSignature,
  parseSmsHookPayload,
} from "../_shared/sms-hook.ts";

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`missing_${name}`);
  return value;
}

function jsonError(message: string, status: number, retry = false) {
  return Response.json(
    { error: message },
    {
      status,
      headers: retry ? { "retry-after": "2" } : undefined,
    },
  );
}

function verifyPayload(payload: string, headers: Headers, configuredSecrets: string) {
  const webhookHeaders = Object.fromEntries(headers.entries());
  webhookHeaders["webhook-signature"] = normalizeWebhookSignature(
    headers.get("webhook-signature"),
  );
  for (const configuredSecret of configuredSecrets.split("|")) {
    const secret = configuredSecret.trim().replace(/^v1,whsec_/, "");
    if (!secret) continue;
    try {
      return new Webhook(secret).verify(payload, webhookHeaders);
    } catch {
      // Try the next key during webhook-secret rotation.
    }
  }
  throw new Error("invalid_webhook_signature");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonError("Method not allowed", 405);

  const webhookId = req.headers.get("webhook-id") ?? "unknown";
  try {
    const rawPayload = await req.text();
    const verifiedPayload = verifyPayload(
      rawPayload,
      req.headers,
      requiredEnv("SEND_SMS_HOOK_SECRETS"),
    );
    const sms = parseSmsHookPayload(verifiedPayload);

    const request = await buildAliyunSmsRequest({
      accessKeyId: requiredEnv("ALIYUN_APIKEY"),
      accessKeySecret: requiredEnv("ALIYUN_SECRETKEY"),
      endpoint: requiredEnv("ALIYUN_SMS_ENDPOINT"),
      region: requiredEnv("ALIYUN_REGION"),
      phone: sms.domesticPhone,
      signName: requiredEnv("ALIYUN_SMS_SIGN_NAME"),
      templateCode: requiredEnv("ALIYUN_SMS_TEMPLATE_CODE"),
      otp: sms.otp,
      outId: webhookId,
    });
    const providerResponse = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      signal: AbortSignal.timeout(4_000),
    });
    const response = await providerResponse.json() as {
      Code?: string;
      code?: string;
      RequestId?: string;
      requestId?: string;
    };
    const code = response.Code ?? response.code;

    if (!providerResponse.ok || code !== "OK") {
      const status = aliyunErrorStatus(code);
      console.error("Aliyun SMS rejected request", {
        webhookId,
        phone: sms.maskedPhone,
        code: code ?? "unknown",
      });
      return jsonError(
        status === 429 ? "SMS rate limited" : "SMS provider unavailable",
        status,
        status === 429 || status === 503,
      );
    }

    console.info("Aliyun SMS accepted request", {
      webhookId,
      phone: sms.maskedPhone,
      requestId: response.RequestId ?? response.requestId ?? "unknown",
    });
    return Response.json({});
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown_error";
    const invalidSignature = code === "invalid_webhook_signature";
    const invalidPayload = code === "invalid_phone" || code === "invalid_otp";
    console.error("Send SMS hook failed", {
      webhookId,
      category: invalidSignature || invalidPayload ? code : "internal_error",
    });
    return jsonError(
      invalidSignature || invalidPayload
        ? "Invalid hook request"
        : "SMS provider unavailable",
      invalidSignature ? 401 : invalidPayload ? 422 : 503,
      !invalidSignature && !invalidPayload,
    );
  }
});
