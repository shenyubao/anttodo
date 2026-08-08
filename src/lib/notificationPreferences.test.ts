import { describe, expect, it } from "vitest";
import { mergeNotificationPreferenceRows, defaultNotificationPreferences, NOTIFICATION_SCENARIOS } from "./notificationPreferences";

describe("notificationPreferences", () => {
  it("defaults every scenario to both channels on", () => {
    const prefs = defaultNotificationPreferences();
    expect(NOTIFICATION_SCENARIOS.length).toBe(11);
    for (const scenario of NOTIFICATION_SCENARIOS) {
      expect(prefs[scenario.id]).toEqual({ systemEnabled: true, dingtalkEnabled: true });
    }
  });

  it("merges stored rows over defaults", () => {
    const prefs = mergeNotificationPreferenceRows([
      {
        scenario: "task_assigned",
        system_enabled: false,
        dingtalk_enabled: true,
      },
    ]);
    expect(prefs.task_assigned).toEqual({ systemEnabled: false, dingtalkEnabled: true });
    expect(prefs.note_mentioned).toEqual({ systemEnabled: true, dingtalkEnabled: true });
  });
});
