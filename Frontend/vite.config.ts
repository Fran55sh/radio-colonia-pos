// @lovable.dev/vite-tanstack-config: tanstackStart, react, tailwind, paths, etc.
// Producción Docker/Coolify: cloudflare: false + nitro preset node-server.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { nitro } from "nitro/vite";

const apiProxyTarget = process.env.VITE_PROXY_TARGET ?? "http://127.0.0.1:3001";

export default defineConfig({
  cloudflare: false,
  plugins: [
    nitro({
      preset: "node-server",
      routeRules: {
        "/api/**": { proxy: `${apiProxyTarget}/api/**` },
        "/health": { proxy: `${apiProxyTarget}/health` },
      },
    }),
  ],
  vite: {
    server: {
      host: true,
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        "/health": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
  },
});
