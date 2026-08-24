import { describe, expect, it, vi } from "vitest";
import {
  attachmentMarkdown,
  buildAttachmentPath,
  buildAttachmentUri,
  buildCommentImagePath,
  buildCommentImageUri,
  escapeMarkdownLabel,
  isSafeEditorUrl,
  MAX_ATTACHMENT_BYTES,
  normalizeEditorImageUri,
  parseAttachmentUri,
  validateAttachment,
  validateCommentImage,
} from "./attachments";

const workspaceId = "20000000-0000-4000-8000-000000000001";
const taskId = "40000000-0000-4000-8000-000000000001";
const objectId = "50000000-0000-4000-8000-000000000001";
const uploaderId = "10000000-0000-4000-8000-000000000001";

describe("task attachments", () => {
  it("builds and parses a canonical attachment uri", () => {
    const path = buildAttachmentPath({ workspaceId, taskId }, "png", objectId);
    const uri = buildAttachmentUri(path);

    expect(uri).toBe(
      `anttodo-storage://task-attachments/${workspaceId}/${taskId}/${objectId}.png`,
    );
    expect(parseAttachmentUri(uri)).toEqual({
      bucket: "task-attachments",
      path,
      taskId,
      workspaceId,
    });
  });

  it("rejects malformed or unsafe attachment uris", () => {
    expect(parseAttachmentUri("anttodo-storage://other/a/b/c.png")).toBeNull();
    expect(parseAttachmentUri("anttodo-storage://task-attachments/not-a-task")).toBeNull();
    expect(isSafeEditorUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeEditorUrl("https://anttodo.cn/help")).toBe(true);
    const wrapped = `<${buildAttachmentUri(`${workspaceId}/${taskId}/${objectId}.png`)}>`;
    expect(normalizeEditorImageUri(wrapped)).toBe(
      `anttodo-storage://task-attachments/${workspaceId}/${taskId}/${objectId}.png`,
    );
    expect(parseAttachmentUri(wrapped)).toEqual({
      bucket: "task-attachments",
      path: `${workspaceId}/${taskId}/${objectId}.png`,
      taskId,
      workspaceId,
    });
    expect(normalizeEditorImageUri("https://cdn/a.png?x=1&amp;y=2")).toBe(
      "https://cdn/a.png?x=1&y=2",
    );
  });

  it("builds and parses comment image uris scoped to the uploader", () => {
    const path = buildCommentImagePath(
      { workspaceId, taskId, uploaderId },
      "webp",
      objectId,
    );
    const uri = buildCommentImageUri(path);
    expect(parseAttachmentUri(uri)).toEqual({
      bucket: "comment-images",
      path,
      taskId,
      uploaderId,
      workspaceId,
    });
  });

  it("validates size, extension, and mime type", () => {
    expect(validateAttachment(new File(["image"], "screen.png", { type: "image/png" })))
      .toEqual({ contentType: "image/png", extension: "png", image: true });

    expect(() =>
      validateAttachment(new File(["<svg/>"], "unsafe.svg", { type: "image/svg+xml" })),
    ).toThrow("不支持这种附件格式");

    const oversized = new File(["x"], "large.pdf", { type: "application/pdf" });
    vi.spyOn(oversized, "size", "get").mockReturnValue(MAX_ATTACHMENT_BYTES + 1);
    expect(() => validateAttachment(oversized)).toThrow("附件不能超过 20MB");
    expect(() => validateCommentImage(
      new File(["text"], "notes.txt", { type: "text/plain" }),
    )).toThrow("评论只能上传图片");
  });

  it("escapes labels and inserts image or file markdown", () => {
    expect(escapeMarkdownLabel("a[b].png")).toBe("a\\[b\\].png");
    const base = {
      contentType: "image/png",
      fileName: "a[b].png",
      path: `${workspaceId}/${taskId}/${objectId}.png`,
      uri: buildAttachmentUri(`${workspaceId}/${taskId}/${objectId}.png`),
    };
    expect(attachmentMarkdown({ ...base, image: true })).toBe(
      `![a\\[b\\].png](${base.uri})`,
    );
    expect(attachmentMarkdown({ ...base, image: false })).toBe(
      `[a\\[b\\].png](${base.uri})`,
    );
  });
});
