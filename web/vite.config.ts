import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

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
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        connection: resolve(__dirname, "connection.html"),
        variables: resolve(__dirname, "variables.html")
      }
    }
  },
  base: "",
});


