/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_PUBLIC_APP_URL?: string;
  readonly VITE_APP_VERSION?: string;
  readonly ANTTODO_INSTANCE_DISPLAY_NAME?: string;
  readonly ANTTODO_DEPLOY_MODE?: "saas" | "onPremises";
  readonly ANTTODO_INSTANCE_ENTERPRISE_SLUG?: string;
  readonly ANTTODO_WORKSPACE_SLUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

type DesktopUpdateCheckResult =
  | {
      status: "available";
      currentVersion: string;
      latestVersion: string;
      downloadUrl: string;
    }
  | {
      status: "up-to-date";
      currentVersion: string;
      latestVersion: string;
    }
  | {
      status: "error";
      message: string;
    };

type DesktopUpdateInstallResult =
  | { status: "installing" }
  | { status: "unavailable"; message: string }
  | { status: "manual"; message: string; detail?: string }
  | { status: "error"; message: string; detail?: string };

type DesktopUpdateDownloadProgress = {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
};

interface Window {
  anttodoDesktop?: {
    platform: string;
    versions: {
      electron: string;
      chrome: string;
    };
    windowControls: {
      close: () => void;
      minimize: () => void;
      toggleFullScreen: () => void;
    };
    auth: {
      openDingtalkUrl: (url: string) => Promise<boolean>;
      setServiceOrigin: (origin: string) => Promise<boolean>;
      takePendingCallback: () => Promise<string | null>;
      onCallbackAvailable: (listener: () => void) => () => void;
    };
    deepLinks: {
      ready: () => void;
      onCommand: (
        listener: (command: import("./lib/desktopDeepLink").DesktopDeepLinkCommand) => void,
      ) => () => void;
    };
    reminders: {
      sync: (entries: Array<{
        id: string;
        reminderId: string;
        taskId: string;
        workspaceId: string;
        title: string;
        body: string;
        triggerAt: string;
      }>) => Promise<boolean>;
      acknowledge: (reminderId: string) => void;
      onOpenTask: (listener: (target: { workspaceId: string; taskId: string }) => void) => () => void;
    };
    notifications: {
      show: (payload: {
        title: string;
        body: string;
        workspaceId?: string;
        taskId?: string;
      }) => Promise<boolean>;
    };
    sync: {
      open: (namespace: string, userId: string) => Promise<boolean>;
      getStatus: (workspaceId: string | null) => Promise<import("./lib/local-first/types").SyncStatus>;
      saveBundle: (input: { workspaceId: string; bundle: import("./types").WorkspaceBundle }) => Promise<boolean>;
      getBundle: (workspaceId: string) => Promise<import("./types").WorkspaceBundle | null>;
      getComments: (commentKey: string) => Promise<import("./types").TaskComment[] | null>;
      saveComments: (input: { commentKey: string; comments: import("./types").TaskComment[] }) => Promise<boolean>;
      commitComments: (input: {
        commentKey: string;
        comments: import("./types").TaskComment[];
        operation: import("./lib/local-first/repository").LocalCommand;
      }) => Promise<boolean>;
      commitBundle: (input: {
        workspaceId: string;
        bundle: import("./types").WorkspaceBundle;
        operation: import("./lib/local-first/repository").LocalCommand;
      }) => Promise<boolean>;
      saveWorkspaces: (input: { workspaces: import("./types").Workspace[] }) => Promise<boolean>;
      getWorkspaces: () => Promise<import("./types").Workspace[] | null>;
      syncNow: (input: {
        workspaceId: string;
        reason: import("./lib/local-first/types").SyncReason;
      }) => Promise<import("./lib/local-first/types").SyncRunResult>;
      enqueue: (operation: {
        operationId: string;
        workspaceId: string;
        deviceId: string;
        deviceSeq: number;
        entityType: string;
        entityId: string;
        baseVersion?: number | null;
        payload: unknown;
        dependsOn?: string[];
      }) => Promise<boolean>;
      listOutbox: (input: { workspaceId: string; limit?: number }) => Promise<unknown[]>;
      markOutbox: (input: { operationId: string; state: string; error?: string }) => Promise<boolean>;
    };
    updates: {
      getAppVersion: () => Promise<string>;
      check: () => Promise<DesktopUpdateCheckResult>;
      openDownload: (url: string) => Promise<boolean>;
      downloadAndInstall: () => Promise<DesktopUpdateInstallResult>;
      onDownloadProgress: (
        listener: (progress: DesktopUpdateDownloadProgress) => void,
      ) => () => void;
      onDownloadError: (
        listener: (payload: { message: string; detail?: string }) => void,
      ) => () => void;
    };
    aiWork: {
      selectDirectory: () => Promise<string | null>;
      terminal: {
        start: (input: {
          sessionId: string;
          tool: "codex" | "claude";
          cwd: string;
          prompt: string;
          cols: number;
          rows: number;
        }) => Promise<{
          sessionId: string;
          buffer: string;
          running: boolean;
          exitCode: number | null;
        }>;
        write: (sessionId: string, data: string) => Promise<boolean>;
        resize: (sessionId: string, cols: number, rows: number) => Promise<boolean>;
        stop: (sessionId: string) => Promise<boolean>;
        onData: (sessionId: string, listener: (data: string) => void) => () => void;
        onExit: (
          sessionId: string,
          listener: (event: { exitCode: number; signal: number }) => void,
        ) => () => void;
      };
    };
    tray: {
      setAuthenticated: (value: boolean) => void;
      setTitle: (title: string) => void;
      hide: () => void;
      setIgnoreBlur: (value: boolean) => void;
      showMainWindow: () => void;
      openSettings: () => void;
      openTask: (target: { workspaceId: string; taskId: string }) => void;
      onOpenSettings: (listener: () => void) => () => void;
      onOpenTask: (
        listener: (target: { workspaceId: string; taskId: string }) => void,
      ) => () => void;
    };
  };
}
