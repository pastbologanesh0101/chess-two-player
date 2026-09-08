import { defineConfig } from "vite";

// The repo is served from https://<user>.github.io/chess-two-player/ on Pages,
// so assets need that base path. Local dev (`npm run dev`) ignores it.
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/chess-two-player/" : "/",
  build: {
    outDir: "dist",
    target: "es2020",
  },
});
