import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: process.env.VITE_API_PROXY_TARGET
      ? {
          "/api": {
            target: process.env.VITE_API_PROXY_TARGET,
            changeOrigin: true
          }
        }
      : undefined
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
