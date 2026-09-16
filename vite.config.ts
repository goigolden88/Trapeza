import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { SHORTCUTS, shortcutUrl } from './src/launch.ts'

// GitHub Pages отдаёт сайт проекта не с корня домена, а по /<имя репозитория>/.
// Репозиторий называется Trapeza → https://goigolden88.github.io/Trapeza/
//
// Если base не выставить, сборка пройдёт зелёной, а страница откроется белой:
// все скрипты уйдут в 404. Симптом выглядит как сломанная сборка, причина — здесь.
// Переименуете репозиторий — правьте эту строку, остальное подтянется. См. Р-10.
const BASE = '/Trapeza/'

const THEME = '#1b1c1e'

/** Иконка ярлыка. Без своей Android рисует пустую заглушку. */
const SHORTCUT_ICON = { src: `${BASE}pwa-192x192.png`, sizes: '192x192', type: 'image/png' }

export default defineConfig({
  base: BASE,

  define: {
    // Видно в настройках. Нужно, чтобы проверять обновление на телефоне,
    // не меняя каждый раз видимый текст ради теста.
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },

  plugins: [
    react(),

    VitePWA({
      // Service worker свой, а не собранный плагином: в нём будут
      // напоминания (Р-14), а в сгенерированный код их не положить.
      // Имя на выходе — sw.js, и меняться оно не должно никогда: иначе
      // установленные копии остались бы со старым работником навсегда.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',

      // autoUpdate, а не prompt: новый service worker забирает управление
      // немедленно и перезагружает страницу. Иначе выходит классическая
      // боль PWA — выкатил сборку, а телефон неделю показывает вчерашнюю
      // и ни на что не реагирует. Со своим работником половина этого —
      // skipWaiting и clientsClaim — написана в src/sw.ts руками.
      registerType: 'autoUpdate',

      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],

      manifest: {
        id: BASE,
        name: 'Трапеза',
        short_name: 'Трапеза',
        description: 'Учёт еды: что съедено и совпала ли неделя с нормами. Работает без сети.',
        lang: 'ru',
        // Пути с base. При base '/' манифест соберётся, но иконка
        // на телефон не встанет — установка просто не предложится.
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        background_color: THEME,
        theme_color: THEME,
        icons: [
          { src: `${BASE}pwa-192x192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${BASE}pwa-512x512.png`, sizes: '512x512', type: 'image/png' },
          {
            src: `${BASE}maskable-icon-512x512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],

        // Ярлык «Записать» (Р-04) зашивается в установленное приложение
        // на Android, поэтому объявлен с первого дня (Р-16), а старый адрес
        // обязан работать и после любой правки. Разбор при старте —
        // в src/launch.ts; имена и адреса берутся оттуда же, где их
        // разбирают: разойтись они не могут. «Поделиться» не объявлено —
        // принимать приложению нечего.
        shortcuts: SHORTCUTS.map((shortcut) => ({
          name: shortcut.name,
          url: shortcutUrl(BASE, shortcut.go),
          icons: [SHORTCUT_ICON],
        })),
      },

      // Что уходит в кеш для работы без сети. Подмена навигации на
      // index.html, чистка старых кешей и немедленный захват управления —
      // в src/sw.ts: при generateSW это были опции здесь же.
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
      },

      // Чтобы офлайн проверялся локально, а не только после деплоя.
      devOptions: { enabled: true, type: 'module', navigateFallback: 'index.html' },
    }),
  ],
})
