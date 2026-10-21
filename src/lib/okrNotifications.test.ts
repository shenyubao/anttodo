import type { SupabaseClient } from "@supabase/supabase-js";
import { loadNotifications } from "./api";
import { describe, expect, it, vi } from "vitest";
import { appRoutePath, parseAppRoute, parseTaskReturnRoute } from "./appRoute";
import { notificationHeadlineText, notificationOkrRoute, notificationSummary } from "./notificationCopy";
import { shouldShowSystemNotification } from "./desktopNotifications";
import { defaultNotificationPreferences } from "./notificationPreferences";
import type { AppNotification } from "../types";

const notification: AppNotification = {
  id: "n", workspace_id: "b1000000-0000-4000-8000-000000000001", task_id: null,
  objective_id: null, key_result_id: "f2000000-0000-4000-8000-000000000001",
  actor_id: "a", recipient_id: "b", notification_type: "okr_mentioned", comment_id: null,
  created_at: "2026-10-21T10:00:00Z", read_at: null,
  payload: { owner_id: "a1000000-0000-4000-8000-000000000001", cycle_id: "d1000000-0000-4000-8000-000000000001", title: "交付", summary: "请 @小明 跟进" },
};

describe("OKR mention notifications", () => {
  it.each(["objective", "key_result"] as const)("round-trips the %s note route", (kind) => {
    const item: AppNotification = { ...notification, objective_id: kind === "objective" ? "f1000000-0000-4000-8000-000000000001" : null,
      key_result_id: kind === "key_result" ? notification.key_result_id : null };
    const route = notificationOkrRoute(item)!;
    expect(parseAppRoute(appRoutePath(route))).toEqual(route);
    expect(parseTaskReturnRoute(route, route.workspaceId)).toEqual(route);
    expect(route).toMatchObject({ kind: "okr", target: { kind, initialTab: "notes" } });
  });
  it("shows OKR copy and stays in-app only", () => {
    expect(notificationHeadlineText(notification)).toBe("团队成员 在 OKR 备注中提及了你");
    expect(notificationSummary(notification)).toBe("请 @小明 跟进");
    expect(shouldShowSystemNotification(notification, defaultNotificationPreferences())).toBe(false);
  });
  it("keeps notifications without a task when loading the feed", async () => {
    const notificationQuery = {
      select: () => notificationQuery, eq: () => notificationQuery, order: () => notificationQuery,
      limit: async () => ({ data: [notification], error: null }),
    };
    const from = vi.fn((table: string) => {
      if (table === "notifications") return notificationQuery;
      if (table === "profiles") return { select: () => ({ in: async () => ({ data: [], error: null }) }) };
      throw new Error(`Unexpected task lookup: ${table}`);
    });
    const feed = await loadNotifications({ from } as unknown as SupabaseClient, notification.workspace_id);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ notification_type: "okr_mentioned", task_id: null });
    expect(from.mock.calls.map(([table]) => table)).toEqual(["notifications", "profiles"]);
  });

  it("rejects an incomplete notification destination", () => {
    expect(notificationOkrRoute({ ...notification, payload: {} })).toBeNull();
  });
});
