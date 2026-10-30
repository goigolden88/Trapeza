/**
 * «По дням недели» на «Неделе» (Р-63): какие блюда свойственны каждому дню
 * недели — за несколько полных недель, а не за одну.
 *
 * Чистые функции, без React и без базы.
 */

import { addDays, isDateStr, plural, weekStart, type DateStr, type Period } from '../../shared/core/dates.ts'
import type { Dish, Intake } from '../../app/model.ts'
import { WEEKDAYS_SHORT } from './labels.ts'
import { WEEK_DAYS } from './norms.ts'

/** Окно — столько полных недель, кончая показанной или прошлой. */
export const WEEKDAY_WEEKS = 8

/** Меньше стольких дней учёта этого дня недели в окне — «мало данных». */
export const WEEKDAY_MIN_DAYS = 3

/** В какой доле дней учёта этого дня недели блюдо должно быть. */
export const WEEKDAY_SHARE = 0.5

/** Во сколько раз чаще, чем в среднем в остальные дни недели. */
export const WEEKDAY_RATIO = 2

/** Сколько блюд на день недели, не больше. */
export const WEEKDAY_TOP = 3

export type WeekdayDish = { dishId: string; name: string; /** в скольких днях учёта этого дня недели */ days: number }

export type WeekdayLine = {
  /** 0 — пн … 6 — вс */
  weekday: number
  /** Дней учёта этого дня недели в окне. */
  logged: number
  /** Свойственные блюда; null — мало данных. */
  dishes: WeekdayDish[] | null
}

export type Weekdays = { window: Period; lines: WeekdayLine[] }

/**
 * Окно (Р-63): `WEEKDAY_WEEKS` полных недель, кончая неделей `monday`, если
 * она закончилась к `today`, иначе — прошлой.
 */
export function weekdayWindow(monday: DateStr, today: DateStr): Period {
  const viewed = weekStart(monday)
  const last = addDays(viewed, WEEK_DAYS - 1) < today ? viewed : addDays(viewed, -WEEK_DAYS)
  return { from: addDays(last, -WEEK_DAYS * (WEEKDAY_WEEKS - 1)), to: addDays(last, WEEK_DAYS - 1) }
}

/** Живое блюдо по цепочке слияний (Р-12). Кольцо — где остановились. */
function liveDish(dishes: ReadonlyMap<string, Dish>, id: string): Dish | undefined {
  const seen = new Set<string>()
  let dish = dishes.get(id)
  while (dish?.deleted && dish.movedTo !== undefined && !seen.has(dish.id)) {
    seen.add(dish.id)
    dish = dishes.get(dish.movedTo) ?? dish
  }
  return dish
}

/**
 * Свойственные блюда дней недели (Р-63). День учёта — день с хоть одной
 * записью еды; отметки «Не было» не в счёт. Блюдо свойственно дню недели,
 * если было хотя бы в доле `WEEKDAY_SHARE` его дней учёта в окне и хотя бы
 * в `WEEKDAY_RATIO` раза чаще, чем в среднем в остальные дни недели — по всем
 * их дням учёта вместе. День с блюдом — один раз, порции не взвешиваются.
 * Слитое блюдо — под живым, в архиве — как есть. До `WEEKDAY_TOP` на день:
 * чаще — первым, при равенстве — по названию. Дней учёта меньше
 * `WEEKDAY_MIN_DAYS` — `dishes: null`.
 */
export function weekdayDishes(
  intake: readonly Intake[],
  dishes: ReadonlyMap<string, Dish>,
  monday: DateStr,
  today: DateStr,
): Weekdays {
  const window = weekdayWindow(monday, today)

  // День → живые блюда в нём.
  const byDate = new Map<DateStr, Set<string>>()
  for (const record of intake) {
    if (record.deleted || !isDateStr(record.date) || record.date < window.from || record.date > window.to) continue
    const set = byDate.get(record.date) ?? new Set<string>()
    const dish = liveDish(dishes, record.dishId)
    if (dish) set.add(dish.id)
    byDate.set(record.date, set)
  }

  // По дням недели: дней учёта и дней с каждым блюдом.
  const logged = Array.from({ length: WEEK_DAYS }, () => 0)
  const counts = Array.from({ length: WEEK_DAYS }, () => new Map<string, number>())
  for (let day = 0; day < WEEK_DAYS * WEEKDAY_WEEKS; day++) {
    const set = byDate.get(addDays(window.from, day))
    if (!set) continue
    const weekday = day % WEEK_DAYS
    logged[weekday] = (logged[weekday] ?? 0) + 1
    const own = counts[weekday] as Map<string, number>
    for (const id of set) own.set(id, (own.get(id) ?? 0) + 1)
  }
  const allLogged = logged.reduce((sum, each) => sum + each, 0)

  const lines = logged.map((days, weekday): WeekdayLine => {
    if (days < WEEKDAY_MIN_DAYS) return { weekday, logged: days, dishes: null }
    const otherLogged = allLogged - days
    const found: WeekdayDish[] = []
    for (const [dishId, count] of counts[weekday] ?? []) {
      if (count < days * WEEKDAY_SHARE) continue
      const other = counts.reduce((sum, map, at) => (at === weekday ? sum : sum + (map.get(dishId) ?? 0)), 0)
      // count / days ≥ RATIO × other / otherLogged — без деления.
      if (count * otherLogged < WEEKDAY_RATIO * other * days) continue
      found.push({ dishId, name: dishes.get(dishId)?.name ?? dishId, days: count })
    }
    found.sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, 'ru'))
    return { weekday, logged: days, dishes: found.slice(0, WEEKDAY_TOP) }
  })

  return { window, lines }
}

/** «за 8 недель» — сводка свёрнутого блока. */
export function weekdayWindowText(): string {
  return `за ${WEEKDAY_WEEKS} ${plural(WEEKDAY_WEEKS, ['неделю', 'недели', 'недель'])}`
}

/**
 * Строка дня недели с основанием (Р-01): «пицца — 5 из 8 пн, борщ — 4 из 8
 * пн»; «ничего особенного — учёт в 6 пн из 8»; «мало данных — учёт в 2 пн из 8».
 */
export function weekdayLineText(line: WeekdayLine): string {
  const name = WEEKDAYS_SHORT[line.weekday] ?? ''
  const basis = `учёт в ${line.logged} ${name} из ${WEEKDAY_WEEKS}`
  if (line.dishes === null) return `мало данных — ${basis}`
  if (line.dishes.length === 0) return `ничего особенного — ${basis}`
  return line.dishes.map((dish) => `${dish.name} — ${dish.days} из ${line.logged} ${name}`).join(', ')
}

/** «в 2 раза» — для справки. */
export function ratioText(ratio: number): string {
  return `в ${ratio} ${plural(ratio, ['раз', 'раза', 'раз'])}`
}
