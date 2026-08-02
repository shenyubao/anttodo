/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_PUBLIC_APP_URL?: string;
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
    updates: {
      getAppVersion: () => Promise<string>;
      check: () => Promise<DesktopUpdateCheckResult>;
      openDownload: (url: string) => Promise<boolean>;
    };
  };
}
