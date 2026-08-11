export type DesktopFocusMode = "pomodoro" | "stopwatch";

export type DesktopDeepLinkCommand =
  | {
      type: "navigate";
      target: "view" | "task" | "calendar" | "focus";
      workspaceId: string | null;
      view?: string;
      taskId?: string;
    }
  | {
      type: "focus";
      action: "start" | "pause" | "stop" | "switch";
      mode?: DesktopFocusMode;
      workspaceId: string | null;
      taskId?: string;
    };

export type DesktopDeepLinkEnvelope = {
  id: number;
  command: DesktopDeepLinkCommand;
};

export type DesktopFocusDeepLinkEnvelope = DesktopDeepLinkEnvelope & {
  command: Extract<DesktopDeepLinkCommand, { type: "focus" }>;
};
