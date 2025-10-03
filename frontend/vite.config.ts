import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  base: "./",
  build: {
    outDir: "../backend/dist/frontend",
  },
  server: {
    host: "0.0.0.0", // listen on all network interfaces not just localhost for 5173 to work with docker container
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/auth": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/health": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/user": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/courses": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
