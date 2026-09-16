import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { watchMerges } from './modules/food/useFood.ts'
import { Layout } from './ui/Layout.tsx'
import { Dishes } from './screens/Dishes.tsx'
import { Today } from './screens/Today.tsx'
import { Settings } from './screens/Settings.tsx'

/**
 * Роутинг через хеш: на GitHub Pages обычные пути дают 404 при обновлении
 * страницы — сервер ищет файл, которого нет. Всё после # до сервера не доходит.
 *
 * Слияние одноимённых блюд и категорий (Р-12) запускается здесь, одно на
 * приложение: оно пишет в базу, и каждый открытый экран писал бы то же
 * самое. Так же, как у «Делу Время».
 *
 * Синхронизация здесь не запускается до Этапа 2: `core/sync.ts` скопирован
 * с тестами, но к экранам не подключён (03-План, Этап 0). В Этапе 2 сюда
 * возвращается `startAutoSync` — один раз на приложение, как в «Делу Время».
 */
export function App() {
  useEffect(() => watchMerges(), [])

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Today />} />
          <Route path="dishes" element={<Dishes />} />
          <Route path="settings" element={<Settings />} />
          {/* Незнакомый адрес — на главный. Так и ярлык на экран, которого
              ещё нет, открывает приложение, а не пустоту. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
