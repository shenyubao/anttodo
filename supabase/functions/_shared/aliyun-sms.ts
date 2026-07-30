const ALGORITHM = "ACS3-HMAC-SHA256";
const SIGNED_HEADERS = [
  "host",
  "x-acs-action",
  "x-acs-content-sha256",
  "x-acs-date",
  "x-acs-signature-nonce",
  "x-acs-version",
].join(";");
const encoder = new TextEncoder();

function toHex(value: ArrayBuffer) {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(value: string) {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function hmacSha256(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function percentEncode(value: string) {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );
}

export type AliyunSmsRequest = {
  accessKeyId: string;
  accessKeySecret: string;
  endpoint: string;
  region: string;
  phone: string;
  signName: string;
  templateCode: string;
  otp: string;
  outId: string;
  now?: Date;
  nonce?: string;
};

export async function buildAliyunSmsRequest(input: AliyunSmsRequest) {
  const host = input.endpoint
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const parameters = {
    OutId: input.outId,
    PhoneNumbers: input.phone,
    RegionId: input.region,
    SignName: input.signName,
    TemplateCode: input.templateCode,
    TemplateParam: JSON.stringify({ code: input.otp }),
  };
  const canonicalQuery = Object.entries(parameters)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${percentEncode(key)}=${percentEncode(value)}`)
    .join("&");
  const payloadHash = await sha256("");
  const date = (input.now ?? new Date())
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  const nonce = input.nonce ?? crypto.randomUUID();
  const signedHeaderValues: Record<string, string> = {
    host,
    "x-acs-action": "SendSms",
    "x-acs-content-sha256": payloadHash,
    "x-acs-date": date,
    "x-acs-signature-nonce": nonce,
    "x-acs-version": "2017-05-25",
  };
  const canonicalHeaders = SIGNED_HEADERS
    .split(";")
    .map((name) => `${name}:${signedHeaderValues[name]}`)
    .join("\n");
  const canonicalRequest = [
    "POST",
    "/",
    canonicalQuery,
    canonicalHeaders,
    "",
    SIGNED_HEADERS,
    payloadHash,
  ].join("\n");
  const stringToSign = `${ALGORITHM}\n${await sha256(canonicalRequest)}`;
  const signature = await hmacSha256(input.accessKeySecret, stringToSign);
  const headers: Record<string, string> = {
    ...signedHeaderValues,
    Authorization:
      `${ALGORITHM} Credential=${input.accessKeyId},` +
      `SignedHeaders=${SIGNED_HEADERS},Signature=${signature}`,
  };

  return {
    url: `https://${host}/?${canonicalQuery}`,
    headers,
  };
}
