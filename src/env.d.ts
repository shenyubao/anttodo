/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_PUBLIC_APP_URL?: string;
  readonly VITE_APP_VERSION?: string;
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
  | { status: "error"; message: string };

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
      takePendingCallback: () => Promise<string | null>;
      onCallbackAvailable: (listener: () => void) => () => void;
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
    updates: {
      getAppVersion: () => Promise<string>;
      check: () => Promise<DesktopUpdateCheckResult>;
      openDownload: (url: string) => Promise<boolean>;
      downloadAndInstall: () => Promise<DesktopUpdateInstallResult>;
      onDownloadProgress: (
        listener: (progress: DesktopUpdateDownloadProgress) => void,
      ) => () => void;
      onDownloadError: (
        listener: (payload: { message: string }) => void,
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
