import { defineConfig } from 'vite';
import { rundotGameLibrariesPlugin } from "@series-inc/rundot-game-sdk/vite";

// CDN assets in cdn/ folder are automatically served in dev mode

export default defineConfig({
  plugins: [rundotGameLibrariesPlugin()],
  base: "./",
  server: {
    allowedHosts: true,
  },
  // Vite uses esbuild both for transforms and (in dev) dependency prebundling.
  // RUN.game SDK includes top-level await, so we must target an environment that supports it.
  esbuild: {
    target: "es2022",
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "es2022",
    },
  },
  build: {
    target: "es2022", // Support top-level await for embedded libraries
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ["phaser"],
        },
      },
    },
  },
});
