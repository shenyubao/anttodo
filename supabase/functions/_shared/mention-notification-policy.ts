/** Only explicit sends from the description RPC override the DingTalk preference. */
export function isManualDescriptionMention(notification: {
  notification_type: string;
  comment_id?: string | null;
  payload?: Record<string, unknown> | null;
}) {
  return (notification.notification_type === "todo_mentioned" || notification.notification_type === "note_mentioned")
    && notification.comment_id == null
    && notification.payload?.source === "description"
    && notification.payload?.manual_send === true;
}
