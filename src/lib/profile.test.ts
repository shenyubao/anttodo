import { describe, expect, it, vi } from "vitest";
import {
  MAX_AVATAR_INPUT_BYTES,
  avatarObjectPathFromPublicUrl,
  buildAvatarObjectPath,
  squareCropRect,
  validateAvatarFile,
} from "./profile";

const userId = "10000000-0000-4000-8000-000000000001";
const objectId = "50000000-0000-4000-8000-000000000001";

describe("profile avatars", () => {
  it("validates supported image types and input size", () => {
    expect(() => validateAvatarFile(
      new File(["image"], "avatar.png", { type: "image/png" }),
    )).not.toThrow();
    expect(() => validateAvatarFile(
      new File(["<svg/>"], "avatar.svg", { type: "image/svg+xml" }),
    )).toThrow("请选择 JPEG、PNG 或 WebP 图片");
    const oversized = new File(["x"], "avatar.webp", { type: "image/webp" });
    vi.spyOn(oversized, "size", "get").mockReturnValue(MAX_AVATAR_INPUT_BYTES + 1);
    expect(() => validateAvatarFile(oversized)).toThrow("头像图片不能超过 5MB");
  });

  it("centers a landscape or portrait image in a square crop", () => {
    expect(squareCropRect(1200, 800)).toEqual({ sx: 200, sy: 0, size: 800 });
    expect(squareCropRect(600, 1000)).toEqual({ sx: 0, sy: 200, size: 600 });
  });

  it("builds and recognizes only the current user's avatar path", () => {
    const path = buildAvatarObjectPath(userId, objectId);
    expect(path).toBe(`${userId}/${objectId}.webp`);
    const publicUrl = `https://supabase.example.com/storage/v1/object/public/profile-avatars/${path}`;
    expect(avatarObjectPathFromPublicUrl(publicUrl, userId)).toBe(path);
    expect(avatarObjectPathFromPublicUrl(publicUrl, "20000000-0000-4000-8000-000000000002"))
      .toBeNull();
    expect(avatarObjectPathFromPublicUrl("https://example.com/avatar.webp", userId)).toBeNull();
  });
});
