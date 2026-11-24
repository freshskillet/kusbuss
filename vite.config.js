import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const { DIGITRANSIT_SUBSCRIPTION_KEY: digitransitKey } = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      vue(),
      vueDevTools(),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      proxy: {
        '/api/tallinn': {
          target: 'https://transport.tallinn.ee',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/tallinn/, ''),
        },
        '/api/digitransit': {
          target: 'https://api.digitransit.fi/routing/v2/finland/gtfs/v1',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/digitransit/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.removeHeader('digitransit-subscription-key')
              if (digitransitKey) proxyReq.setHeader('digitransit-subscription-key', digitransitKey)
            })
          },
        },
      },
    },
  }
})
