export type SmsHookPayload = {
  user?: { phone?: unknown };
  sms?: { otp?: unknown; phone?: unknown };
};

export function normalizeWebhookSignature(value: string | null) {
  return value?.replace(/,\s+(?=v1,)/g, " ") ?? "";
}

export function parseSmsHookPayload(value: unknown) {
  const payload = value as SmsHookPayload;
  const rawPhone = payload?.sms?.phone ?? payload?.user?.phone;
  const otp = payload?.sms?.otp;
  if (typeof rawPhone !== "string") {
    throw new Error("invalid_phone");
  }
  const compactPhone = rawPhone.trim().replace(/[\s()-]/g, "");
  const domesticPhone = compactPhone.startsWith("+86")
    ? compactPhone.slice(3)
    : compactPhone.startsWith("86")
    ? compactPhone.slice(2)
    : compactPhone;
  if (!/^1[3-9]\d{9}$/.test(domesticPhone)) {
    throw new Error("invalid_phone");
  }
  if (typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
    throw new Error("invalid_otp");
  }
  const phone = `+86${domesticPhone}`;
  return {
    phone,
    domesticPhone,
    otp,
    maskedPhone: `${domesticPhone.slice(0, 3)}****${domesticPhone.slice(-4)}`,
  };
}

const RATE_LIMIT_CODES = new Set([
  "isv.BUSINESS_LIMIT_CONTROL",
  "isv.DAY_LIMIT_CONTROL",
  "Throttling",
  "Throttling.User",
]);

const PERMANENT_ERROR_CODES = new Set([
  "isv.INVALID_PARAMETERS",
  "isv.INVALID_TEMPLATE",
  "isv.SMS_SIGNATURE_ILLEGAL",
  "isv.SMS_TEMPLATE_ILLEGAL",
  "InvalidAccessKeyId.NotFound",
  "SignatureDoesNotMatch",
]);

export function aliyunErrorStatus(code: string | undefined) {
  if (code && RATE_LIMIT_CODES.has(code)) return 429;
  if (code && PERMANENT_ERROR_CODES.has(code)) return 500;
  return 503;
}
