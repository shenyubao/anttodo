import {
  extractYunxiaoMarkdownImages,
  getWorkitemFile,
  listWorkitemAttachments,
  yunxiaoFileIdentifier,
  yunxiaoTemporaryFileUrl,
  type YunxiaoAttachment,
} from "./yunxiao.ts";

function fileExtension(contentType: string | null, source: string) {
  const fromType: Record<string, string> = {
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  if (contentType && fromType[contentType.split(";")[0].toLowerCase()]) {
    return fromType[contentType.split(";")[0].toLowerCase()];
  }
  const match = source.match(/\.(gif|jpe?g|png|webp)(?:[?#]|$)/i);
  return match?.[1].toLowerCase().replace("jpeg", "jpg") ?? "png";
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

function blobFromDataImage(source: string) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(source);
  if (!match) return null;
  const contentType = match[1].toLowerCase();
  const bytes = Uint8Array.from(
    atob(match[2].replace(/\s+/g, "")),
    (char) => char.charCodeAt(0),
  );
  return { blob: new Blob([bytes], { type: contentType }), contentType };
}

function parseStoredAttachmentPath(uri: string) {
  const match = /^anttodo-storage:\/\/task-attachments\/([0-9a-f-]+)\/([0-9a-f-]+)\/([^/\s]+)$/i
    .exec(uri.trim());
  if (!match) return null;
  return {
    workspaceId: match[1],
    taskId: match[2],
    name: match[3],
    path: `${match[1]}/${match[2]}/${match[3]}`,
  };
}

function isImageContentType(contentType: string | null) {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return !type || type.startsWith("image/") || type === "application/octet-stream";
}

async function downloadRemoteImage(url: string, token: string, hops = 0) {
  if (hops > 2) return null;
  let response = await fetch(url, { headers: { "x-yunxiao-token": token }, redirect: "follow" });
  if (!response.ok) response = await fetch(url, { redirect: "follow" });
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type");
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (type === "application/json" || type.endsWith("+json")) {
    const nextUrl = yunxiaoTemporaryFileUrl(await response.json().catch(() => null));
    if (!nextUrl || nextUrl === url) return null;
    return downloadRemoteImage(nextUrl, token, hops + 1);
  }
  if (!isImageContentType(contentType)) return null;
  return { blob: await response.blob(), contentType };
}

function matchWorkitemAttachment(
  attachments: YunxiaoAttachment[],
  source: string,
): YunxiaoAttachment | null {
  const fileId = yunxiaoFileIdentifier(source);
  return attachments.find((item) =>
    source === item.url ||
    (fileId && (item.fileId === fileId || item.id === fileId)) ||
    [item.id, item.fileId, item.fileName]
      .some((identifier) => identifier && source.includes(identifier))
  ) ?? (fileId
    ? { id: fileId, fileId, fileName: "", suffix: "", url: "" }
    : null);
}

export async function mirrorYunxiaoDescriptionImages(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  markdown: string,
  workspaceId: string,
  taskId: string,
  organizationId: string,
  workitemId: string,
  token: string,
) {
  const matches = extractYunxiaoMarkdownImages(markdown);
  const attachments = matches.length
    ? await listWorkitemAttachments(organizationId, workitemId, token).catch(() => [])
    : [];
  let result = markdown;
  for (const match of matches) {
    const source = match.source;
    try {
      const stored = parseStoredAttachmentPath(source);
      if (stored) {
        if (stored.taskId === taskId) continue;
        const nextPath = `${stored.workspaceId}/${taskId}/${stored.name}`;
        await supabaseAdmin.storage.from("task-attachments")
          .copy(stored.path, nextPath)
          .catch(() => undefined);
        result = result.replaceAll(
          source,
          `anttodo-storage://task-attachments/${nextPath}`,
        );
        continue;
      }
      const attachment = matchWorkitemAttachment(attachments, source);
      const dataImage = blobFromDataImage(source);
      let blob: Blob | null = dataImage?.blob ?? null;
      let contentType: string | null = dataImage?.contentType ?? null;
      if (!blob) {
        const fileId = attachment?.fileId || yunxiaoFileIdentifier(source);
        const refreshed = fileId
          ? await getWorkitemFile(organizationId, workitemId, fileId, token)
            .catch(() => attachment)
          : attachment;
        const downloadUrl = refreshed?.url || (/^https?:\/\//i.test(source) ? source : "");
        if (!downloadUrl) {
          const original = markdown.slice(match.start, match.end);
          result = result.replace(original, match.alt ? `_${match.alt}_` : "");
          continue;
        }
        const downloaded = await downloadRemoteImage(downloadUrl, token);
        if (!downloaded) continue;
        blob = downloaded.blob;
        contentType = downloaded.contentType;
      }
      const extension = fileExtension(contentType, attachment?.suffix || source);
      const name = `${await deterministicUuid(`${workitemId}:${attachment?.fileId ?? source}`)}.${extension}`;
      const path = `${workspaceId}/${taskId}/${name}`;
      const { error } = await supabaseAdmin.storage.from("task-attachments")
        .upload(path, blob, {
          contentType: contentType ?? `image/${extension}`,
          upsert: true,
        });
      if (error) throw new Error(error.message);
      result = result.replaceAll(
        match.originalSource,
        `anttodo-storage://task-attachments/${path}`,
      );
    } catch {
      // Keep a safe HTTPS source if copying a remote image temporarily fails.
    }
  }
  return result;
}
