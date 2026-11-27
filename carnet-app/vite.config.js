import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  // ONNX Runtime finds its .wasm next to its own module; pre-bundling in dev breaks that.
  optimizeDeps: { exclude: ['onnxruntime-web'] },
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
        globPatterns: ['**/*.{js,mjs,css,html,png,ttf,wasm,gz}', 'ocr/**/*'],
        // The second receipt reader (≈27 MB) isn't installed with the app: it downloads the
        // first time a receipt needs it and is kept from then on (runtime cache below).
        globIgnores: ['ocr/paddle/**', '**/ort-wasm*'],
        maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
        importScripts: ['/push-sw.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/ocr/paddle/') || url.pathname.includes('/ort-wasm'),
            handler: 'CacheFirst',
            options: { cacheName: 'second-reader', expiration: { maxEntries: 10 } },
          },
          {
            // The map's style and its tile index name a dated tile set that the map service replaces
            // every week or so and then deletes: always ask for the current one, cached copy offline.
            urlPattern: ({ url }) => url.hostname === 'tiles.openfreemap.org' && !/\.(pbf|png|json)$/.test(url.pathname) && !url.pathname.startsWith('/fonts/'),
            handler: 'NetworkFirst',
            options: { cacheName: 'map-index', networkTimeoutSeconds: 4, expiration: { maxEntries: 20 } },
          },
          {
            // Tiles, fonts and icons never change at a given address: keep the ones you've looked at.
            urlPattern: ({ url }) => url.hostname === 'tiles.openfreemap.org',
            handler: 'CacheFirst',
            options: { cacheName: 'map-tiles', expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            urlPattern: ({ url }) => url.pathname === '/api/og' || url.pathname === '/api/geo',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'lookups', expiration: { maxEntries: 500 } },
          },
          {
            // Google's place photos: kept on the phone once fetched, so they don't cost again.
            urlPattern: ({ url }) => url.pathname === '/api/gphoto',
            handler: 'CacheFirst',
            options: { cacheName: 'google-photos', expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 }, cacheableResponse: { statuses: [200] } },
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
