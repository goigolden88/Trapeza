/**
 * «Как обычно?» (Р-29): о каких приёмах спросить при открытии и что
 * предложить. Здесь же отметка «Не было» — её видит и напоминание (Р-30).
 *
 * Чистые функции, без React и без базы.
 */

import { addDays, isDateStr, plural, type DateStr } from '../../core/dates.ts'
import type { Dish, Intake, Meal, Template } from '../../core/model.ts'
import { amountText } from './forms.ts'
import { MEALS } from './labels.ts'
import type { RepeatItem } from './repeat.ts'
import { itemsForMeal, templatesOf } from './templates.ts'

/** Приёмы, о которых спрашивают и напоминают: перекус без часов — никогда. */
export const MAIN_MEALS: readonly Meal[] = ['breakfast', 'lunch', 'dinner']

/** По скольким последним записанным таким приёмам судится «обычное». */
export const USUAL_MEALS = 20

/** В какой доле этих приёмов блюдо должно быть, чтобы считаться обычным. */
export const USUAL_SHARE = 0.5

/** Ключ настройки устройства: отметки «Не было» (02-Архитектура). */
export const SKIPPED_KEY = 'usualSkipped'

// ─── «Не было» ─────────────────────────────────────────────────────────────

/** Отметка «Не было»: `ГГГГ-ММ-ДД:приём`. */
export function skipKey(date: DateStr, meal: Meal): string {
  return `${date}:${meal}`
}

/**
 * Отметки из настройки — только за сегодня и вчера (Р-29): старые ни о чём
 * не спрашивают и отбрасываются при следующей записи. Мусор — мимо.
 */
export function readSkipped(stored: unknown, today: DateStr): string[] {
  if (!Array.isArray(stored)) return []
  const days = new Set([today, addDays(today, -1)])
  return [
    ...new Set(
      stored.filter(
        (each): each is string =>
          typeof each === 'string' && days.has(each.slice(0, 10)) && MEALS.includes(each.slice(11) as Meal),
      ),
    ),
  ]
}

/** Отметки с новой — для записи в настройку. */
export function withSkipped(stored: unknown, today: DateStr, date: DateStr, meal: Meal): string[] {
  return readSkipped([...readSkipped(stored, today), skipKey(date, meal)], today)
}

// ─── О чём спросить ────────────────────────────────────────────────────────

export type Unanswered = { date: DateStr; meal: Meal }

/** Приёмы дня без живых записей и без отметки «Не было» — в порядке `meals`. Его же зовёт напоминание (Р-30). */
export function missedMeals(
  intake: readonly Intake[],
  date: DateStr,
  meals: readonly Meal[],
  skipped: readonly string[],
): Meal[] {
  return meals.filter(
    (meal) =>
      !skipped.includes(skipKey(date, meal)) &&
      !intake.some((record) => !record.deleted && record.date === date && record.meal === meal),
  )
}

/**
 * О каких приёмах спросить (Р-29): вчера — завтрак, обед и ужин без записей;
 * сегодня — те же до текущего приёма. Отмеченные «Не было» — нет. Вчерашние
 * первыми: по порядку дня.
 */
export function unansweredMeals(
  intake: readonly Intake[],
  today: DateStr,
  current: Meal,
  skipped: readonly string[],
): Unanswered[] {
  const yesterday = addDays(today, -1)
  const before = MAIN_MEALS.slice(0, Math.max(0, MAIN_MEALS.indexOf(current)))
  return [
    ...missedMeals(intake, yesterday, MAIN_MEALS, skipped).map((meal) => ({ date: yesterday, meal })),
    ...missedMeals(intake, today, before, skipped).map((meal) => ({ date: today, meal })),
  ]
}

// ─── Что предложить ────────────────────────────────────────────────────────

export type Usual = {
  items: RepeatItem[]
  /** По скольким приёмам судилось: «по 20 завтракам». */
  meals: number
}

/**
 * Обычные блюда приёма (Р-29): бывшие хотя бы в доле `share` из последних
 * `size` записанных таких приёмов до дня. Порядок — чаще первым, при
 * равенстве — по id. Порция — та, что записывалась чаще; при равенстве —
 * поздняя. Нет ни одного — null.
 */
