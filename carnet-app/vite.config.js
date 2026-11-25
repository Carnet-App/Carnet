import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['fonts/*.ttf', 'icons/*.png'],
      manifest: {
        name: 'Carnet',
        short_name: 'Carnet',
        description: 'Trips, guides and the bill — a notebook that plans around you.',
        theme_color: '#F3EEE6',
        background_color: '#F3EEE6',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Everything the app needs to open and split a bill with no signal,
        // including the on-device text reader (≈25 MB, downloaded once).
        globPatterns: ['**/*.{js,css,html,png,ttf,wasm,gz}', 'ocr/**/*'],
        maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
        importScripts: ['/push-sw.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Map tiles, styles and fonts you've already looked at.
            urlPattern: ({ url }) => url.hostname === 'tiles.openfreemap.org',
            handler: 'CacheFirst',
            options: { cacheName: 'map', expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            urlPattern: ({ url }) => url.pathname === '/api/og' || url.pathname === '/api/geo',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'lookups', expiration: { maxEntries: 500 } },
          },
          {
            urlPattern: ({ request, url }) => request.destination === 'image' && !url.pathname.startsWith('/api/gphoto'),
            handler: 'CacheFirst',
            options: { cacheName: 'photos', expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 60 } },
          },
        ],
      },
    }),
  ],
});
