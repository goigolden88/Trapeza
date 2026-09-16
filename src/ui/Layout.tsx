import { NavLink, Outlet } from 'react-router-dom'
import { ScrollButtons } from './ScrollButtons.tsx'

/**
 * Нижняя панель: только то, что открывают каждый день. Вкладки прибавляются
 * вместе с экранами, по этапам.
 *
 * «Настроек» здесь нет намеренно, как и в «Дневниках»: в них заходят раз
 * в месяц, и живут они шестерёнкой в шапке «Сегодня».
 *
 * Названия вкладок постоянные: свои названия экранов «Делу Время» (их Р-26)
 * в «Трапезу» не берутся (Р-16).
 */
const TABS: readonly { to: string; name: string; end: boolean }[] = [
  { to: '/', name: 'Сегодня', end: true },
  { to: '/dishes', name: 'Блюда', end: false },
]

export function Layout() {
  return (
    <div className="layout">
      <main className="content">
        <Outlet />
      </main>

      {/* «В начало» и «в конец» (Р-70): видны, пока экран листают. */}
      <ScrollButtons />

      <nav className="tabs">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => (isActive ? 'tab tab--active' : 'tab')}
          >
            {tab.name}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
