/**
 * Повтор приёма (Р-08, пп. 1–2): порядок блюд по частоте и «как вчера».
 *
 * Чистые функции. День — просматриваемый, а не сегодняшний: запись задним
 * числом видит тот порядок, какой был бы в тот день (Р-17).
 */

import { isDateStr, type DateStr } from '../../shared/core/dates.ts'
import type { Dish, Intake, Meal } from '../../app/model.ts'

/** Окно частоты — месяцев до просматриваемого дня (Р-17). */
export const FREQUENCY_MONTHS = 1

/**
 * Начало окна: то же число за `FREQUENCY_MONTHS` месяцев до дня. Числа,
 * которого в том месяце нет, — последний день месяца: от 31 марта —
 * 28 или 29 февраля.
 */
export function windowStart(day: DateStr, months: number = FREQUENCY_MONTHS): DateStr {
  const year = Number(day.slice(0, 4))
  const month = Number(day.slice(5, 7)) - 1 - months
  const date = Number(day.slice(8, 10))
  const last = new Date(year, month + 1, 0).getDate()
  const start = new Date(year, month, Math.min(date, last))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`
}

/** Живые записи приёма раньше дня. Кривая дата не считается. */
function before(intake: readonly Intake[], meal: Meal, day: DateStr): Intake[] {
  return intake.filter((record) => !record.deleted && record.meal === meal && isDateStr(record.date) && record.date < day)
}

/**
 * Блюда приёма по частоте (Р-08, Р-17): по числу дней, в которые блюдо было
 * в этом приёме за окно до дня, сам день не в счёт; при равенстве — по всей
 * истории до дня, затем по названию. Пустое окно само сводится ко всей
 * истории.
 */
export function byFrequency(dishes: readonly Dish[], intake: readonly Intake[], meal: Meal, day: DateStr): Dish[] {
  const { recent, all } = mealFrequency(intake, meal, day)
  const size = (map: ReadonlyMap<string, number>, id: string) => map.get(id) ?? 0
  return [...dishes].sort(
    (a, b) =>
      size(recent, b.id) - size(recent, a.id) ||
      size(all, b.id) - size(all, a.id) ||
      a.name.localeCompare(b.name, 'ru'),
  )
}

/**
 * Частота блюд приёма до дня (Р-17): id блюда → в скольких днях оно было
 * в этом приёме — за окно и за всю историю до дня. `counted` — то, по чему
 * судится «было ли блюдо»: окно, а пустое окно — вся история.
 */
export function mealFrequency(
  intake: readonly Intake[],
  meal: Meal,
  day: DateStr,
): { recent: Map<string, number>; all: Map<string, number>; counted: Map<string, number> } {
  const from = windowStart(day)
  const recent = new Map<string, Set<string>>()
  const all = new Map<string, Set<string>>()
  const add = (map: Map<string, Set<string>>, record: Intake) => {
    const days = map.get(record.dishId) ?? new Set<string>()
    days.add(record.date)
    map.set(record.dishId, days)
  }
  for (const record of before(intake, meal, day)) {
    add(all, record)
    if (record.date >= from) add(recent, record)
  }
  const sizes = (map: Map<string, Set<string>>) => new Map([...map].map(([id, days]) => [id, days.size]))
  const result = { recent: sizes(recent), all: sizes(all) }
  return { ...result, counted: result.recent.size > 0 ? result.recent : result.all }
}

/** Последний такой же приём до дня: его день и записи. Не было — null. */
export function previousMeal(
  intake: readonly Intake[],
  meal: Meal,
  day: DateStr,
): { date: DateStr; records: Intake[] } | null {
  const earlier = before(intake, meal, day)
  if (earlier.length === 0) return null
  const date = earlier.reduce((latest, record) => (record.date > latest ? record.date : latest), '')
  return { date, records: earlier.filter((record) => record.date === date).sort((a, b) => a.id.localeCompare(b.id)) }
}

/** Что поставить в приём: блюдо и порция. */
export type RepeatItem = Pick<Intake, 'dishId' | 'portions' | 'grams'>

/**
 * «Как вчера» без дублей (Р-08): блюда прошлого приёма, которых в этом
 * приёме этого дня ещё нет. Порции и граммы — прошлые; время и заметка —
 * нет: они про тот день.
 */
export function repeatItems(previous: readonly Intake[], current: readonly Intake[]): RepeatItem[] {
  const present = new Set(current.filter((record) => !record.deleted).map((record) => record.dishId))
  const items: RepeatItem[] = []
  for (const record of previous) {
    if (record.deleted || present.has(record.dishId)) continue
    present.add(record.dishId)
    const item: RepeatItem = { dishId: record.dishId }
    if (record.portions !== undefined) item.portions = record.portions
    if (record.grams !== undefined) item.grams = record.grams
    items.push(item)
  }
  return items
}
