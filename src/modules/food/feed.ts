/**
 * Еда в ленте и в выгрузке markdown (02-Архитектура, «Реестр видов записей»).
 *
 * В ленте — строка на день, а не на запись: записей шесть–восемь в день,
 * и поштучно лента утонула бы в компоте. Строка — приёмы с блюдами, под
 * ней — порции дня и калории с основанием (Р-01). Тап — день на «Сегодня»,
 * где записи правятся. Так же, как учёт времени «Делу Время» (их Р-58).
 *
 * Чистые функции, без React и без базы.
 */

import {
  formatDate,
  inPeriod,
  isDateStr,
  monthPeriod,
  plural,
  weekStart,
  daysBetween,
  type DateStr,
  type Period,
} from '../../shared/core/dates.ts'
import { escapeMarkdown as md, feedHeading, type FeedItem } from '../../shared/core/feed.ts'
import type { Category, Dish, Intake, Meal } from '../../app/model.ts'
import { kcalText, sumKcal } from './kcal.ts'
import { FORMS, formatNumber, MEAL_NAMES, MEALS, portions, WEEKDAYS_SHORT } from './labels.ts'
import { recordPortions, summarize } from './summary.ts'

/** Имя блюда записи; блюда нет вовсе — так и сказано. Надгробие — своим последним именем. */
export const MISSING_DISH = 'блюдо удалено'

/** Живые записи по дням. Кривая дата — своим днём, как лежит: запись не теряется. */
function byDay(intake: readonly Intake[]): Map<string, Intake[]> {
  const found = new Map<string, Intake[]>()
  for (const record of intake) {
    if (record.deleted) continue
    const list = found.get(record.date)
    if (list) list.push(record)
    else found.set(record.date, [record])
  }
  return found
}

/** Записи дня по приёмам в порядке дня; внутри — в порядке записи. Пустые приёмы не в счёт. */
function mealsOf(records: readonly Intake[]): [Meal, Intake[]][] {
  return MEALS.flatMap((meal): [Meal, Intake[]][] => {
    const list = records.filter((record) => record.meal === meal).sort((a, b) => a.id.localeCompare(b.id))
    return list.length > 0 ? [[meal, list]] : []
  })
}

/** «Компот ×2», «Суп 300 г», «Каша». Одна порция — без числа. */
function amountOf(record: Intake): string {
  if (record.grams !== undefined) return ` ${formatNumber(record.grams)} г`
  const count = record.portions ?? 1
  return count === 1 ? '' : ` ×${formatNumber(count)}`
}

function dishName(dishes: ReadonlyMap<string, Dish>, record: Intake): string {
  return dishes.get(record.dishId)?.name ?? MISSING_DISH
}

/** Порций в записях — как итог дня (Р-18). */
function portionsOf(records: readonly Intake[], dishes: ReadonlyMap<string, Dish>): number {
  return records.reduce((sum, record) => sum + recordPortions(record, dishes.get(record.dishId)).portions, 0)
}

/** «Завтрак: Каша, Компот ×2 · Обед: Суп обычный». */
export function mealsLine(records: readonly Intake[], dishes: ReadonlyMap<string, Dish>): string {
  return mealsOf(records)
    .map(([meal, list]) => `${MEAL_NAMES[meal]}: ${list.map((record) => dishName(dishes, record) + amountOf(record)).join(', ')}`)
    .join(' · ')
}

/**
 * Итог под строкой: «8 порций · 1 850 ккал по 5 из 7 записей». Калории —
 * только если известны хоть у одной записи: иначе в каждой строке истории
 * стояло бы «не известны».
 */
export function dayDetail(records: readonly Intake[], dishes: ReadonlyMap<string, Dish>): string {
  const kcal = sumKcal(records, dishes)
  const parts = [portions(portionsOf(records, dishes))]
  if (kcal.counted > 0) parts.push(kcalText(kcal))
  return parts.join(' · ')
}

/** Куда ведёт день: сегодняшний — главный экран без параметра, как ярлык; прошлый — `?day=`. */
export function dayLink(date: DateStr, today: DateStr): string {
  return date === today ? '/' : `/?day=${date}`
}

