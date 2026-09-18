import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { config } from './app/config.ts'
import { db, sync } from './app/core.ts'
import { watchMerges } from './modules/food/useFood.ts'
import { CoreProvider } from './shared/ui/core.tsx'
import { Layout, type Tab } from './shared/ui/Layout.tsx'
import { Dishes } from './screens/Dishes.tsx'
import { Feed } from './screens/Feed.tsx'
import { Help } from './screens/Help.tsx'
import { Today } from './screens/Today.tsx'
import { Settings } from './screens/Settings.tsx'
import { Week } from './screens/Week.tsx'

/**
 * Роутинг через хеш: на GitHub Pages обычные пути дают 404 при обновлении
 * страницы — сервер ищет файл, которого нет. Всё после # до сервера не доходит.
 *
 * Слияние одноимённых блюд и категорий (Р-12) запускается здесь, одно на
 * приложение: оно пишет в базу, и каждый открытый экран писал бы то же
 * самое. Так же, как у «Делу Время».
 *
 * Синхронизация запускается здесь же, один раз на приложение: проход идёт
 * по таймеру и по событиям и не зависит от того, какой экран открыт. Не
 * настроена — проход ничего не делает и в сеть не ходит. Как в «Делу Время».
 * Пришедшее с сервера пишется с происхождением `remote`, и слияние
 * одноимённых видит его само.
 *
 * Общий интерфейс ядра — шапка, «Настройки синхронизации», сворачивание,
 * «Что нового» — берёт базу и синхронизацию из `CoreProvider` (Я-03
 * «FamilyCore»); вкладки — пропсом: их названия у приложения свои (Р-16).
 */
const TABS: readonly Tab[] = [
  { to: '/', name: 'Сегодня', end: true },
  { to: '/week', name: 'Неделя', end: false },
  { to: '/dishes', name: 'Блюда', end: false },
]

export function App() {
  useEffect(() => sync.startAutoSync(), [])
  useEffect(() => watchMerges(), [])

  return (
    <CoreProvider value={{ config, db, sync }}>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Layout tabs={TABS} />}>
            <Route index element={<Today />} />
            <Route path="week" element={<Week />} />
            <Route path="dishes" element={<Dishes />} />
            <Route path="settings" element={<Settings />} />
            {/* Лента: не вкладка — вход ⌕ в шапке «Сегодня» (Р-33). */}
            <Route path="feed" element={<Feed />} />
            {/* Справка: вход — «?» в шапке «Сегодня». */}
            <Route path="help" element={<Help />} />
            {/* Незнакомый адрес — на главный. Так и ярлык на экран, которого
                ещё нет, открывает приложение, а не пустоту. */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </CoreProvider>
  )
}
