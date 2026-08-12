import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL(".", import.meta.url))

// Served by JCEF ClasspathResourceHandler as http://vibefly/
// Keep relative base so multi-chunk assets resolve under the custom domain.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  root,
  resolve: {
    alias: [
      {find: "@", replacement: resolve(root, "src")},
      // @streamdown/code imports full shiki (~340 langs). Web bundle is enough for chat code blocks.
      {find: /^shiki$/, replacement: "shiki/bundle/web"},
    ],
  },
  server: {
    // JCEF loads this origin when -Dvibefly.ui.dev=true (WebSocket HMR needs real HTTP, not classpath scheme).
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    cors: true,
    hmr: {
      protocol: "ws",
      host: "127.0.0.1",
      port: 5173,
      clientPort: 5173,
    },
  },
  build: {
    target: "esnext",
    outDir: resolve(root, "../vibefly-jcef/src/main/resources/web"),
    emptyOutDir: true,
    assetsDir: "assets",
    // Production zip must stay small; enable maps only for explicit debug builds.
    sourcemap: process.env.VIBEFLY_UI_SOURCEMAP === "true",
    cssCodeSplit: true,
    modulePreload: {
      polyfill: false,
    },
  },
})
