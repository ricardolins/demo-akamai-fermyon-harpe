import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  publicDir: "public",
  server: {
    port: 5173,
    proxy: {
      "/api": "https://ccb238be-09c1-4260-8e13-8acb59f504a7.fwf.app",
    },
  },
});
