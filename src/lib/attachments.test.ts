import { describe, expect, it, vi } from "vitest";
import {
  attachmentMarkdown,
  buildAttachmentPath,
  buildAttachmentUri,
  escapeMarkdownLabel,
  isSafeEditorUrl,
  MAX_ATTACHMENT_BYTES,
  parseAttachmentUri,
  validateAttachment,
} from "./attachments";

const workspaceId = "20000000-0000-4000-8000-000000000001";
const taskId = "40000000-0000-4000-8000-000000000001";
const objectId = "50000000-0000-4000-8000-000000000001";

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
