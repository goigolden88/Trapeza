import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './ui/Layout.tsx'
import { Today } from './screens/Today.tsx'
import { Settings } from './screens/Settings.tsx'

/**
 * Роутинг через хеш: на GitHub Pages обычные пути дают 404 при обновлении
 * страницы — сервер ищет файл, которого нет. Всё после # до сервера не доходит.
 *
 * Синхронизация здесь не запускается до Этапа 2: `core/sync.ts` скопирован
 * с тестами, но к экранам не подключён (03-План, Этап 0). В Этапе 2 сюда
 * возвращается `startAutoSync` — один раз на приложение, как в «Делу Время».
 */
export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Today />} />
          <Route path="settings" element={<Settings />} />
          {/* Незнакомый адрес — на главный. Так и ярлык на экран, которого
              ещё нет, открывает приложение, а не пустоту. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
