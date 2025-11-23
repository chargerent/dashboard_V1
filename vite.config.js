// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

export default defineConfig(({ command }) => ({
  // Public base path (your dashboard lives under /portal/)
  base: '/portal/',

  plugins: [
    react(),

    // Only run PWA plugin for build command, not for dev server
    command === 'build' &&
      VitePWA({
        // 🔹 Keep manifest/icons for "Add to Home Screen"
        // 🔹 Disable all offline caching and auto SW registration
        injectRegister: null, // ⛔ prevents automatic SW injection
        strategies: 'generateSW', // Use generateSW to avoid manifest injection
        registerType: 'prompt', // don't auto-update; no cache layer
        // Tell workbox to do nothing, as we are providing our own service worker
        workbox: { globPatterns: [] },
        includeAssets: [
          'favicon.ico',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
        ],

        manifest: {
          name: 'Chargerent Dashboard',
          short_name: 'Dashboard',
          description: 'Internal management dashboard for Chargerent',
          display: 'standalone',
          start_url: '/portal/index.html',
          scope: '/portal/',
          theme_color: '#ffffff',
          background_color: '#ffffff',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable any',
            },
          ],
        },
      }),
  ].filter(Boolean), // Filter out falsy values in case PWA is not used

  // ✅ Ensures correct folder output structure for Nginx alias /portal/
  build: {
    outDir: resolve(dirname(fileURLToPath(import.meta.url)), 'dist/portal'),
    emptyOutDir: true,
    assetsDir: 'assets',
  },

  // ✅ Proxy setup for Node-RED APIs and WebSockets
  server: {
    proxy: {
      '/api': {
        target: 'https://chargerentstations.com',
        changeOrigin: true,
        secure: false,
      },
      '/ws': {
        target: 'wss://chargerentstations.com',
        ws: true,
        changeOrigin: true,
        secure: false,
      },
    },
  },
}))
