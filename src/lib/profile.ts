import type { SupabaseClient } from "@supabase/supabase-js";

export const PROFILE_AVATAR_BUCKET = "profile-avatars";
export const MAX_AVATAR_INPUT_BYTES = 5 * 1024 * 1024;
export const AVATAR_OUTPUT_SIZE = 512;
export const AVATAR_ACCEPT = "image/jpeg,image/png,image/webp";

const AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateAvatarFile(file: File) {
  if (!AVATAR_TYPES.has(file.type)) {
    throw new Error("请选择 JPEG、PNG 或 WebP 图片");
  }
  if (file.size > MAX_AVATAR_INPUT_BYTES) {
    throw new Error("头像图片不能超过 5MB");
  }
}

export function squareCropRect(width: number, height: number) {
  if (width <= 0 || height <= 0) throw new Error("无法读取头像图片");
  const size = Math.min(width, height);
  return {
    sx: (width - size) / 2,
    sy: (height - size) / 2,
    size,
  };
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法读取头像图片"));
    image.src = url;
  });
}

export async function cropAvatarFile(file: File): Promise<Blob> {
  validateAvatarFile(file);
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const crop = squareCropRect(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_OUTPUT_SIZE;
    canvas.height = AVATAR_OUTPUT_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前环境无法处理头像图片");
    context.drawImage(
      image,
      crop.sx,
      crop.sy,
      crop.size,
      crop.size,
      0,
      0,
      AVATAR_OUTPUT_SIZE,
      AVATAR_OUTPUT_SIZE,
    );
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/webp", 0.86);
    });
    if (!blob) throw new Error("头像图片处理失败");
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function buildAvatarObjectPath(userId: string, objectId = crypto.randomUUID()) {
  if (!UUID_PATTERN.test(userId) || !UUID_PATTERN.test(objectId)) {
    throw new Error("头像对象标识无效");
  }
  return `${userId}/${objectId}.webp`;
}

export function avatarObjectPathFromPublicUrl(url: string, userId: string) {
  try {
    const parsed = new URL(url);
    const marker = `/storage/v1/object/public/${PROFILE_AVATAR_BUCKET}/`;
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    const path = decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length));
    const [ownerId, fileName, extra] = path.split("/");
    if (
      extra !== undefined ||
      ownerId !== userId ||
      !UUID_PATTERN.test(ownerId) ||
      !/^[0-9a-f-]{36}\.webp$/i.test(fileName ?? "")
    ) {
      return null;
    }
    return path;
  } catch {
    return null;
  }
}

export async function updateDisplayName(
  client: SupabaseClient,
  userId: string,
  displayName: string,
) {
  const normalized = displayName.trim();
  if (normalized.length < 1 || normalized.length > 80) {
    throw new Error("昵称应为 1–80 个字符");
  }
  const { error } = await client
    .from("profiles")
    .update({
      display_name: normalized,
      display_name_customized_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}

async function removeOwnedAvatarObject(
  client: SupabaseClient,
  userId: string,
  avatarUrl: string | null,
) {
  if (!avatarUrl) return;
  const oldPath = avatarObjectPathFromPublicUrl(avatarUrl, userId);
  if (!oldPath) return;
  await client.storage.from(PROFILE_AVATAR_BUCKET).remove([oldPath]);
}

export async function updateAvatar(
  client: SupabaseClient,
  userId: string,
  currentAvatarUrl: string | null,
  avatar: Blob | null,
) {
  if (!avatar) {
    const { error } = await client
      .from("profiles")
      .update({ avatar_url: null })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    await removeOwnedAvatarObject(client, userId, currentAvatarUrl);
    return null;
  }

  const path = buildAvatarObjectPath(userId);
  const storage = client.storage.from(PROFILE_AVATAR_BUCKET);
  const { error: uploadError } = await storage.upload(path, avatar, {
    cacheControl: "31536000",
    contentType: "image/webp",
    upsert: false,
  });
  if (uploadError) throw new Error(uploadError.message);

  const publicUrl = storage.getPublicUrl(path).data.publicUrl;
  const { error: profileError } = await client
    .from("profiles")
    .update({ avatar_url: publicUrl })
    .eq("id", userId);
  if (profileError) {
    await storage.remove([path]);
    throw new Error(profileError.message);
  }

  await removeOwnedAvatarObject(client, userId, currentAvatarUrl);
  return publicUrl;
}
