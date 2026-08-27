import { isAbsolute, normalize } from "node:path";
import { hostname } from "node:os";
import open from "open";
import QRCode from "qrcode";
import { createClientContext, exchangeCliAccessToken, invokeDeviceAuthorization } from "./client.js";
import { hashDeviceCode, newDeviceCode } from "./crypto.js";
import { CliError } from "./errors.js";
import {
  clearAuthStorage,
  clearCache,
  clearPendingAuthorizations,
  clearWorkspaceSettings,
  loadPendingAuthorization,
  readCliCredential,
  removePendingAuthorization,
  saveCliCredential,
  savePendingAuthorization,
} from "./storage.js";
import type { CliCredential, PendingAuthorization } from "./types.js";
import { getCliVersion } from "./version.js";

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function jwtUser(accessToken: string) {
  try {
    const part = accessToken.split(".")[1];
    const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof claims.sub !== "string") throw new Error();
    return {
      id: claims.sub,
      email: typeof claims.email === "string" && claims.email ? claims.email : null,
      phone: typeof claims.phone === "string" && claims.phone ? claims.phone : null,
    };
  } catch {
    throw new CliError({ type: "authentication", code: "invalid_access_token", message: "The service returned an invalid access token" });
  }
}

export async function startLogin(options: { noWait?: boolean; noOpen?: boolean }) {
  const { config } = await createClientContext();
  if (config.cliAuthProtocol !== 2) {
    throw new CliError({ type: "configuration", code: "cli_auth_protocol_unsupported", message: "This service does not support CLI authentication protocol v2" });
  }
  const deviceCode = newDeviceCode();
  const payload = await invokeDeviceAuthorization(config, {
    action: "init",
    protocolVersion: 2,
    deviceCodeHash: hashDeviceCode(deviceCode),
    client: { name: "AntTodo CLI", version: getCliVersion(), hostname: hostname() || null },
  });
  const pending: PendingAuthorization = {
    requestId: String(payload.requestId), deviceCode,
    verificationUrl: String(payload.verificationUrl), expiresAt: String(payload.expiresAt),
    interval: Number(payload.interval ?? 5), serviceKey: config.serviceKey, config,
  };
  await savePendingAuthorization(pending);
  if (!options.noOpen) await open(pending.verificationUrl, { wait: false }).catch(() => undefined);
  if (!options.noWait) {
    process.stderr.write(`Open this URL to authorize AntTodo CLI:\n${pending.verificationUrl}\n\n`);
    if (process.stderr.isTTY) process.stderr.write(await QRCode.toString(pending.verificationUrl, { type: "terminal", small: true }));
  }
  if (options.noWait) return { verification_url: pending.verificationUrl, device_code: pending.deviceCode, expires_at: pending.expiresAt, interval: pending.interval };
  return completeLogin(deviceCode);
}

export async function completeLogin(deviceCode: string) {
  const pending = await loadPendingAuthorization(deviceCode);
  if (!pending?.config || !pending.serviceKey) {
    throw new CliError({ type: "authentication", code: "device_code_not_found", message: "No pending authorization matches this device code", hint: "Start a new login with `anttodo auth login --no-wait`" });
  }
  try {
    while (Date.now() < Date.parse(pending.expiresAt)) {
      const result = await invokeDeviceAuthorization(pending.config, { action: "poll", requestId: pending.requestId, deviceCode });
      const status = String(result.status);
      if (status === "pending" || status === "authorizing" || status === "slow_down") {
        await sleep(Math.max(1, Number(result.retryAfter ?? pending.interval)) * 1000);
        continue;
      }
      if (status === "expired") throw new CliError({ type: "authentication", code: "device_code_expired", message: "Device authorization expired" });
      if (status === "denied") throw new CliError({ type: "authorization", code: "authorization_denied", message: "Authorization was denied" });
      if (status !== "approved" || typeof result.userId !== "string") {
        throw new CliError({ type: "api", code: "invalid_device_response", message: "Invalid device authorization response" });
      }
      const credentialValue = `atc_v2_${pending.requestId}.${deviceCode}`;
      const exchanged = await exchangeCliAccessToken(pending.config, credentialValue);
      const user = jwtUser(exchanged.accessToken);
      if (user.id !== result.userId) throw new CliError({ type: "authentication", code: "credential_user_mismatch", message: "Authorized user does not match the device credential" });
      const credential: CliCredential = {
        schemaVersion: 2, deviceId: pending.requestId, secret: deviceCode, user,
        credentialExpiresAt: typeof exchanged.credentialExpiresAt === "string" ? exchanged.credentialExpiresAt : null,
        accessToken: exchanged.accessToken, accessTokenExpiresAt: exchanged.expiresAt,
      };
      await saveCliCredential(credential, pending.serviceKey);
      await invokeDeviceAuthorization(pending.config, { action: "consume", requestId: pending.requestId, deviceCode });
      await removePendingAuthorization(deviceCode, pending.serviceKey);
      return { logged_in: true, user, credential_expires_at: credential.credentialExpiresAt };
    }
    throw new CliError({ type: "authentication", code: "device_code_expired", message: "Device authorization expired" });
  } catch (error) {
    if (Date.now() >= Date.parse(pending.expiresAt)) await removePendingAuthorization(deviceCode, pending.serviceKey);
    throw error;
  }
}

export async function authStatus(verify: boolean) {
  const { config } = await createClientContext();
  const stored = await readCliCredential(config.serviceKey);
  if (stored.legacy) return { logged_in: false, verified: false, code: "legacy_auth_reauthorization_required", hint: "Run `anttodo auth login` to authorize this CLI again" };
  const credential = stored.credential;
  if (!credential) return { logged_in: false, verified: false };
  const expired = credential.credentialExpiresAt !== null && Date.parse(credential.credentialExpiresAt) <= Date.now();
  if (!verify) return { logged_in: !expired, verified: null, user: credential.user, device_id: credential.deviceId, credential_expires_at: credential.credentialExpiresAt };
  if (expired) return { logged_in: false, verified: false, user: credential.user, code: "credential_expired" };
  try {
    await exchangeCliAccessToken(config, `atc_v2_${credential.deviceId}.${credential.secret}`);
    return { logged_in: true, verified: true, user: credential.user, device_id: credential.deviceId, credential_expires_at: credential.credentialExpiresAt };
  } catch (error) {
    return { logged_in: false, verified: false, user: credential.user, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function logout() {
  let revokeError: unknown;
  let serviceKey: string | undefined;
  try {
    const { config } = await createClientContext();
    serviceKey = config.serviceKey;
    const stored = await readCliCredential(serviceKey);
    if (stored.credential) {
      await invokeDeviceAuthorization(config, { action: "revoke" }, `atc_v2_${stored.credential.deviceId}.${stored.credential.secret}`);
    }
  } catch (error) { revokeError = error; }
  finally {
    await clearAuthStorage(serviceKey); await clearWorkspaceSettings(serviceKey);
    await clearPendingAuthorizations(serviceKey); await clearCache(serviceKey);
  }
  if (revokeError) throw revokeError;
  return { logged_out: true };
}

export async function renderQrCode(url: string, options: { ascii?: boolean; output?: string }) {
  new URL(url);
  if (options.ascii || !options.output) return { ascii: await QRCode.toString(url, { type: "terminal", small: true }) };
  if (isAbsolute(options.output) || normalize(options.output).startsWith("..")) {
    throw new CliError({ type: "validation", code: "unsafe_output_path", message: "QR output must be a relative path inside the current directory" });
  }
  await QRCode.toFile(options.output, url, { type: "png", width: 256 });
  return { output: options.output };
}
