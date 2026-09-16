import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './app.tsx'
import { db } from './core/db.ts'
import { applyLaunch } from './launch.ts'
import { listenInstall } from './ui/install.ts'
import { listenErrors } from './ui/report.ts'
import { loadScreenNames } from './ui/useScreenNames.ts'
import './styles.css'

/**
 * Сколько ждать своих названий вкладок до первого экрана (Р-26). Без
 * ожидания вкладки мигают названиями по умолчанию; база медлит — экран
 * открывается всё равно, с умолчаниями, и названия подъедут следом.
 */
const NAMES_WAIT_MS = 500

// До первого экрана: «Поделиться» и ярлыки приходят адресом `?text=…`
// и `?go=…`, и роутер должен увидеть уже готовый маршрут (Р-16).
applyLaunch()

// До первого экрана: Chrome присылает событие установки рано и один раз.
listenInstall()

// Тоже до первого экрана: ошибка при отрисовке должна попасть в журнал (Р-66).
listenErrors()

const root = document.getElementById('root')
if (!root) throw new Error('Не найден #root')
const mount = root

void Promise.race([loadScreenNames(), new Promise((done) => setTimeout(done, NAMES_WAIT_MS))]).finally(() => {
  createRoot(mount).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})

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
