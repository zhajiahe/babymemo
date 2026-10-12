import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: { "vendor-react": ["react", "react-dom"] },
      },
    },
  },
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
});
