import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  root: __dirname,
  build: {
    outDir: "../media/dist",
    emptyOutDir: true,
    sourcemap: false,
    manifest: true,
    assetsDir: "assets",
  },
  base: "",
});


