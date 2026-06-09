import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// For GitHub Pages project sites the app is served from a sub-path
// (e.g. /seeg-agent/). The deploy workflow sets VITE_BASE; locally it stays "/".
const base = process.env.VITE_BASE ?? "/";

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/ws": {
        target: "ws://127.0.0.1:8000",
        ws: true,
      },
    },
  },
});
