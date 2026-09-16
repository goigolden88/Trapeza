import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { startAutoSync } from './core/sync.ts'
import { Layout } from './ui/Layout.tsx'
import { Today } from './screens/Today.tsx'
import { Feed } from './screens/Feed.tsx'
import { Help } from './screens/Help.tsx'
import { Inbox } from './screens/Inbox.tsx'
import { Month } from './screens/Month.tsx'
import { Review } from './screens/Review.tsx'
import { Settings } from './screens/Settings.tsx'
import { Year } from './screens/Year.tsx'
import { Templates } from './modules/notes/Templates.tsx'
import { Categories } from './modules/time/Categories.tsx'
import { TimeScreen } from './modules/time/TimeScreen.tsx'
import { watchCategoryMerges } from './modules/time/useCatalog.ts'

/**
 * Роутинг через хеш: на GitHub Pages обычные пути дают 404 при обновлении
 * страницы — сервер ищет файл, которого нет. Всё после # до сервера не доходит.
 *
 * Синхронизация запускается здесь, один раз на приложение: проход идёт
 * по таймеру и по событиям и не зависит от того, какой экран открыт.
 * Не настроена — проход ничего не делает и в сеть не ходит.
 *
 * Слияние одноимённых категорий (Р-29) — тоже здесь и тоже одно: оно
 * пишет в базу, и каждый открытый экран писал бы то же самое.
 */
export function App() {
  useEffect(() => startAutoSync(), [])
  useEffect(() => watchCategoryMerges(), [])

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Today />} />
          <Route path="inbox" element={<Inbox />} />
          <Route path="settings" element={<Settings />} />
          {/* Цель ярлыка «Учесть время» (`?go=time`, Р-16): адрес не меняется. */}
          <Route path="time" element={<TimeScreen />} />
          <Route path="time/categories" element={<Categories />} />
          <Route path="templates" element={<Templates />} />
          {/* Обзор недели (Р-41): неделя — в `?week=`, без него — неделя к обзору. */}
          <Route path="review" element={<Review />} />
          {/* Итоги месяца (Р-54): месяц — в `?m=ГГГГ-ММ`, без него — месяц по умолчанию. */}
          <Route path="month" element={<Month />} />
          {/* Итоги года (Р-57): год — в `?y=ГГГГ`. */}
          <Route path="year" element={<Year />} />
          {/* Лента (Р-62): не вкладка — её открывают не каждый день. */}
          <Route path="feed" element={<Feed />} />
          {/* Справка (Р-64): вход — «?» рядом с шестерёнкой на главном. */}
          <Route path="help" element={<Help />} />
          {/* Незнакомый адрес — на главный. Так и ярлык на экран, которого
              ещё нет, открывает приложение, а не пустоту. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
