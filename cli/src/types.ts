export type OutputFormat = "json" | "pretty" | "table" | "ndjson" | "csv";
export type TaskPriority = "none" | "low" | "medium" | "high";
export type TaskStatus = "open" | "completed" | "cancelled";
export type LabelAccessScope = "inherit" | "all" | "users" | "groups";
export type LabelKind = "private" | "team";

export type PublicConfig = {
  supabaseUrl: string;
  publishableKey: string;
  appUrl: string;
  deviceAuthorizationEndpoint: string;
};

export type PendingAuthorization = {
  requestId: string;
  deviceCode: string;
  privateKey: JsonWebKey;
  verificationUrl: string;
  expiresAt: string;
  interval: number;
};

export type DeviceCiphertext = {
  ephemeralPublicKey: JsonWebKey;
  salt: string;
  iv: string;
  ciphertext: string;
};

export type CliSessionPayload = {
  accessToken: string;
  refreshToken: string;
  userId: string;
};
