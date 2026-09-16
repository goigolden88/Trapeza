/**
 * Вход по адресу: «Поделиться» и ярлыки (Р-16).
 *
 * Android открывает приложение адресом `/DeluVremya/?text=…` — это
 * `share_target` — или `/DeluVremya/?go=inbox` — это ярлык по долгому тапу.
 * До первого экрана адрес переводится во внутренний маршрут хеш-роутинга,
 * а строка адреса чистится: иначе перезагрузка приняла бы текст второй раз.
 *
 * Service worker здесь не участвует: такую навигацию он и так отдаёт из кеша,
 * а без него её отдаёт GitHub Pages. Страница открывается при любом
 * состоянии кеша, и текст доезжает всегда.
 *
 * Здесь же — таблица ярлыков, из которой vite.config.ts собирает манифест:
 * адрес ярлыка и его разбор не могут разойтись. Адреса зашиты
 * в установленное приложение на Android — поменять `go` значит сломать
 * ярлык у каждого, кто уже поставил. Старое значение обязано работать.
 */

/** Параметры `share_target`. Имена — те, что Android подставит в адрес. */
export const SHARE_PARAMS = { title: 'title', text: 'text', url: 'url' } as const

/**
 * Куда ведут ярлыки: значение `go` в адресе → маршрут. «Записать» ставит
 * курсор в поле — захват в два действия (03-План, Этап 3); `write` снимает
 * сам экран, как `shared`. Адрес ярлыка от этого не меняется.
 */
export const GO_ROUTES = { inbox: '/inbox?write=1', time: '/time' } as const

export type Go = keyof typeof GO_ROUTES

/** Ярлыки по долгому тапу на иконке (Р-09). `go: null` — главный экран. */
export const SHORTCUTS: readonly { name: string; go: Go | null }[] = [
  { name: 'Записать', go: 'inbox' },
  { name: 'План дня', go: null },
  { name: 'Учесть время', go: 'time' },
]

/** Адрес ярлыка от корня приложения. */
export function shortcutUrl(base: string, go: Go | null): string {
  return go === null ? base : `${base}?go=${go}`
}

function clean(value: string | null): string {
  return (value ?? '').trim()
}

/**
 * То, чем поделились, одним текстом для входящих.
 *
 * Приложения кладут одно и то же в разные поля: браузер — заголовок
 * в `title`, а ссылку в `text` или `url`; другие — всё в `text`, и заголовок
 * там же, перед ссылкой. Собирается всё, что есть, без повторов: часть,
 * которая уже целиком стоит в другой, второй раз не пишется.
 */
export function sharedText(params: URLSearchParams): string {
  let parts: string[] = []
  for (const name of [SHARE_PARAMS.title, SHARE_PARAMS.text, SHARE_PARAMS.url]) {
    const part = clean(params.get(name))
    if (!part || parts.some((each) => each.includes(part))) continue
    // Собранное раньше, что целиком входит в новую часть, уступает ей место.
    parts = parts.filter((each) => !part.includes(each))
    parts.push(part)
  }
  return parts.join('\n')
}

/**
 * Во что превратить адрес запуска. На входе `location.search`, на выходе —
 * маршрут хеш-роутинга или null, если адрес трогать незачем.
 *
 * Поделились — входящие с текстом; поделились пустым — просто входящие,
 * чтобы нажатие не пропало молча. Ярлык — его экран. Незнакомое `go` —
 * главный экран: ярлык, чей экран пропал или ещё не появился, открывает
 * приложение, а не ошибку.
 */
export function launchRoute(search: string): string | null {
  const params = new URLSearchParams(search)

  const shared = Object.values(SHARE_PARAMS).some((name) => params.has(name))
  if (shared) {
    const text = sharedText(params)
    return text ? `/inbox?${new URLSearchParams({ shared: text }).toString()}` : '/inbox'
  }

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
