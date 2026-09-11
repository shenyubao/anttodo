import { defineConfig } from "vitest/config";

const allTestFiles = [
  "src/**/*.test.ts",
  "src/**/*.test.tsx",
  "electron/**/*.test.mjs",
  "scripts/**/*.test.mjs",
];

const domTestFiles = [
  "src/**/*.test.tsx",
  "src/lib/{appHost,auth,desktopNotifications,instanceConfig,keyboardShortcuts,sso,taskDetailDismiss,taskMultiSelect,webPush,workspaceInvites}.test.ts",
];

export default defineConfig({
  test: {
    pool: "threads",
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: allTestFiles,
          exclude: domTestFiles,
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: domTestFiles,
          setupFiles: ["./src/test/setup.ts"],
        },
      },
      {
        extends: true,
        root: "./cli",
        test: {
          name: "cli",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
    ],
    coverage: {
      reporter: ["text", "html"]
    }
  }
});
