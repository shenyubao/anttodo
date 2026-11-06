import { describe, expect, it } from "vitest";
import { isManualDescriptionMention } from "../../supabase/functions/_shared/mention-notification-policy";

describe("manual mention dispatch policy", () => {
  it.each(["todo_mentioned", "note_mentioned"])("allows explicit %s to override the DingTalk preference", (notification_type) => {
    expect(isManualDescriptionMention({ notification_type, comment_id: null, payload: { source: "description", manual_send: true } })).toBe(true);
  });

  it.each([
    { notification_type: "todo_mentioned", payload: { source: "description" } },
    { notification_type: "todo_mentioned", payload: { source: "mention", manual_send: true } },
    { notification_type: "todo_mentioned", comment_id: "comment", payload: { source: "description", manual_send: true } },
    { notification_type: "comment_mention", payload: { source: "description", manual_send: true } },
    { notification_type: "okr_mentioned", payload: { source: "description", manual_send: true } },
    { notification_type: "todo_mentioned", payload: { source: "description", manual_send: "true" } },
  ])("preserves preferences for other events: %j", (notification) => {
    expect(isManualDescriptionMention(notification)).toBe(false);
  });
});
