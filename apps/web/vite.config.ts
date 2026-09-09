import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, currentDir, "");
  const apiTarget = env.VITE_DEV_API_URL || "http://127.0.0.1:8080";
  return {
    plugins: [react()],
    clearScreen: false,
    root: currentDir,
    base: env.VITE_WEB_BASE_PATH || "/web/",
    server: {
      port: 1422,
      host: "127.0.0.1",
      proxy: {
        "/auth": { target: apiTarget, ws: true },
        "/sync": apiTarget,
        "/devices": apiTarget,
        "/admin/api": apiTarget,
        "/device-chat": { target: apiTarget, ws: true },
        "/device-switch": { target: apiTarget, ws: true },
      },
    },
    build: {
      outDir: resolve(currentDir, "dist"),
      emptyOutDir: true,
      assetsDir: "assets",
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks: {
            antd: ["antd", "antd-mobile"],
            icons: ["lucide-react"],
            redux: ["@reduxjs/toolkit", "react-redux"],
          },
        },
      },
    },
  };
});
