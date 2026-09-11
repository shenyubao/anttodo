function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function dingtalkGroupRobotSignature(
  timestamp: string,
  appSecret: string,
) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}\n${appSecret}`),
  );
  return bytesToBase64(new Uint8Array(signature));
}

function normalizeSignature(value: string) {
  try {
    return decodeURIComponent(value).replace(/ /g, "+");
  } catch {
    return value.replace(/ /g, "+");
  }
}

export async function verifyDingtalkGroupRobotSignature(input: {
  timestamp: string;
  signature: string;
  appSecret: string;
  now?: number;
  maxAgeMs?: number;
}) {
  const timestampNumber = Number(input.timestamp);
  if (!Number.isFinite(timestampNumber)) return false;
  if (Math.abs((input.now ?? Date.now()) - timestampNumber) > (input.maxAgeMs ?? 60 * 60_000)) {
    return false;
  }
  const expected = await dingtalkGroupRobotSignature(
    input.timestamp,
    input.appSecret,
  );
  const actual = normalizeSignature(input.signature);
  if (expected.length !== actual.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return difference === 0;
}
