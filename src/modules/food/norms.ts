/**
 * Нормы недели над наборами категорий (Р-13) и их история (Р-24).
 *
 * «Раз» — день, в котором есть запись хоть одной категории нормы. День
 * недели без единой записи еды — неизвестен: в нём могло быть что угодно,
 * и итог недели считается только тогда, когда от неизвестных дней не
 * зависит. Образец — `modules/time/period.ts` «Делу Время» (их Р-45, Р-53,
 * Р-56); там норма — поле категории, здесь — своя запись.
 *
 * Чистые функции, без React и без базы.
 */

import { addDays, isDateStr, periodDays, weekPeriod, weekStart, type DateStr, type Period } from '../../core/dates.ts'
import { numberOf } from '../../core/importing.ts'
import type { Category, Dish, Intake, Norm } from '../../core/model.ts'
import { cleanName } from './names.ts'

/** Дней в неделе: «не меньше» — до стольких. */
export const WEEK_DAYS = 7

/** Сколько недель в счёт нужно, чтобы показать историю (Р-13, их Р-53). */
export const NORM_MIN_WEEKS = 3

/** Сколько последних недель в счёт — малыми столбиками у нормы (Р-25). */
export const NORM_BARS_WEEKS = 8

/** Нормы по порядку, без удалённых. */
export function activeNorms(norms: readonly Norm[]): Norm[] {
  return norms
    .filter((norm) => !norm.deleted)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ru'))
}

// ─── Дни учёта ─────────────────────────────────────────────────────────────

/** Какие дни учтены и какие категории в каждом были. Строится один раз на экран. */
export type DayIndex = {
  /** День → категории его записей. Есть ключ — день учёта, даже если категорий нет. */
  byDay: ReadonlyMap<DateStr, ReadonlySet<string>>
  /** Самый ранний день учёта; записей нет — null. */
  first: DateStr | null
}

/**
 * Индекс дней учёта (Р-24): день с хоть одной живой записью. Категория
 * записи — категория её блюда, архивная тоже: записи настоящие (Р-25).
 * Кривая дата в индекс не идёт — в неделю она всё равно не попадёт.
 */
export function indexDays(intake: readonly Intake[], dishes: ReadonlyMap<string, Dish>): DayIndex {
  const byDay = new Map<DateStr, Set<string>>()
  let first: DateStr | null = null
  for (const record of intake) {
    if (record.deleted || !isDateStr(record.date)) continue
    let categories = byDay.get(record.date)
    if (!categories) {
      categories = new Set()
      byDay.set(record.date, categories)
      if (first === null || record.date < first) first = record.date
    }
    const categoryId = dishes.get(record.dishId)?.categoryId
    if (categoryId !== undefined) categories.add(categoryId)
  }
  return { byDay, first }
}

// ─── Итог недели ───────────────────────────────────────────────────────────

/** Выполнена, провалена или не ясна: зависит от дней без записей (Р-24). */
export type Verdict = 'met' | 'failed' | 'open'

type Rules = Pick<Norm, 'minDays' | 'maxDays'>

/**
 * Итог по дням нормы `days` и неизвестным дням `unknown`. «Не больше»:
 * провалена, если уже больше; выполнена, если и со всеми неизвестными не
 * больше. «Не меньше» — зеркально. Одно правило провалено — провалена;
 * оба выполнены — выполнена; иначе не ясна.
 */
export function verdictOf(rules: Rules, days: number, unknown: number): Verdict {
  const verdicts: Verdict[] = []
  if (rules.minDays !== undefined) {
    verdicts.push(days >= rules.minDays ? 'met' : days + unknown < rules.minDays ? 'failed' : 'open')
  }
  if (rules.maxDays !== undefined) {
    verdicts.push(days > rules.maxDays ? 'failed' : days + unknown <= rules.maxDays ? 'met' : 'open')
  }
  if (verdicts.includes('failed')) return 'failed'
  return verdicts.length > 0 && verdicts.every((each) => each === 'met') ? 'met' : 'open'
}

export type WeekCheck = {
  week: Period
  /** Дней с записью категории нормы. */
  days: number
  /** Дней недели без единой записи — прошедших и будущих. */
  unknown: number
  verdict: Verdict
}

