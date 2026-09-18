/**
 * Период выгрузки markdown (Р-34): какие месяцы и годы предложить и какой
 * промежуток выбран.
 *
 * Чистые функции: знают только даты. Взято из «Делу Время» с d86f0aa;
 * их номера помечены — «их Р-NN», голые — «Трапезы» (Р-53). Их итоги месяца и года —
 * месяц по умолчанию, неделя, закрывшая месяц, «ещё идёт» — не взяты:
 * итоги месяца и года в «Трапезе» отложены (План, «Отложено»).
 */

import {
  addMonths,
  formatMonth,
  isDateStr,
  isMonthStr,
  monthOf,
  monthPeriod,
  yearPeriod,
  type DateStr,
  type MonthStr,
  type Period,
} from '../shared/core/dates.ts'

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** «Сентябрь 2026» — заголовком. */
export function monthTitle(month: MonthStr): string {
  return capitalized(formatMonth(month))
}

// ─── Выбор месяца и года (их Р-77), период выгрузки (их Р-79) ─────────────

/**
 * Месяцы для выбора: от первого месяца с записями до текущего, свежие сверху.
 * `shown` — показанный сейчас: он в списке всегда, даже если листали раньше
 * первой записи. Кривые и будущие даты не в счёт.
 */
export function monthChoices(dates: readonly string[], today: DateStr, shown?: MonthStr): MonthStr[] {
  const last = monthOf(today)
  let first = last
  for (const date of dates) {
    if (isDateStr(date) && date <= today && monthOf(date) < first) first = monthOf(date)
  }
  if (shown !== undefined && isMonthStr(shown) && shown < first) first = shown
  const list: MonthStr[] = []
  for (let month = first; month <= last; month = addMonths(month, 1)) list.push(month)
  return list.reverse()
}

/** Годы тех же месяцев, свежие сверху. */
export function yearChoices(months: readonly MonthStr[]): number[] {
  return [...new Set(months.map((month) => Number(month.slice(0, 4))))]
}

/** Период выгрузки markdown и его название для шапки файла. Null — за всё время. */
export type ExportSpan = { period: Period; label: string } | null

/** Значение списка: `''` — всё время, `y:2026` — год, `m:2026-02` — месяц. Кривое — всё время. */
export function exportSpan(value: string): ExportSpan {
  const year = /^y:(\d{4})$/.exec(value)?.[1]
  if (year !== undefined) return { period: yearPeriod(Number(year)), label: `${year} год` }
  const month = /^m:(.+)$/.exec(value)?.[1]
  if (month !== undefined && isMonthStr(month)) return { period: monthPeriod(month), label: formatMonth(month) }
  return null
}
