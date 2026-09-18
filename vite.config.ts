/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import { familyVite } from './src/shared/scripts/vite.ts'
import { SHORTCUTS, shortcutUrl } from './src/launch.ts'

// GitHub Pages отдаёт сайт проекта не с корня домена, а по /<имя репозитория>/.
// Репозиторий называется Trapeza → https://goigolden88.github.io/Trapeza/
// Переименуете репозиторий — правьте эту строку, остальное подтянется. См. Р-10.
const BASE = '/Trapeza/'

// Сборка, работник и манифест — фабрикой ядра (Р-48); своё здесь — адрес,
// имя, описание и ярлыки.
export default defineConfig({
  ...familyVite({
    base: BASE,
    name: 'Трапеза',
    description: 'Учёт еды: что съедено и совпала ли неделя с нормами. Работает без сети.',
    // Ярлык «Записать» (Р-04) зашивается в установленное приложение
    // на Android, поэтому объявлен с первого дня (Р-16), а старый адрес
    // обязан работать и после любой правки. Разбор при старте —
    // в src/launch.ts; имена и адреса берутся оттуда же, где их
    // разбирают: разойтись они не могут. «Поделиться» не объявлено —
    // принимать приложению нечего (Р-41).
    shortcuts: SHORTCUTS.map((shortcut) => ({ name: shortcut.name, url: shortcutUrl(BASE, shortcut.go) })),
  }),

  // Тесты ядра гоняет CI ядра; здесь — только свои (Р-52).
  test: {
    exclude: [...configDefaults.exclude, 'src/shared/**'],
  },
})
