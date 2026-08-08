import type { AppNotification } from "../types";

export function notificationHeadline(item: AppNotification) {
  const actor = item.actor?.display_name || "团队成员";
  const kindLabel = item.task?.kind === "note" ? "笔记" : "待办";

  switch (item.notification_type) {
    case "task_assigned":
      return (
        <>
          <strong>{actor}</strong> 将待办指派给你
        </>
      );
    case "task_new_comment":
      return (
        <>
          <strong>{actor}</strong> 评论了待办
        </>
      );
    case "note_mentioned":
      return (
        <>
          <strong>{actor}</strong> 在笔记中提及了你
        </>
      );
    case "comment_mention":
      return (
        <>
          <strong>{actor}</strong> 在{kindLabel}中引用了你
        </>
      );
    case "participant_added":
      return (
        <>
          <strong>{actor}</strong> 将你添加为参与者
        </>
      );
    case "participant_title_changed":
      return (
        <>
          <strong>{actor}</strong> 更新了标题
        </>
      );
    case "participant_status_changed": {
      const after = String(item.payload?.after ?? "");
      const statusLabel = after === "completed" ? "已完成" : "未完成";
      return (
        <>
          <strong>{actor}</strong> 将状态改为{statusLabel}
        </>
      );
    }
    case "participant_new_comment":
      return (
        <>
          <strong>{actor}</strong> 评论了你参与的待办
        </>
      );
    case "participant_subtask_created":
      return (
        <>
          <strong>{actor}</strong> 添加了子任务
        </>
      );
    case "participant_subtask_status_changed":
      return (
        <>
          <strong>{actor}</strong> 更新了子任务状态
        </>
      );
    case "participant_subtask_title_changed":
      return (
        <>
          <strong>{actor}</strong> 更新了子任务标题
        </>
      );
    default:
      return (
        <>
          <strong>{actor}</strong> 更新了{kindLabel}
        </>
      );
  }
}

export function notificationSummary(item: AppNotification) {
  if (item.comment) {
    return item.comment.body.trim() ||
      (item.comment.image_uris.length ? "[图片]" : "");
  }
  if (item.notification_type === "participant_title_changed") {
    return String(item.payload?.after ?? "");
  }
  if (
    item.notification_type === "participant_subtask_created" ||
    item.notification_type === "participant_subtask_title_changed"
  ) {
    return String(item.payload?.after ?? item.payload?.title ?? "");
  }
  return "";
}
