import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api/downloads/macos": {
        target: "https://anttodo-yuce.oss-cn-hangzhou.aliyuncs.com",
        changeOrigin: true,
        rewrite: () => "/release/macos/latest.json",
      },
    },
  },
  build: {
    sourcemap: false,
  },
});
