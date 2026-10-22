import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves project sites from /<repo>/, so the base path is configurable.
const base = process.env.BASE_PATH ?? '/';

// Photos never leave the device: production builds may only talk to their own origin.
// Added at build time only, because the dev server needs inline scripts and a websocket.
const CSP = [
  "default-src 'self'",
  "img-src 'self' blob: data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
    ],
  };
}

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  worker: {
    // Classic worker (MediaPipe 0.10.x uses importScripts), so a single IIFE bundle.
    format: 'iife',
  },
  plugins: [
    contentSecurityPolicy(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'Depth Photo',
        short_name: 'Depth Photo',
        description: 'Turn a photo into a subtle 3D window that responds to phone tilt. Works offline.',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f1518',
        theme_color: '#0f1518',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // Models and the WASM runtime (~47 MB) are cached on first use rather than at
        // install, so installing stays quick. A guided offline-setup step comes in M4.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/(models|mediapipe)\//.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'depth-photo-models-v1',
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
});
