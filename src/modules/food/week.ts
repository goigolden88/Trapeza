/**
 * Неделя на экране «Неделя» (Р-25): дни, состав, приёмы, калории.
 *
 * Чистые функции. Порции — как в итоге дня (Р-18), калории — с основанием
 * (Р-01); нормы — `norms.ts`.
 */

import { inPeriod, isDateStr, periodDays, plural, weekPeriod, weekStart, type DateStr, type Period } from '../../core/dates.ts'
import type { Category, Dish, Intake, Meal } from '../../core/model.ts'
import { viewedDay } from './day.ts'
import { formatKcal, type KcalSum } from './kcal.ts'
import { MEALS } from './labels.ts'
import { recordPortions, summarize, type DaySummary } from './summary.ts'

/**
 * Какую неделю показать — её понедельник. Из адреса — любой день недели;
 * кривой, пустой или будущий — текущая, как день на «Сегодня».
 */
export function viewedWeek(param: string | null, today: DateStr): DateStr {
  return weekStart(viewedDay(param, today))
}

export type WeekDay = {
  date: DateStr
  /** День ещё не наступил. */
  future: boolean
  records: number
  portions: number
  /** Сколько блюд — записей — в каждом приёме. */
  meals: Record<Meal, number>
}

export type CompositionLine = { id: string; name: string; portions: number; days: number }
export type CompositionGroup = { name: string | null; portions: number; days: number; categories: CompositionLine[] }

export type WeekSummary = Omit<DaySummary, 'groups'> & {
  period: Period
  days: WeekDay[]
  /** Дней с хоть одной записью — дней учёта (Р-24). */
  logged: number
  /** Сколько дней недели наступило. */
  elapsed: number
  /** Состав: у групп и категорий — порции и в скольких днях. */
  groups: CompositionGroup[]
}

/** Итог недели дня `day`. */
export function weekSummary(
  intake: readonly Intake[],
  dishes: ReadonlyMap<string, Dish>,
  categories: readonly Category[],
  day: DateStr,
  today: DateStr,
): WeekSummary {
  const period = weekPeriod(day)
  const records = intake.filter((record) => !record.deleted && inPeriod(record.date, period))
  const summary = summarize(records, dishes, categories)

  // Дни категорий и групп — по живым категориям, как сам итог.
  const known = new Map(categories.filter((each) => !each.deleted).map((each) => [each.id, each]))
  const categoryDays = new Map<string, Set<DateStr>>()
  const groupDays = new Map<string, Set<DateStr>>()
  const add = (map: Map<string, Set<DateStr>>, key: string, date: DateStr) => {
    const set = map.get(key) ?? new Set<DateStr>()
    set.add(date)
    map.set(key, set)
  }
  for (const record of records) {
    const categoryId = dishes.get(record.dishId)?.categoryId
    const category = categoryId === undefined ? undefined : known.get(categoryId)
    if (!category) continue
    add(categoryDays, category.id, record.date)
    if (category.group !== undefined) add(groupDays, category.group, record.date)
  }

  const groups = summary.groups.map((group) => {
    const lines = group.categories.map((line) => ({ ...line, days: categoryDays.get(line.id)?.size ?? 0 }))
    const days = group.name === null ? (lines[0]?.days ?? 0) : (groupDays.get(group.name)?.size ?? 0)
    return { name: group.name, portions: group.portions, days, categories: lines }
  })

  const days = periodDays(period).map((date) => {
    const own = records.filter((record) => record.date === date)
    const meals = Object.fromEntries(MEALS.map((meal) => [meal, 0])) as Record<Meal, number>
    let portions = 0
    for (const record of own) {
      if (record.meal in meals) meals[record.meal] += 1
      portions += recordPortions(record, dishes.get(record.dishId)).portions
    }
    return { date, future: date > today, records: own.length, portions, meals }
  })

  return {
    ...summary,
    groups,
    period,
    days,
    logged: days.filter((each) => each.records > 0).length,
    elapsed: days.filter((each) => !each.future).length,
  }
}

/** «Учёт в 6 днях из 7» — основание недели (Р-01). У идущей — из наступивших. */
export function loggedText(summary: Pick<WeekSummary, 'logged' | 'elapsed'>): string {
  return `Учёт в ${summary.logged} ${plural(summary.logged, ['дне', 'днях', 'днях'])} из ${summary.elapsed}`
}

/**
 * Калории недели в среднем за день учёта, с основанием (Р-01): «в среднем
 * 1 850 ккал в день — за 6 дней учёта, по 40 из 45 записей». Ккал не
 * известны ни у одной — так и сказано. Записей нет — пусто.
 */
export function weekKcalText(kcal: KcalSum, logged: number): string {
  if (kcal.total === 0 || logged === 0) return ''
  const of = `из ${kcal.total} ${plural(kcal.total, ['записи', 'записей', 'записей'])}`
  if (kcal.counted === 0) return `ккал не известны ни у одной ${of}`
  const days = `${logged} ${plural(logged, ['день', 'дня', 'дней'])}`
  return `в среднем ${formatKcal(kcal.kcal / logged)} ккал в день — за ${days} учёта, по ${kcal.counted} ${of}`
}

/** Адрес дня на «Сегодня» — для тапа по столбику. Кривой день адреса не получает. */
export function dayHref(date: string): string | undefined {
  return isDateStr(date) ? `#/?day=${date}` : undefined
}
