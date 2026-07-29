import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { rmSync } from "node:fs";

const omitHostedDownloads = () => ({
  name: "omit-hosted-downloads",
  closeBundle() {
    // APK/AAB/iOS packages are served from R2. Keeping them out of dist also
    // prevents Capacitor from embedding old releases inside the next APK.
    rmSync(resolve(__dirname, "dist/downloads"), {
      recursive: true,
      force: true,
    });
  },
});

export default defineConfig({
  plugins: [react(), omitHostedDownloads()],
  server: { proxy: { "/api": "http://localhost:4242" } },
  build: {
    rollupOptions: {
      input: {
        app: resolve(__dirname, "index.html"),
        admin: resolve(__dirname, "admin.html"),
      },
    },
  },
});
