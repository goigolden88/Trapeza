/**
 * Итог месяца на экране «Неделя» и в срезе (Р-61): сводка недель месяца на
 * тех же расчётах — `weekSummary` и `checkWeek`, второго счёта нет. Нормы —
 * числом недель: правила недельные (Р-01).
 *
 * Неделя — в месяце своего воскресенья (`weeksEndingIn` ядра, как в «Делу
 * Время», их Р-55): каждая попадает ровно в один месяц, и к концу месяца все
 * его недели закончились.
 *
 * Чистые функции, без React и без базы.
 */

import {
  formatDateLong,
  isDateStr,
  isMonthStr,
  monthOf,
  monthPeriod,
  plural,
  weeksEndingIn,
  type DateStr,
  type MonthStr,
  type Period,
} from '../../shared/core/dates.ts'
import type { Category, Dish, Intake, Norm } from '../../app/model.ts'
import type { KcalSum } from './kcal.ts'
import { activeNorms, checkWeek, mondayFrom, WEEK_DAYS, type DayIndex } from './norms.ts'
import { weekSummary } from './week.ts'

/** Какой месяц показать. Кривой, пустой или будущий — текущий, как неделя. */
export function viewedMonth(param: string | null, today: DateStr): MonthStr {
  const current = monthOf(today)
  return param !== null && isMonthStr(param) && param <= current ? param : current
}

/** Норма за месяц: сколько его недель выполнена (Р-24, Р-61). */
export type MonthNorm = {
  norm: Norm
  /** Недель в счёт: исход ясен — у идущей тоже, досрочно (Р-24). */
  counted: number
  /** Сколько из них выполнено. */
  met: number
  /** Закончившихся недель с записями, чей исход не ясен. */
  open: number
  /** Закончившихся недель без единой записи — без учёта. */
  empty: number
  /** Идущая неделя месяца, чей исход пока не ясен. */
  pending: boolean
  /** Недель до понедельника `since` — не судятся, как в истории нормы. */
  before: number
  since: DateStr | null
}

export type MonthSummary = {
  month: MonthStr
  /** Недели месяца по порядку, и ещё не начавшиеся. */
  weeks: Period[]
  /** С понедельника первой недели по воскресенье последней. */
  span: Period
  /** Дней во всех неделях месяца. */
  days: number
  /** Одна из недель месяца идёт сегодня. */
  current: boolean
  records: number
  /** Дней учёта — с хоть одной записью (Р-24). */
  logged: number
  /** Сколько дней недель месяца наступило. */
  elapsed: number
  kcal: KcalSum
  norms: MonthNorm[]
}

function monthNorm(norm: Norm, index: DayIndex, weeks: readonly Period[], today: DateStr): MonthNorm {
  const since = norm.since !== undefined && isDateStr(norm.since) ? norm.since : null
  const start = since === null ? null : mondayFrom(since)
  const line: MonthNorm = { norm, counted: 0, met: 0, open: 0, empty: 0, pending: false, before: 0, since }
  for (const week of weeks) {
    if (week.from > today) break
    if (start !== null && week.from < start) {
      line.before += 1
      continue
    }
    const check = checkWeek(norm, index, week.from)
    const going = week.to >= today
    if (!going && check.unknown === WEEK_DAYS) line.empty += 1
    else if (check.verdict === 'open') {
      if (going) line.pending = true
      else line.open += 1
    } else {
      line.counted += 1
      if (check.verdict === 'met') line.met += 1
    }
  }
  return line
}

/** Недели месяца и их охват — с понедельника первой по воскресенье последней. */
export function monthWeeks(month: MonthStr): { weeks: Period[]; span: Period } {
  const weeks = weeksEndingIn(monthPeriod(month))
  const first = weeks[0]
  const last = weeks[weeks.length - 1]
  return { weeks, span: first && last ? { from: first.from, to: last.to } : monthPeriod(month) }
}

/** Идёт ли сегодня одна из недель месяца. */
export function monthGoing(weeks: readonly Period[], today: DateStr): boolean {
  return weeks.some((week) => week.from <= today && today <= week.to)
}

/** Итог месяца `month` на день `today`: недели, ещё не начавшиеся, пусты. */
export function monthSummary(
  intake: readonly Intake[],
  dishes: ReadonlyMap<string, Dish>,
  categories: readonly Category[],
  norms: readonly Norm[],
  index: DayIndex,
  month: MonthStr,
  today: DateStr,
): MonthSummary {
  const { weeks, span } = monthWeeks(month)
  const kcal: KcalSum = { kcal: 0, counted: 0, total: 0 }
  let records = 0
  let logged = 0
  let elapsed = 0
  for (const week of weeks) {
    if (week.from > today) break
    const summary = weekSummary(intake, dishes, categories, week.from, today)
    records += summary.records
    logged += summary.logged
    elapsed += summary.elapsed
    kcal.kcal += summary.kcal.kcal
    kcal.counted += summary.kcal.counted
    kcal.total += summary.kcal.total
  }
  return {
    month,
    weeks,
    span,
    days: weeks.length * WEEK_DAYS,
    current: monthGoing(weeks, today),
    records,
    logged,
    elapsed,
    kcal,
    norms: activeNorms(norms).map((norm) => monthNorm(norm, index, weeks, today)),
  }
}

/**
 * Норма за месяц словами (Р-61): «выполнена в 3 неделях из 4 · 1 неделя
 * не ясна». Недели вне счёта названы числом; `since` — днём начала, когда
 * он отрезал недели месяца.
 */
export function monthNormText(line: MonthNorm): string {
  const parts: string[] = []
  if (line.before > 0 && line.since !== null) parts.push(`с ${formatDateLong(line.since)}`)
  parts.push(
    line.counted === 0
      ? 'недель в счёт нет'
      : `выполнена в ${line.met} ${plural(line.met, ['неделе', 'неделях', 'неделях'])} из ${line.counted}`,
  )
  if (line.open > 0) {
    parts.push(`${line.open} ${plural(line.open, ['неделя не ясна', 'недели не ясны', 'недель не ясны'])}`)
  }
  if (line.empty > 0) {
    parts.push(`${line.empty} ${plural(line.empty, ['неделя без записей', 'недели без записей', 'недель без записей'])}`)
  }
  if (line.pending) parts.push('идущая неделя пока не ясна')
  return parts.join(' · ')
}
