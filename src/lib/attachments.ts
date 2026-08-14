import type { SupabaseClient } from "@supabase/supabase-js";
import { del, get, set } from "idb-keyval";

export const TASK_ATTACHMENT_BUCKET = "task-attachments";
export const COMMENT_IMAGE_BUCKET = "comment-images";
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MIME_BY_EXTENSION: Record<string, string> = {
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  md: "text/markdown",
  pdf: "application/pdf",
  png: "image/png",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  webp: "image/webp",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
};

const ALLOWED_MIME_TYPES = new Set(Object.values(MIME_BY_EXTENSION));

export type AttachmentContext = {
  workspaceId: string;
  taskId: string;
};

export type CommentImageContext = AttachmentContext & {
  uploaderId: string;
};

export type UploadedAttachment = {
  contentType: string;
  fileName: string;
  image: boolean;
  path: string;
  uri: string;
};

export type AttachmentService = {
  dispose: () => void;
  open: (uri: string) => Promise<void>;
  remove: (uri: string) => Promise<void>;
  resolveImage: (uri: string) => Promise<string>;
  upload: (context: AttachmentContext, file: File) => Promise<UploadedAttachment>;
  uploadCommentImage: (
    context: CommentImageContext,
    file: File,
  ) => Promise<UploadedAttachment>;
};

type ParsedAttachmentUri = {
  bucket: string;
  path: string;
  taskId: string;
  uploaderId?: string;
  workspaceId: string;
};

function fileExtension(fileName: string) {
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  return match?.[1].toLowerCase() ?? "";
}

export function validateAttachment(file: File) {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("附件不能超过 20MB");
  }

  const extension = fileExtension(file.name);
  const inferredType = MIME_BY_EXTENSION[extension];
  const contentType = file.type || inferredType;

  if (!inferredType || !contentType || !ALLOWED_MIME_TYPES.has(contentType)) {
    throw new Error("不支持这种附件格式");
  }

  if (file.type && file.type !== inferredType) {
    const jpegAlias = file.type === "image/jpeg" && inferredType === "image/jpeg";
    const zipAlias =
      inferredType === "application/zip" &&
      ["application/x-zip-compressed", "application/octet-stream"].includes(file.type);
    if (!jpegAlias && !zipAlias) {
      throw new Error("附件扩展名与文件类型不匹配");
    }
  }

  return {
    contentType: inferredType,
    extension: extension === "jpeg" ? "jpg" : extension,
    image: inferredType.startsWith("image/"),
  };
}

export function validateCommentImage(file: File) {
  const metadata = validateAttachment(file);
  if (!metadata.image) throw new Error("评论只能上传图片");
  return metadata;
}

export function buildAttachmentPath(
  context: AttachmentContext,
  extension: string,
  id = crypto.randomUUID(),
) {
  if (!UUID_PATTERN.test(context.workspaceId) || !UUID_PATTERN.test(context.taskId)) {
    throw new Error("附件上下文无效");
  }
  if (!UUID_PATTERN.test(id) || !/^[a-z0-9]+$/i.test(extension)) {
    throw new Error("附件路径无效");
  }
  return `${context.workspaceId}/${context.taskId}/${id}.${extension.toLowerCase()}`;
}

export function buildAttachmentUri(path: string) {
  return `anttodo-storage://${TASK_ATTACHMENT_BUCKET}/${path}`;
}

export function buildCommentImagePath(
  context: CommentImageContext,
  extension: string,
  id = crypto.randomUUID(),
) {
  if (
    !UUID_PATTERN.test(context.workspaceId) ||
    !UUID_PATTERN.test(context.taskId) ||
    !UUID_PATTERN.test(context.uploaderId)
  ) {
    throw new Error("评论图片上下文无效");
  }
  if (!UUID_PATTERN.test(id) || !/^[a-z0-9]+$/i.test(extension)) {
    throw new Error("评论图片路径无效");
  }
  return `${context.workspaceId}/${context.taskId}/${context.uploaderId}/${id}.${extension.toLowerCase()}`;
}

