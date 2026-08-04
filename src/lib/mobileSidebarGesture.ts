export const MOBILE_SIDEBAR_MEDIA = "(max-width: 640px)";
export const MOBILE_SIDEBAR_MAX_WIDTH = 320;
export const MOBILE_SIDEBAR_VIEWPORT_RATIO = 0.88;
export const MOBILE_SIDEBAR_EDGE_WIDTH = 24;
export const MOBILE_SIDEBAR_LOCK_DISTANCE = 8;
export const MOBILE_SIDEBAR_OPEN_RATIO = 0.35;
export const MOBILE_SIDEBAR_VELOCITY_PX_PER_MS = 0.45;

export type MobileSidebarDragKind = "open" | "close";

export function mobileSidebarWidth(viewportWidth: number) {
  return Math.min(MOBILE_SIDEBAR_MAX_WIDTH, viewportWidth * MOBILE_SIDEBAR_VIEWPORT_RATIO);
}

export function canStartMobileSidebarOpenGesture(clientX: number, edgeWidth = MOBILE_SIDEBAR_EDGE_WIDTH) {
  return clientX <= edgeWidth;
}

export function mobileSidebarDragOffset(
  kind: MobileSidebarDragKind,
  width: number,
  deltaX: number,
) {
  if (kind === "open") {
    return Math.min(0, Math.max(-width, -width + deltaX));
  }
  return Math.min(0, Math.max(-width, deltaX));
}

export function mobileSidebarDragProgress(width: number, offsetX: number) {
  if (width <= 0) return 0;
  return Math.min(1, Math.max(0, (offsetX + width) / width));
}

export function shouldCompleteMobileSidebarGesture(options: {
  kind: MobileSidebarDragKind;
  width: number;
  deltaX: number;
  velocityX: number;
  openRatio?: number;
  velocityThreshold?: number;
}) {
  const openRatio = options.openRatio ?? MOBILE_SIDEBAR_OPEN_RATIO;
  const velocityThreshold = options.velocityThreshold ?? MOBILE_SIDEBAR_VELOCITY_PX_PER_MS;
  const { kind, width, deltaX, velocityX } = options;

  if (kind === "open") {
    if (velocityX >= velocityThreshold) return true;
    if (velocityX <= -velocityThreshold) return false;
    return deltaX >= width * openRatio;
  }

  if (velocityX <= -velocityThreshold) return true;
  if (velocityX >= velocityThreshold) return false;
  return deltaX <= -width * openRatio;
}

export function isMobileSidebarGestureTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return true;
  return !target.closest("input, textarea, select, [contenteditable='true']");
}
