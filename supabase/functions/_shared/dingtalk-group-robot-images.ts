import type { DingtalkGroupRobotImageReference } from "./dingtalk-group-robot.ts";

export const DINGTALK_GROUP_ROBOT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export type DingtalkGroupRobotStoredImage = {
  path: string;
  uri: string;
};

export function detectDingtalkGroupRobotImageType(bytes: Uint8Array) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return { contentType: "image/png", extension: "png" } as const;
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: "image/jpeg", extension: "jpg" } as const;
  }
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.slice(start, end));
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(ascii(0, 6))) {
    return { contentType: "image/gif", extension: "gif" } as const;
  }
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return { contentType: "image/webp", extension: "webp" } as const;
  }
  return null;
}

function allowedTemporaryDownloadUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 8_192) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      (url.port && url.port !== "443") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export async function downloadDingtalkGroupRobotImage(input: {
  accessToken: string;
  downloadCode: string;
  robotCode: string;
}) {
  const metadataResponse = await fetch(
    "https://api.dingtalk.com/v1.0/robot/messageFiles/download",
    {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        "x-acs-dingtalk-access-token": input.accessToken,
      },
      body: JSON.stringify({
        downloadCode: input.downloadCode,
        robotCode: input.robotCode,
      }),
    },
  );
  const metadata = await metadataResponse.json().catch(() => ({})) as {
    downloadUrl?: unknown;
  };
  const downloadUrl = allowedTemporaryDownloadUrl(metadata.downloadUrl);
  if (!metadataResponse.ok || !downloadUrl) {
    throw new Error(`DingTalk image URL lookup failed (${metadataResponse.status})`);
  }

  const imageResponse = await fetch(downloadUrl, { redirect: "error" });
  if (!imageResponse.ok) {
    throw new Error(`DingTalk image download failed (${imageResponse.status})`);
  }
  const declaredBytes = Number(imageResponse.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > DINGTALK_GROUP_ROBOT_MAX_IMAGE_BYTES) {
    throw new Error("DingTalk image exceeds the 20MB attachment limit");
  }
  const buffer = await imageResponse.arrayBuffer();
  if (buffer.byteLength > DINGTALK_GROUP_ROBOT_MAX_IMAGE_BYTES) {
    throw new Error("DingTalk image exceeds the 20MB attachment limit");
  }
  const type = detectDingtalkGroupRobotImageType(new Uint8Array(buffer));
  if (!type) throw new Error("Unsupported DingTalk image type");
  return {
    blob: new Blob([buffer], { type: type.contentType }),
    ...type,
  };
}

async function deterministicUuid(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((item) => item.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function storeDingtalkGroupRobotImages(input: {
  accessToken: string;
  images: DingtalkGroupRobotImageReference[];
  messageId: string;
  robotCode: string;
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any;
  taskId: string;
  workspaceId: string;
}) {
  const stored: DingtalkGroupRobotStoredImage[] = [];
  let failedCount = 0;
  for (const [index, image] of input.images.entries()) {
    try {
      const downloaded = await downloadDingtalkGroupRobotImage({
        accessToken: input.accessToken,
        downloadCode: image.downloadCode,
        robotCode: input.robotCode,
      });
      const objectId = await deterministicUuid(
        `${input.messageId}:${index}:${image.downloadCode}`,
      );
      const path = `${input.workspaceId}/${input.taskId}/${objectId}.${downloaded.extension}`;
      const { error } = await input.supabaseAdmin.storage.from("task-attachments")
        .upload(path, downloaded.blob, {
          cacheControl: "31536000",
          contentType: downloaded.contentType,
          upsert: true,
        });
      if (error) throw new Error(error.message);
      stored.push({
        path,
        uri: `anttodo-storage://task-attachments/${path}`,
      });
    } catch (cause) {
      failedCount += 1;
      console.error(
        `DingTalk rich-text image ${index + 1} could not be stored`,
        cause instanceof Error ? cause.message : "Unknown error",
      );
    }
  }
  return { failedCount, stored };
}

export function buildDingtalkGroupRobotImageDescription(
  images: DingtalkGroupRobotStoredImage[],
) {
  return images
    .map((image, index) => `![钉钉图片 ${index + 1}](${image.uri})`)
    .join("\n\n");
}
