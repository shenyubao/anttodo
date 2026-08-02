import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.anttodo.ios",
  appName: "蚂蚁清单",
  webDir: "dist",
  backgroundColor: "#ffffff",
  ios: {
    contentInset: "never",
    preferredContentMode: "mobile",
  },
};

export default config;
