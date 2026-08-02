import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "electron/**/*.test.mjs",
    ],
    coverage: {
      reporter: ["text", "html"]
    }
  }
});
