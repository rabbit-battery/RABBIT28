import { defineConfig } from "vite";
export default defineConfig(({ command }) => ({
  root: ".",
  base: command === "build" ? "/RABBIT28/" : "/",
  build: { outDir: "dist" },
  server: { host: "0.0.0.0", port: 5173, allowedHosts: true, headers: { "X-Frame-Options": "ALLOWALL" } },
  preview: { host: "0.0.0.0", port: 4173 }
}));
