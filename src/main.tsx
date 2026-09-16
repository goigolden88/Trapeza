import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './app.tsx'
import { db } from './core/db.ts'
import { applyLaunch } from './launch.ts'
import { listenInstall } from './ui/install.ts'
import { listenErrors } from './ui/report.ts'
import './styles.css'

// До первого экрана: ярлык приходит адресом `?go=…`, и роутер должен
// увидеть уже готовый маршрут (Р-16).
applyLaunch()

// До первого экрана: Chrome присылает событие установки рано и один раз.
listenInstall()

// Тоже до первого экрана: ошибка при отрисовке должна попасть в журнал (Р-66).
listenErrors()

const root = document.getElementById('root')
if (!root) throw new Error('Не найден #root')

// Своих названий вкладок, которых «Делу Время» ждёт здесь до первого
// экрана (их Р-26), в «Трапезе» нет (Р-16) — рисуется сразу.
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Постоянное хранилище: без него браузер вправе стереть базу при
// нехватке места. Отказ — не ошибка, работать можно и так.
void db.persist()

registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    // Установленное приложение на телефоне может неделями не запускаться
    // с нуля. Без периодической проверки оно не узнает о новой сборке:
    // запрос на обновление уходит только при холодном старте.
    if (!registration) return
    setInterval(
      () => {
        void registration.update()
      },
      60 * 60 * 1000,
    )
  },
})
