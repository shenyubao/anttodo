import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api/downloads/macos": {
        target: "https://download.anttodo.com",
        changeOrigin: true,
        rewrite: () => "/macos/latest.json",
      },
    },
  },
  build: {
    sourcemap: true,
  },
});
