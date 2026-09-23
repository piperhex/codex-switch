import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { imageEditorPlugin } from '../../shared/chat/imageEditorPlugin';

export default defineConfig({
  plugins: [react(), imageEditorPlugin()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    rollupOptions: { input: { main: "index.html", quickMenu: "quick-menu.html" } },
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
});
