import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const basePath = process.env.VITE_BASE_PATH || '/pollapp/'

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    VitePWA({
    registerType: 'autoUpdate',
    manifest: {
      id: basePath,
      name: 'PollBee',
      short_name: 'PollBee',
      description: 'Mobile Oberfläche für Nextcloud Polls',
      start_url: basePath,
      scope: basePath,
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#2563eb',
      icons: [
        {
          src: 'icons/icon-192.png',
          sizes: '192x192',
          type: 'image/png'
        },
        {
          src: 'icons/icon-512.png',
          sizes: '512x512',
          type: 'image/png'
        },
        {
          src: 'icons/icon-512-maskable.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable'
        }
      ]
    },
    workbox: {
      navigateFallback: `${basePath}index.html`,
      globPatterns: ['**/*.{js,css,html,png,svg,webp}']
    }
  })
  ]
})