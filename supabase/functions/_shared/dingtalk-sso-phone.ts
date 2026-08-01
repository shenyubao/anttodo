export type AuthErrorLike = {
  code?: string;
  message?: string;
};

export function normalizeMainlandMobile(mobile: string | undefined, stateCode?: string) {
  if (!mobile) return null;
  const digits = mobile.replace(/\D/g, "");
  const stateCodeDigits = (stateCode?.replace(/\D/g, "") ?? "").replace(/^00/, "");
  if (
    (!stateCodeDigits || stateCodeDigits === "86") &&
    digits.length === 11 &&
    digits.startsWith("1")
  ) {
    return `+86${digits}`;
  }
  if (digits.startsWith("86") && digits.length === 13) return `+${digits}`;
  if (digits.startsWith("0086") && digits.length === 15) return `+${digits.slice(2)}`;
  if (mobile.startsWith("+") && digits.length >= 8) return `+${digits}`;
  return null;
}

export function isPhoneAlreadyRegisteredError(error: AuthErrorLike | null | undefined) {
  if (!error) return false;
  if (error.code === "phone_exists") return true;
  const normalized = error.message?.toLowerCase() ?? "";
  return normalized.includes("phone") &&
    (normalized.includes("already") || normalized.includes("registered"));
}
