import { isAbsolute, normalize } from "node:path";
import { hostname } from "node:os";
import open from "open";
import QRCode from "qrcode";
import { createClientContext, invokeDeviceAuthorization } from "./client.js";
import { decryptSession, generateDeviceKeyPair, hashDeviceCode, newDeviceCode } from "./crypto.js";
import { CliError } from "./errors.js";
import {
  clearAuthStorage,
  clearCache,
  clearPendingAuthorizations,
  clearWorkspaceSettings,
  loadPendingAuthorization,
  removePendingAuthorization,
  savePendingAuthorization,
} from "./storage.js";
import type { DeviceCiphertext, PendingAuthorization } from "./types.js";
import { getCliVersion } from "./version.js";

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function startLogin(options: { noWait?: boolean; noOpen?: boolean }) {
  const { config } = await createClientContext();
  const pair = generateDeviceKeyPair();
  const deviceCode = newDeviceCode();
  const payload = await invokeDeviceAuthorization(config, {
    action: "init",
    deviceCodeHash: hashDeviceCode(deviceCode),
    publicKey: pair.publicKey,
    client: {
      name: "AntTodo CLI",
      version: getCliVersion(),
      hostname: hostname() || null,
    },
  });
  const pending: PendingAuthorization = {
    requestId: String(payload.requestId),
    deviceCode,
    privateKey: pair.privateKey,
    verificationUrl: String(payload.verificationUrl),
    expiresAt: String(payload.expiresAt),
    interval: Number(payload.interval ?? 5),
    serviceKey: config.serviceKey,
    config,
  };
  await savePendingAuthorization(pending);
  if (!options.noOpen) await open(pending.verificationUrl, { wait: false }).catch(() => undefined);
  if (!options.noWait) {
    process.stderr.write(`Open this URL to authorize AntTodo CLI:\n${pending.verificationUrl}\n\n`);
    if (process.stderr.isTTY) {
      process.stderr.write(await QRCode.toString(pending.verificationUrl, { type: "terminal", small: true }));
    }
  }
  if (options.noWait) {
    return {
      verification_url: pending.verificationUrl,
      device_code: pending.deviceCode,
      expires_at: pending.expiresAt,
      interval: pending.interval,
    };
  }
  return completeLogin(deviceCode);
}

export async function completeLogin(deviceCode: string) {
  const pending = await loadPendingAuthorization(deviceCode);
  if (!pending || !pending.config || !pending.serviceKey) {
    throw new CliError({
      type: "authentication",
      code: "device_code_not_found",
      message: "No pending authorization matches this device code",
      hint: "Start a new login with `anttodo auth login --no-wait`",
    });
  }
  const { client, config } = await createClientContext({ config: pending.config });
  try {
    while (Date.now() < Date.parse(pending.expiresAt)) {
      const result = await invokeDeviceAuthorization(config, {
        action: "poll",
        requestId: pending.requestId,
        deviceCode,
      });
      const status = String(result.status);
      if (status === "pending" || status === "slow_down") {
        await sleep(Math.max(1, Number(result.retryAfter ?? pending.interval)) * 1000);
        continue;
      }
      if (status === "expired") {
        await removePendingAuthorization(deviceCode, pending.serviceKey);
        throw new CliError({ type: "authentication", code: "device_code_expired", message: "Device authorization expired" });
      }
      if (status === "denied") {
        await removePendingAuthorization(deviceCode, pending.serviceKey);
        throw new CliError({ type: "authorization", code: "authorization_denied", message: "Authorization was denied" });
      }
      if (status !== "approved" || !result.encryptedSession || !result.authorizedUserId) {
        throw new CliError({ type: "api", code: "invalid_device_response", message: "Invalid device authorization response" });
      }
      const session = decryptSession(
        pending.privateKey,
        result.encryptedSession as DeviceCiphertext,
        pending.requestId,
        String(result.authorizedUserId),
      );
      if (session.userId !== result.authorizedUserId) {
        await removePendingAuthorization(deviceCode, pending.serviceKey);
        throw new CliError({ type: "authentication", code: "session_user_mismatch", message: "Authorized user does not match the encrypted session" });
      }
      const { data, error } = await client.auth.setSession({
        access_token: session.accessToken,
        refresh_token: session.refreshToken,
      });
      if (error || !data.session) {
        throw new CliError({ type: "authentication", code: "session_rejected", message: error?.message ?? "Session was rejected" });
      }
      const verified = await client.auth.getUser();
      if (verified.error || verified.data.user?.id !== session.userId) {
        await clearAuthStorage(pending.serviceKey);
        throw new CliError({ type: "authentication", code: "session_verification_failed", message: "Unable to verify the authorized session" });
      }
      await invokeDeviceAuthorization(config, {
        action: "consume",
        requestId: pending.requestId,
        deviceCode,
      });
      await removePendingAuthorization(deviceCode, pending.serviceKey);
      return {
        logged_in: true,
        user: {
          id: verified.data.user.id,
          email: verified.data.user.email ?? null,
          phone: verified.data.user.phone ?? null,
        },
      };
    }
    throw new CliError({ type: "authentication", code: "device_code_expired", message: "Device authorization expired" });
  } catch (error) {
    if (Date.now() >= Date.parse(pending.expiresAt)) await removePendingAuthorization(deviceCode, pending.serviceKey);
    throw error;
  }
}

export async function authStatus(verify: boolean) {
  const { client } = await createClientContext();
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) return { logged_in: false, verified: false };
  if (!verify) {
    return {
      logged_in: true,
      verified: null,
      user: { id: data.session.user.id, email: data.session.user.email ?? null, phone: data.session.user.phone ?? null },
      expires_at: data.session.expires_at ?? null,
    };
  }
  const checked = await client.auth.getUser();
  return {
    logged_in: !checked.error && Boolean(checked.data.user),
    verified: !checked.error && Boolean(checked.data.user),
    user: checked.data.user
      ? { id: checked.data.user.id, email: checked.data.user.email ?? null, phone: checked.data.user.phone ?? null }
      : null,
    error: checked.error?.message ?? null,
  };
}

export async function logout() {
  let signOutError: unknown;
  let serviceKey: string | undefined;
  try {
    const { client, config } = await createClientContext();
    serviceKey = config.serviceKey;
    const { error } = await client.auth.signOut({ scope: "local" });
    signOutError = error;
  } catch (error) {
    signOutError = error;
  } finally {
    await clearAuthStorage(serviceKey);
    await clearWorkspaceSettings(serviceKey);
    await clearPendingAuthorizations(serviceKey);
    await clearCache(serviceKey);
  }
  if (signOutError) throw signOutError;
  return { logged_out: true };
}

export async function renderQrCode(url: string, options: { ascii?: boolean; output?: string }) {
  new URL(url);
  if (options.ascii || !options.output) {
    return { ascii: await QRCode.toString(url, { type: "terminal", small: true }) };
  }
  if (isAbsolute(options.output) || normalize(options.output).startsWith("..")) {
    throw new CliError({ type: "validation", code: "unsafe_output_path", message: "QR output must be a relative path inside the current directory" });
  }
  await QRCode.toFile(options.output, url, { type: "png", width: 256 });
  return { output: options.output };
}
