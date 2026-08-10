export const MOBILE_TASK_DETAIL_MEDIA = "(max-width: 640px)";
export const MOBILE_TASK_DETAIL_PEEK_RATIO = 0.6;
export const MOBILE_TASK_DETAIL_FULL_RATIO = 1;
export const MOBILE_TASK_DETAIL_CLOSE_RATIO = 0.35;
export const MOBILE_TASK_DETAIL_EXPAND_RATIO = 0.8;
export const MOBILE_TASK_DETAIL_VELOCITY_PX_PER_MS = 0.45;

export type MobileTaskDetailSnap = "peek" | "full";
export type MobileTaskDetailRelease = MobileTaskDetailSnap | "close";

export function mobileTaskDetailTranslateY(
  ratio: number,
  viewportHeight: number,
) {
  const clamped = Math.min(
    MOBILE_TASK_DETAIL_FULL_RATIO,
    Math.max(0, ratio),
  );
  return Math.round(viewportHeight * (1 - clamped));
}

export function mobileTaskDetailRatioFromTranslateY(
  translateY: number,
  viewportHeight: number,
) {
  if (viewportHeight <= 0) return 0;
  return Math.min(
    MOBILE_TASK_DETAIL_FULL_RATIO,
    Math.max(0, 1 - translateY / viewportHeight),
  );
}

export function mobileTaskDetailSnapRatio(snap: MobileTaskDetailSnap) {
  return snap === "full"
    ? MOBILE_TASK_DETAIL_FULL_RATIO
    : MOBILE_TASK_DETAIL_PEEK_RATIO;
}

export function resolveMobileTaskDetailRelease(options: {
  ratio: number;
  velocityY: number;
  closeRatio?: number;
  expandRatio?: number;
  velocityThreshold?: number;
}): MobileTaskDetailRelease {
  const closeRatio = options.closeRatio ?? MOBILE_TASK_DETAIL_CLOSE_RATIO;
  const expandRatio = options.expandRatio ?? MOBILE_TASK_DETAIL_EXPAND_RATIO;
  const velocityThreshold = options.velocityThreshold
    ?? MOBILE_TASK_DETAIL_VELOCITY_PX_PER_MS;
  const { ratio, velocityY } = options;

  if (velocityY <= -velocityThreshold) return "full";
  if (velocityY >= velocityThreshold) return "close";
  if (ratio >= expandRatio) return "full";
  if (ratio <= closeRatio) return "close";
  return "peek";
}
