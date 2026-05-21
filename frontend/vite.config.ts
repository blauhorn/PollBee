import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const basePath = process.env.VITE_BASE_PATH || '/pollapp/'
const pwaId = process.env.VITE_PWA_ID || basePath
const appName = process.env.VITE_APP_NAME || 'PollBee'
const appShortName = process.env.VITE_APP_SHORT_NAME || 'PollBee'
const themeColor = process.env.VITE_THEME_COLOR || '#2563eb'
const startUrl = process.env.VITE_START_URL || basePath

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifestFilename: 'manifest-family.webmanifest',
      manifest: {
        id: pwaId,
        name: appName,
        short_name: appShortName,
        description: 'Mobile Oberfläche für Nextcloud Polls',
        start_url: startUrl,
        scope: basePath,
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: themeColor,
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: `${basePath}index.html`,
        globPatterns: ['**/*.{js,css,html,png,svg,webp}'],
      },
    }),
  ],
})