export function usualDishes(
  intake: readonly Intake[],
  meal: Meal,
  day: DateStr,
  size: number = USUAL_MEALS,
  share: number = USUAL_SHARE,
): Usual | null {
  const byDate = new Map<string, Intake[]>()
  for (const record of intake) {
    if (record.deleted || record.meal !== meal || !isDateStr(record.date) || record.date >= day) continue
    byDate.set(record.date, [...(byDate.get(record.date) ?? []), record])
  }
  const dates = [...byDate.keys()].sort().slice(-size)
  if (dates.length === 0) return null

  // Блюдо → дни и порции по дням, от ранних к поздним.
  const seen = new Map<string, { days: number; amounts: string[] }>()
  for (const date of dates) {
    const records = (byDate.get(date) ?? []).sort((a, b) => a.id.localeCompare(b.id))
    const once = new Set<string>()
    for (const record of records) {
      // Одно блюдо дважды в приёме — записи двух устройств (Р-20): день один.
      if (once.has(record.dishId)) continue
      once.add(record.dishId)
      const entry = seen.get(record.dishId) ?? { days: 0, amounts: [] }
      entry.days += 1
      entry.amounts.push(JSON.stringify([record.portions ?? null, record.grams ?? null]))
      seen.set(record.dishId, entry)
    }
  }

  const items = [...seen]
    .filter(([, entry]) => entry.days >= dates.length * share)
    .sort(([a, x], [b, y]) => y.days - x.days || a.localeCompare(b))
    .map(([dishId, entry]): RepeatItem => {
      const [portions, grams] = JSON.parse(commonest(entry.amounts)) as [number | null, number | null]
      return { dishId, ...(portions !== null ? { portions } : {}), ...(grams !== null ? { grams } : {}) }
    })
  return items.length === 0 ? null : { items, meals: dates.length }
}

/** Самое частое значение; при равенстве — позднее. Список не пуст. */
function commonest(values: readonly string[]): string {
  const counts = new Map<string, number>()
  let best = values[0] ?? ''
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1
    counts.set(value, count)
    if (count >= (counts.get(best) ?? 0)) best = value
  }
  return best
}

export type Offer = {
  items: RepeatItem[]
  /** Откуда: шаблон приёма, приём из шаблона дня или обычные блюда. */
  source: { kind: 'template' | 'day'; name: string } | { kind: 'usual'; meals: number }
}

function liveItems(items: readonly RepeatItem[], dishes: ReadonlyMap<string, Dish>): RepeatItem[] {
  return items.filter((item) => {
    const dish = dishes.get(item.dishId)
    return dish !== undefined && !dish.deleted
  })
}

function strip(items: ReturnType<typeof itemsForMeal>): RepeatItem[] {
  return items.map(({ meal: _meal, ...item }) => item)
}

/**
 * Что предложить приёму (Р-29) — первое, что есть: первый шаблон приёма,
 * этот приём из первого шаблона дня, обычные блюда. Блюда, которых
 * в справочнике нет, не предлагаются. Нечего — null.
 */
export function usualOffer(
  meal: Meal,
  day: DateStr,
  templates: readonly Template[],
  intake: readonly Intake[],
  dishes: ReadonlyMap<string, Dish>,
): Offer | null {
  const own = templatesOf(templates, meal)[0]
  if (own) {
    const items = liveItems(strip(itemsForMeal(own, meal)), dishes)
    if (items.length > 0) return { items, source: { kind: 'template', name: own.name } }
  }
  const whole = templatesOf(templates, 'day')[0]
  if (whole) {
    const items = liveItems(strip(itemsForMeal(whole, meal)), dishes)
    if (items.length > 0) return { items, source: { kind: 'day', name: whole.name } }
  }
  const usual = usualDishes(intake, meal, day)
  if (usual) {
    const items = liveItems(usual.items, dishes)
    if (items.length > 0) return { items, source: { kind: 'usual', meals: usual.meals } }
  }
  return null
}

// После «по»: «по 1 завтраку», «по 20 завтракам».
const MEALS_BY: { readonly [M in Meal]: [string, string, string] } = {
  breakfast: ['завтраку', 'завтракам', 'завтракам'],
  lunch: ['обеду', 'обедам', 'обедам'],
  dinner: ['ужину', 'ужинам', 'ужинам'],
  snack: ['перекусу', 'перекусам', 'перекусам'],
}

/**
 * Кнопка предложения (Р-29) — что запишется и откуда: «Как обычно: Каша,
 * Компот — по 20 завтракам» или ««Обычный завтрак»: Каша 2 порции».
 */
export function offerText(offer: Offer, meal: Meal, dishes: ReadonlyMap<string, Dish>): string {
  const names = offer.items
    .map((item) => {
      const amount = amountText(item)
      return `${dishes.get(item.dishId)?.name ?? 'блюдо'}${amount ? ` ${amount}` : ''}`
    })
    .join(', ')
  if (offer.source.kind !== 'usual') return `«${offer.source.name}»: ${names}`
  const { meals } = offer.source
  return `Как обычно: ${names} — по ${meals} ${plural(meals, MEALS_BY[meal])}`
}