/** Норма за неделю дня `day`. Будущие дни неизвестны так же, как забытые. */
export function checkWeek(norm: Norm, index: DayIndex, day: DateStr): WeekCheck {
  const week = weekPeriod(day)
  let days = 0
  let unknown = 0
  for (const date of periodDays(week)) {
    const categories = index.byDay.get(date)
    if (!categories) unknown += 1
    else if (norm.categoryIds.some((id) => categories.has(id))) days += 1
  }
  return { week, days, unknown, verdict: verdictOf(norm, days, unknown) }
}

// ─── История ───────────────────────────────────────────────────────────────

export type NormHistory = {
  /** С какого дня история: `since` нормы; нет — вся (Р-13). */
  since: DateStr | null
  /** Недели в счёт, старые первыми. */
  weeks: WeekCheck[]
  /** Сколько из них выполнено. */
  kept: number
  /** Закончившихся недель с записями, чей исход не ясен. */
  open: number
  /** Недель в счёт хватает, чтобы назвать «выполнена в N из M» (Р-13). */
  enough: boolean
}

/** Понедельник не раньше дня: неделя, начатая до `since`, не судится (их Р-56). */
function mondayFrom(day: DateStr): DateStr {
  const monday = weekStart(day)
  return monday === day ? day : addDays(monday, 7)
}

/**
 * История нормы до недели дня `day` включительно (Р-24). В счёт —
 * закончившиеся недели, воскресенье которых раньше `today`, с понедельника
 * не раньше `since`, с ясным исходом. Неделя без единой записи — без учёта:
 * не в счёте и не среди неясных.
 */
export function normHistory(norm: Norm, index: DayIndex, day: DateStr, today: DateStr): NormHistory {
  const since = norm.since !== undefined && isDateStr(norm.since) ? norm.since : null
  const empty: NormHistory = { since, weeks: [], kept: 0, open: 0, enough: false }
  if (index.first === null) return empty

  // Недели до первой записи пусты — начинать с них незачем.
  const firstWeek = weekStart(index.first)
  const start = since === null || mondayFrom(since) < firstWeek ? firstWeek : mondayFrom(since)
  const last = weekPeriod(day).from
  const weeks: WeekCheck[] = []
  let open = 0
  for (let monday = start; monday <= last; monday = addDays(monday, 7)) {
    const check = checkWeek(norm, index, monday)
    if (check.week.to >= today) break
    if (check.unknown === WEEK_DAYS) continue
    if (check.verdict === 'open') open += 1
    else weeks.push(check)
  }
  return {
    since,
    weeks,
    kept: weeks.filter((check) => check.verdict === 'met').length,
    open,
    enough: weeks.length >= NORM_MIN_WEEKS,
  }
}

// ─── Отклик после записи ───────────────────────────────────────────────────

export type Touch = {
  norm: Norm
  /** Неделя дня записи — уже с ней. */
  check: WeekCheck
  /** День и до записи был в счёте нормы: число дней не изменилось. */
  already: boolean
}

/**
 * Нормы, которые задела запись (Р-25): категория её блюда стоит в норме.
 * `intake` — записи до неё; запись с тем же id заменяется.
 */
export function touchedNorms(
  norms: readonly Norm[],
  intake: readonly Intake[],
  dishes: ReadonlyMap<string, Dish>,
  record: Intake,
): Touch[] {
  const categoryId = dishes.get(record.dishId)?.categoryId
  if (categoryId === undefined) return []
  const list = activeNorms(norms).filter((norm) => norm.categoryIds.includes(categoryId))
  if (list.length === 0) return []

  // До — с прежней версией записи: прибавка порции день не прибавляет.
  const before = indexDays(intake, dishes)
  const after = indexDays([...intake.filter((each) => each.id !== record.id), record], dishes)
  const had = before.byDay.get(record.date)
  return list.map((norm) => ({
    norm,
    check: checkWeek(norm, after, record.date),
    already: had !== undefined && norm.categoryIds.some((id) => had.has(id)),
  }))
}

// ─── Форма нормы ───────────────────────────────────────────────────────────

/** «Не меньше» — хотя бы день: ноль выполнен всегда. */
export const MIN_NORM_DAYS = 1

