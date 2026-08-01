export const WORKSPACE_SLUG_MIN_LENGTH = 2;
export const WORKSPACE_SLUG_MAX_LENGTH = 48;
export const WORKSPACE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeWorkspaceSlug(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidWorkspaceSlug(value: string): boolean {
  const slug = normalizeWorkspaceSlug(value);
  return (
    slug.length >= WORKSPACE_SLUG_MIN_LENGTH &&
    slug.length <= WORKSPACE_SLUG_MAX_LENGTH &&
    WORKSPACE_SLUG_PATTERN.test(slug)
  );
}

export function suggestWorkspaceSlug(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, WORKSPACE_SLUG_MAX_LENGTH);

  if (
    base.length >= WORKSPACE_SLUG_MIN_LENGTH &&
    WORKSPACE_SLUG_PATTERN.test(base)
  ) {
    return base;
  }

  return `team-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

export function workspaceSlugValidationMessage(value: string): string | null {
  const slug = normalizeWorkspaceSlug(value);
  if (!slug) return "请输入团队Slug。";
  if (slug.length < WORKSPACE_SLUG_MIN_LENGTH) {
    return `Slug 至少 ${WORKSPACE_SLUG_MIN_LENGTH} 个字符。`;
  }
  if (slug.length > WORKSPACE_SLUG_MAX_LENGTH) {
    return `Slug 最多 ${WORKSPACE_SLUG_MAX_LENGTH} 个字符。`;
  }
  if (!WORKSPACE_SLUG_PATTERN.test(slug)) {
    return "Slug 仅支持小写字母、数字和连字符，且不能以连字符开头或结尾。";
  }
  return null;
}