export function intakeFeed(
  intake: readonly Intake[],
  dishList: readonly Dish[],
  categories: readonly Category[],
  today: DateStr,
): FeedItem[] {
  const dishes = new Map(dishList.map((dish) => [dish.id, dish]))
  return [...byDay(intake)].map(([date, records]): FeedItem => {
    const summary = summarize(records, dishes, categories)
    // Ищутся и категории с группами — «сладости март», — и заметки записей.
    const extra = [
      ...summary.groups.flatMap((group) => [group.name ?? '', ...group.categories.map((line) => line.name)]),
      ...records.flatMap((record) => (record.note ? [record.note] : [])),
    ]
      .filter(Boolean)
      .join(' ')
    return {
      kind: 'intake',
      id: `day:${date}`,
      date,
      title: mealsLine(records, dishes),
      detail: dayDetail(records, dishes),
      ...(extra ? { extra } : {}),
      ...(isDateStr(date) ? { link: dayLink(date, today) } : {}),
    }
  })
}

// ─── Markdown ──────────────────────────────────────────────────────────────

/** «02.03, пн» — день в разделе месяца. */
function dayLabel(date: DateStr): string {
  const weekday = WEEKDAYS_SHORT[daysBetween(weekStart(date), date)] ?? ''
  return `${formatDate(date).slice(0, 5)}, ${weekday}`
}

/** «Каша ×2 (09:30, в кафе)» — блюдо с порцией, временем и заметкой. */
function recordText(record: Intake, dishes: ReadonlyMap<string, Dish>): string {
  const extras = [record.at ?? '', record.note ? md(record.note) : ''].filter(Boolean)
  return `${md(dishName(dishes, record))}${amountOf(record)}${extras.length > 0 ? ` (${extras.join(', ')})` : ''}`
}

function dayLines(head: string, records: readonly Intake[], dishes: ReadonlyMap<string, Dish>): string[] {
  return [
    `- ${head} — ${portions(portionsOf(records, dishes))}`,
    ...mealsOf(records).map(
      ([meal, list]) => `  - ${MEAL_NAMES[meal]}: ${list.map((record) => recordText(record, dishes)).join(', ')}`,
    ),
  ]
}

/** Итог месяца с основанием: «Учёт в 19 днях · 162 порции · ккал не известны ни у одной из 170 записей». */
function monthLine(days: number, records: readonly Intake[], dishes: ReadonlyMap<string, Dish>): string {
  const kcal = kcalText(sumKcal(records, dishes))
  return [
    `Учёт в ${days} ${plural(days, ['дне', 'днях', 'днях'])}`,
    portions(portionsOf(records, dishes)),
    `${records.length} ${plural(records.length, FORMS.record)}`,
    ...(kcal ? [kcal] : []),
  ].join(' · ')
}

/**
 * Раздел выгрузки — дневником: месяц с итогом и основанием, под ним день
 * строкой с порциями и приёмы подпунктами. Месяцы от старых к новым; записи
 * с кривой датой — в конце. Заголовок раздела ставит реестр.
 */
export function intakeMarkdown(
  intake: readonly Intake[],
  dishList: readonly Dish[],
  /** За период — по дню записи; кривая дата в период не попадает (Р-34). */
  period: Period | null = null,
): string {
  const dishes = new Map(dishList.map((dish) => [dish.id, dish]))
  const days = byDay(period === null ? intake : intake.filter((record) => inPeriod(record.date, period)))
  if (days.size === 0) return 'Записей нет.'

  const dated = [...days.keys()].filter(isDateStr).sort()
  const crooked = [...days.keys()].filter((date) => !isDateStr(date)).sort()

  const lines: string[] = []
  for (let index = 0; index < dated.length; ) {
    const month = (dated[index] as DateStr).slice(0, 7)
    const inMonth = dated.filter((date) => inPeriod(date, monthPeriod(month)))
    const records = inMonth.flatMap((date) => days.get(date) ?? [])
    if (lines.length > 0) lines.push('')
    lines.push(`### ${feedHeading(month)}`, '', monthLine(inMonth.length, records, dishes), '')
    for (const date of inMonth) lines.push(...dayLines(dayLabel(date), days.get(date) ?? [], dishes))
    index += inMonth.length
  }

  if (crooked.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push('### Дата не разобрана', '')
    for (const date of crooked) lines.push(...dayLines(`«${md(date)}»`, days.get(date) ?? [], dishes))
  }

  return lines.join('\n')
}