/** «Не больше» — от нуля до шести дней: предел в семь ничего не ограничивает (Р-24). */
export const MIN_LIMIT_DAYS = 0
export const MAX_LIMIT_DAYS = WEEK_DAYS - 1

/** Поля формы — строками, как их видит человек. */
export type NormInput = { name: string; categoryIds: string[]; minDays: string; maxDays: string; since: string }

export function normInput(norm?: Norm): NormInput {
  return {
    name: norm?.name ?? '',
    categoryIds: norm ? [...norm.categoryIds] : [],
    minDays: norm?.minDays === undefined ? '' : String(norm.minDays),
    maxDays: norm?.maxDays === undefined ? '' : String(norm.maxDays),
    since: norm?.since ?? '',
  }
}

export type NormChanges = {
  name: string
  categoryIds: string[]
  minDays: number | undefined
  maxDays: number | undefined
  since: DateStr | undefined
}

/** Целое в пределах из поля. Пусто — правила нет; кривое — `false`. */
function readDays(text: string, min: number, max: number): number | undefined | false {
  if (!text.trim()) return undefined
  const value = numberOf(text)
  return value !== null && Number.isInteger(value) && value >= min && value <= max ? value : false
}

/**
 * Форма нормы → свойства или причина отказа. Категории — живые, в порядке
 * справочника; удалённая после открытия формы — отказ.
 */
export function readNorm(
  input: NormInput,
  categories: readonly Category[],
  today: DateStr,
): { changes: NormChanges } | { problem: string } {
  const name = cleanName(input.name)
  if (!name) return { problem: 'Нужно название' }

  const live = categories.filter((category) => !category.deleted)
  const chosen = new Set(input.categoryIds)
  if (chosen.size === 0) return { problem: 'Отметьте хотя бы одну категорию' }
  if ([...chosen].some((id) => !live.some((category) => category.id === id))) {
    return { problem: 'Одной из отмеченных категорий больше нет — снимите её' }
  }

  const minDays = readDays(input.minDays, MIN_NORM_DAYS, WEEK_DAYS)
  if (minDays === false) return { problem: `«Не меньше» — целое число дней от ${MIN_NORM_DAYS} до ${WEEK_DAYS}` }
  const maxDays = readDays(input.maxDays, MIN_LIMIT_DAYS, MAX_LIMIT_DAYS)
  if (maxDays === false) {
    return { problem: `«Не больше» — целое число дней от ${MIN_LIMIT_DAYS} до ${MAX_LIMIT_DAYS}` }
  }
  if (minDays === undefined && maxDays === undefined) return { problem: 'Нужно правило: «не меньше» или «не больше»' }
  if (minDays !== undefined && maxDays !== undefined && minDays > maxDays) {
    return { problem: '«Не меньше» больше, чем «не больше»' }
  }

  const sinceText = input.since.trim()
  if (sinceText && (!isDateStr(sinceText) || sinceText > today)) {
    return { problem: '«С какого дня» — прошедший день или пусто' }
  }

  const order = new Map(live.map((category) => [category.id, category.order]))
  const categoryIds = [...chosen].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0) || a.localeCompare(b))
  return { changes: { name, categoryIds, minDays, maxDays, since: sinceText || undefined } }
}

/** Норма с правками формы. Снятые поля уходят из записи; незнакомые поля остаются. */
export function applyNorm(norm: Norm, changes: NormChanges, updatedAt: string): Norm {
  const next: Norm = { ...norm, updatedAt, name: changes.name, categoryIds: changes.categoryIds }
  for (const key of ['minDays', 'maxDays', 'since'] as const) {
    const value = changes[key]
    if (value === undefined) delete next[key]
    else (next as Record<typeof key, unknown>)[key] = value
  }
  return next
}

/** Новая норма — последней по порядку. */
export function createNorm(norms: readonly Norm[], changes: NormChanges, id: string, updatedAt: string): Norm {
  const order = norms.filter((norm) => !norm.deleted).reduce((max, norm) => Math.max(max, norm.order + 1), 0)
  return applyNorm({ id, updatedAt, name: '', categoryIds: [], order }, changes, updatedAt)
}
