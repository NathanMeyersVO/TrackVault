import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

const csp =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self' asset: https://asset.localhost blob: data:; connect-src 'self' ipc: http://ipc.localhost http://localhost:1420 ws://localhost:1420";

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  test: {
    environment: "node",
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    headers: {
      "Content-Security-Policy": csp,
    },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