export function buildCommentImageUri(path: string) {
  return `anttodo-storage://${COMMENT_IMAGE_BUCKET}/${path}`;
}

export function parseAttachmentUri(uri: string): ParsedAttachmentUri | null {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "anttodo-storage:") return null;
    if (![TASK_ATTACHMENT_BUCKET, COMMENT_IMAGE_BUCKET].includes(parsed.hostname)) return null;

    const parts = parsed.pathname.replace(/^\/+/, "").split("/");
    const isCommentImage = parsed.hostname === COMMENT_IMAGE_BUCKET;
    if (parts.length !== (isCommentImage ? 4 : 3)) return null;
    const [workspaceId, taskId] = parts;
    const uploaderId = isCommentImage ? parts[2] : undefined;
    const objectName = parts[isCommentImage ? 3 : 2];
    if (!UUID_PATTERN.test(workspaceId) || !UUID_PATTERN.test(taskId)) return null;
    if (uploaderId && !UUID_PATTERN.test(uploaderId)) return null;
    if (!/^[0-9a-f-]{36}\.[a-z0-9]+$/i.test(objectName)) return null;

    return {
      bucket: parsed.hostname,
      path: parts.join("/"),
      taskId,
      uploaderId,
      workspaceId,
    };
  } catch {
    return null;
  }
}

export function isSafeEditorUrl(uri: string) {
  if (parseAttachmentUri(uri)) return true;
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(uri).protocol);
  } catch {
    return false;
  }
}

export function escapeMarkdownLabel(value: string) {
  return value.replace(/([\\[\]])/g, "\\$1").replace(/\r?\n/g, " ");
}

export function attachmentMarkdown(attachment: UploadedAttachment) {
  const label = escapeMarkdownLabel(attachment.fileName);
  return attachment.image
    ? `![${label}](${attachment.uri})`
    : `[${label}](${attachment.uri})`;
}

export function createSupabaseAttachmentService(
  client: SupabaseClient,
): AttachmentService {
  const previewUrls = new Map<string, string>();
  const localPendingKey = (uri: string) => `anttodo:local-attachment:${uri}`;

  return {
    async upload(context, file) {
      const metadata = validateAttachment(file);
      const path = buildAttachmentPath(context, metadata.extension);
      const uri = buildAttachmentUri(path);
      if (!navigator.onLine) {
        await set(localPendingKey(uri), {
          blob: file,
          contentType: metadata.contentType,
          fileName: file.name,
          image: metadata.image,
          path,
          uri,
        });
        return {
          contentType: metadata.contentType,
          fileName: file.name,
          image: metadata.image,
          path,
          uri,
        };
      }
      const { error } = await client.storage
        .from(TASK_ATTACHMENT_BUCKET)
        .upload(path, file, {
          cacheControl: "3600",
          contentType: metadata.contentType,
          upsert: false,
        });
      if (error) throw new Error(error.message);

      return {
        contentType: metadata.contentType,
        fileName: file.name,
        image: metadata.image,
        path,
        uri: buildAttachmentUri(path),
      };
    },

    async uploadCommentImage(context, file) {
      const metadata = validateCommentImage(file);
      const path = buildCommentImagePath(context, metadata.extension);
      const uri = buildCommentImageUri(path);
      if (!navigator.onLine) {
        await set(localPendingKey(uri), {
          blob: file,
          contentType: metadata.contentType,
          fileName: file.name,
          image: true,
          path,
          uri,
        });
        return {
          contentType: metadata.contentType,
          fileName: file.name,
          image: true,
          path,
          uri,
        };
      }
      const { error } = await client.storage
        .from(COMMENT_IMAGE_BUCKET)
        .upload(path, file, {
          cacheControl: "3600",
          contentType: metadata.contentType,
          upsert: false,
        });
      if (error) throw new Error(error.message);
      return {
        contentType: metadata.contentType,
        fileName: file.name,
        image: true,
        path,
        uri: buildCommentImageUri(path),
      };
    },

    async resolveImage(uri) {
      const cached = previewUrls.get(uri);
      if (cached) return cached;
      const local = await get<{ blob: Blob }>(localPendingKey(uri));
      if (local?.blob) {
        const previewUrl = URL.createObjectURL(local.blob);
        previewUrls.set(uri, previewUrl);
        return previewUrl;
      }
      const parsed = parseAttachmentUri(uri);
      if (!parsed) return uri;

      const { data, error } = await client.storage
        .from(parsed.bucket)
        .download(parsed.path);
      if (error) throw new Error(error.message);
      const previewUrl = URL.createObjectURL(data);
      previewUrls.set(uri, previewUrl);
      return previewUrl;
    },

    async open(uri) {
      const local = await get<{ blob: Blob }>(localPendingKey(uri));
      if (local?.blob) {
        const objectUrl = URL.createObjectURL(local.blob);
        window.open(objectUrl, "_blank", "noopener,noreferrer");
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
        return;
      }
      const parsed = parseAttachmentUri(uri);
      if (!parsed) {
        if (!isSafeEditorUrl(uri)) throw new Error("链接地址不安全");
        window.open(uri, "_blank", "noopener,noreferrer");
        return;
      }

      const { data, error } = await client.storage
        .from(parsed.bucket)
        .createSignedUrl(parsed.path, 60);
      if (error) throw new Error(error.message);
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    },

    async remove(uri) {
      await del(localPendingKey(uri));
      const parsed = parseAttachmentUri(uri);
      if (!parsed || !navigator.onLine) {
        const previewUrl = previewUrls.get(uri);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrls.delete(uri);
        return;
      }
      const { error } = await client.storage
        .from(parsed.bucket)
        .remove([parsed.path]);
      if (error) throw new Error(error.message);
      const previewUrl = previewUrls.get(uri);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrls.delete(uri);
    },

    dispose() {
      for (const url of previewUrls.values()) URL.revokeObjectURL(url);
      previewUrls.clear();
    },
  };
}

