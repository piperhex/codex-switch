import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, currentDir, "");
  return {
    plugins: [react()],
    clearScreen: false,
    root: currentDir,
    base: env.VITE_WEB_BASE_PATH || "/web/",
    server: {
      port: 1422,
      host: "127.0.0.1",
      proxy: {
        "/auth": { target: "http://127.0.0.1:8080", ws: true },
        "/sync": "http://127.0.0.1:8080",
        "/devices": "http://127.0.0.1:8080",
        "/admin/api": "http://127.0.0.1:8080",
        "/device-switch": { target: "ws://127.0.0.1:8080", ws: true },
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
