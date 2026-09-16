/**
 * Вход по адресу: ярлыки (Р-04, Р-16).
 *
 * Android открывает приложение адресом `/Trapeza/?go=write` — это ярлык
 * по долгому тапу на иконке. До первого экрана адрес переводится во
 * внутренний маршрут хеш-роутинга, а строка адреса чистится: иначе
 * перезагрузка открыла бы ярлык второй раз.
 *
 * Service worker здесь не участвует: такую навигацию он и так отдаёт из кеша,
 * а без него её отдаёт GitHub Pages.
 *
 * Здесь же — таблица ярлыков, из которой vite.config.ts собирает манифест:
 * адрес ярлыка и его разбор не могут разойтись. Адреса зашиты
 * в установленное приложение на Android — поменять `go` значит сломать
 * ярлык у каждого, кто уже поставил. Старое значение обязано работать.
 *
 * «Поделиться» (`share_target`) не объявлено: принимать приложению нечего
 * (Журнал, 15.09.2026). Разбор его в «Делу Время» — тут же, в их `launch.ts`.
 */

/**
 * Куда ведут ярлыки: значение `go` в адресе → маршрут. «Записать» ведёт на
 * «Сегодня», а оно само открывает список текущего приёма по часам (Р-11,
 * Р-16): отдельного маршрута не нужно. Адрес ярлыка не меняется никогда.
 */
export const GO_ROUTES = { write: '/' } as const

export type Go = keyof typeof GO_ROUTES

/** Ярлыки по долгому тапу на иконке (Р-04). `go: null` — главный экран. */
export const SHORTCUTS: readonly { name: string; go: Go | null }[] = [{ name: 'Записать', go: 'write' }]

/** Адрес ярлыка от корня приложения. */
export function shortcutUrl(base: string, go: Go | null): string {
  return go === null ? base : `${base}?go=${go}`
}

/**
 * Во что превратить адрес запуска. На входе `location.search`, на выходе —
 * маршрут хеш-роутинга или null, если адрес трогать незачем.
 *
 * Ярлык — его экран. Незнакомое `go` — главный экран: ярлык, чей экран
 * пропал или ещё не появился, открывает приложение, а не ошибку.
 */
export function launchRoute(search: string): string | null {
  const params = new URLSearchParams(search)

  const go = params.get('go')
  if (go !== null) return Object.hasOwn(GO_ROUTES, go) ? GO_ROUTES[go as Go] : '/'

  return null
}

/**
 * Зовётся из main.tsx до первого экрана. Путь остаётся, `?…` уходит,
 * маршрут встаёт в хеш — ровно тот адрес, который открылся бы изнутри.
 */
export function applyLaunch(): void {
  const route = launchRoute(window.location.search)
  if (route === null) return
  window.history.replaceState(null, '', `${window.location.pathname}#${route}`)
}
