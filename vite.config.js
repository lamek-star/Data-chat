import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://localhost:4242" },
    // wrangler dev writes local emails and D1 files here; don't reload on them.
    watch: { ignored: ["**/.wrangler/**"] },
  },
  build: {
    rollupOptions: {
      input: {
        app: resolve(__dirname, "index.html"),
        admin: resolve(__dirname, "admin.html"),
      },
    },
  },
});
