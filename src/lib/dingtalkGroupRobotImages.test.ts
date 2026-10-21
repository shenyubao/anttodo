import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDingtalkGroupRobotImageDescription,
  detectDingtalkGroupRobotImageType,
  downloadDingtalkGroupRobotImage,
  storeDingtalkGroupRobotImages,
} from "../../supabase/functions/_shared/dingtalk-group-robot-images";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DingTalk group robot rich-text images", () => {
  it("detects the supported image formats from their binary signatures", () => {
    expect(detectDingtalkGroupRobotImageType(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )).toEqual({ contentType: "image/png", extension: "png" });
    expect(detectDingtalkGroupRobotImageType(
      new Uint8Array([0xff, 0xd8, 0xff]),
    )).toEqual({ contentType: "image/jpeg", extension: "jpg" });
    expect(detectDingtalkGroupRobotImageType(
      new TextEncoder().encode("GIF89a"),
    )).toEqual({ contentType: "image/gif", extension: "gif" });
    expect(detectDingtalkGroupRobotImageType(
      new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
    )).toEqual({ contentType: "image/webp", extension: "webp" });
    expect(detectDingtalkGroupRobotImageType(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("uses DingTalk's download API and verifies the downloaded bytes", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        downloadUrl: "https://download.dingtalk.com/temp/image",
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(png, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const image = await downloadDingtalkGroupRobotImage({
      accessToken: "access-token",
      downloadCode: "download-code",
      robotCode: "robot-code",
    });

    expect(image.contentType).toBe("image/png");
    expect(image.extension).toBe("png");
    expect(image.blob.size).toBe(png.byteLength);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.dingtalk.com/v1.0/robot/messageFiles/download");
    expect(new Headers(init.headers).get("x-acs-dingtalk-access-token")).toBe("access-token");
    expect(JSON.parse(String(init.body))).toEqual({
      downloadCode: "download-code",
      robotCode: "robot-code",
    });
  });

  it("builds task-description image references from stored attachments", () => {
    expect(buildDingtalkGroupRobotImageDescription([
      {
        path: "workspace/task/image-1.png",
        uri: "anttodo-storage://task-attachments/workspace/task/image-1.png",
      },
      {
        path: "workspace/task/image-2.jpg",
        uri: "anttodo-storage://task-attachments/workspace/task/image-2.jpg",
      },
    ])).toBe([
      "![钉钉图片 1](anttodo-storage://task-attachments/workspace/task/image-1.png)",
      "![钉钉图片 2](anttodo-storage://task-attachments/workspace/task/image-2.jpg)",
    ].join("\n\n"));
  });

  it("stores downloaded images in the task attachment bucket", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        downloadUrl: "https://download.dingtalk.com/temp/image",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(png, { status: 200 })));
    const upload = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ upload });

    const result = await storeDingtalkGroupRobotImages({
      accessToken: "access-token",
      images: [{ downloadCode: "download-code" }],
      messageId: "message-id",
      robotCode: "robot-code",
      supabaseAdmin: { storage: { from } },
      taskId: "18000000-0000-0000-0000-000000000001",
      workspaceId: "28000000-0000-0000-0000-000000000001",
    });

    expect(result.failedCount).toBe(0);
    expect(result.stored).toHaveLength(1);
    expect(result.stored[0].uri).toMatch(
      /^anttodo-storage:\/\/task-attachments\/28000000-0000-0000-0000-000000000001\/18000000-0000-0000-0000-000000000001\/[0-9a-f-]{36}\.png$/,
    );
    expect(from).toHaveBeenCalledWith("task-attachments");
    expect(upload).toHaveBeenCalledWith(
      result.stored[0].path,
      expect.any(Blob),
      expect.objectContaining({ contentType: "image/png", upsert: true }),
    );
  });
});