export function createDemoAttachmentService(): AttachmentService {
  const objectUrls = new Map<string, string>();

  return {
    async upload(context, file) {
      const metadata = validateAttachment(file);
      let path: string;
      try {
        path = buildAttachmentPath(context, metadata.extension);
      } catch {
        path = buildAttachmentPath(
          { workspaceId: crypto.randomUUID(), taskId: crypto.randomUUID() },
          metadata.extension,
        );
      }
      const uri = buildAttachmentUri(path);
      objectUrls.set(uri, URL.createObjectURL(file));
      return {
        contentType: metadata.contentType,
        fileName: file.name,
        image: metadata.image,
        path,
        uri,
      };
    },

    async uploadCommentImage(context, file) {
      const metadata = validateCommentImage(file);
      let path: string;
      try {
        path = buildCommentImagePath(context, metadata.extension);
      } catch {
        path = buildCommentImagePath({
          workspaceId: crypto.randomUUID(),
          taskId: crypto.randomUUID(),
          uploaderId: crypto.randomUUID(),
        }, metadata.extension);
      }
      const uri = buildCommentImageUri(path);
      objectUrls.set(uri, URL.createObjectURL(file));
      return {
        contentType: metadata.contentType,
        fileName: file.name,
        image: true,
        path,
        uri,
      };
    },

    async resolveImage(uri) {
      const objectUrl = objectUrls.get(uri);
      if (!objectUrl) throw new Error("演示附件已失效，请重新上传");
      return objectUrl;
    },

    async open(uri) {
      const objectUrl = objectUrls.get(uri);
      if (objectUrl) {
        window.open(objectUrl, "_blank", "noopener,noreferrer");
        return;
      }
      if (!isSafeEditorUrl(uri)) throw new Error("链接地址不安全");
      window.open(uri, "_blank", "noopener,noreferrer");
    },

    async remove(uri) {
      const objectUrl = objectUrls.get(uri);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrls.delete(uri);
    },

    dispose() {
      for (const url of objectUrls.values()) URL.revokeObjectURL(url);
      objectUrls.clear();
    },
  };
}
