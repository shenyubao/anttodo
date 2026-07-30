const MAINLAND_PHONE_PATTERN = /^1[3-9]\d{9}$/;
const OTP_PATTERN = /^\d{6}$/;

export function normalizeMainlandPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return MAINLAND_PHONE_PATTERN.test(digits) ? `+86${digits}` : null;
}

export function isValidSmsOtp(value: string) {
  return OTP_PATTERN.test(value);
}

export function maskPhone(value: string | null | undefined) {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  const mainland = digits.startsWith("86") && digits.length === 13
    ? digits.slice(2)
    : digits;
  if (!MAINLAND_PHONE_PATTERN.test(mainland)) return value;
  return `${mainland.slice(0, 3)}****${mainland.slice(-4)}`;
}

export function phoneAuthErrorMessage(
  message: string,
  context: "send" | "verify",
) {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("rate limit") ||
    normalized.includes("sms_send_rate_limit") ||
    normalized.includes("over frequency")
  ) {
    return "请求过于频繁，请稍后再试。";
  }
  if (
    normalized.includes("invalid") &&
    (normalized.includes("otp") || normalized.includes("token"))
  ) {
    return "验证码不正确，请检查后重试。";
  }
  if (normalized.includes("expired")) {
    return "验证码已过期，请重新获取。";
  }
  return context === "send"
    ? "验证码发送失败，请稍后重试。"
    : "登录失败，请检查验证码后重试。";
}
