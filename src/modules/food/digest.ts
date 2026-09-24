/**
 * Срез итогов «Трапезы» для метаприложения семьи (Р-55; Я-16…Я-21 «FamilyCore»).
 *
 * Функцию зовёт проход синхронизации ядра через `summary` конфига и кладёт
 * результат файлом `summary.json` в репозиторий данных. Само приложение срез
 * не читает. Считается только из живых синхронизируемых записей и дня
 * расчёта: отметки «Не было» — настройка устройства — сюда не попадают,
 * иначе два устройства переписывали бы файл друг за другом (Я-16).
 *
 * Числа — теми же функциями, что экран «Неделя»: срез и экран не спорят.
 * Заметки записей и рецепты в срез не идут никогда (Я-14).
 */

import { addDays, days, isDateStr, plural, type DateStr } from '../../shared/core/dates.ts'
import {
  summaryPeriods,
  UNKNOWN,
  type Attention,
  type Metric,
  type SummaryBody,
  type SummaryPeriod,
  type Unknown,
} from '../../shared/core/summary.ts'
import type { Dish, StoreRecord } from '../../app/model.ts'
import { dayLink } from './feed.ts'
import { MEAL_NAMES, normRuleText } from './labels.ts'
import { activeNorms, checkWeek, indexDays, type DayIndex } from './norms.ts'
import { MAIN_MEALS, missedMeals } from './usual.ts'
import { loggedText, weekSummary } from './week.ts'

/** Живые записи синхронизируемых хранилищ — то, что даёт проход ядра. */
export type DigestData = { readonly [S in keyof StoreRecord]: readonly StoreRecord[S][] }

/** Свой код «не известно»: записи есть, но ккал не известны ни у одной (Р-55). */
export const NO_KCAL = 'no-kcal'

const RECORDS: [string, string, string] = ['запись', 'записи', 'записей']
const RECORDS_OF: [string, string, string] = ['записи', 'записей', 'записей']
const RECORDS_BY: [string, string, string] = ['записи', 'записям', 'записям']

/** Месяц «Трапеза» пока не считает: новый расчёт и отдельное решение (Я-19, п. 1 «FamilyCore»). */
const MONTH: Unknown = {
  unknown: UNKNOWN.notProvided,
  text: 'Итог месяца «Трапеза» пока не считает: её ритм — неделя',
}

/** Порции — до сотых: доли от граммов не должны менять файл от прохода к проходу. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Идёт ли отрезок в день расчёта. */
function isCurrent(period: SummaryPeriod, day: DateStr): boolean {
  return period.from <= day && day <= period.to
}

function weekMetrics(data: DigestData, dishes: ReadonlyMap<string, Dish>, index: DayIndex, from: DateStr, day: DateStr): Metric[] | Unknown {
  const week = weekSummary(data.intake, dishes, data.categories, from, day)
  if (week.records === 0) {
    return { unknown: UNKNOWN.noData, text: 'За неделю ни одной записи: «не ел» и «не записывал» учёт не различает' }
  }
  const current = week.elapsed < week.days.length
  const logged = current ? `${loggedText(week)} наступивших` : loggedText(week)
  const byRecords = `по ${week.records} ${plural(week.records, RECORDS_BY)}`
  const assumed =
    week.assumed > 0
      ? `; ${week.assumed} ${plural(week.assumed, RECORDS)} в граммах без веса порции ${plural(week.assumed, ['посчитана', 'посчитаны', 'посчитаны'])} одной порцией`
      : ''

  const { kcal, counted, total } = week.kcal
  const kcalOf = `по ${counted} из ${total} ${plural(total, RECORDS_OF)}`
  const noKcal: Unknown = { unknown: NO_KCAL, text: `Ккал не известны ни у одной из ${total} ${plural(total, RECORDS_OF)}` }

  const metrics: Metric[] = [
    {
      key: 'intake.logged',
      label: 'Дни учёта',
      value: { n: week.logged, unit: 'days' },
      basis: current
        ? `Из ${week.elapsed} ${plural(week.elapsed, ['наступившего дня', 'наступивших дней', 'наступивших дней'])} недели`
        : `Из ${days(week.days.length)} недели`,
    },
    { key: 'intake.records', label: 'Записей', value: { n: week.records, unit: 'count' }, basis: logged },
    {
      key: 'intake.portions',
      label: 'Порций',
      value: { n: round2(week.portions), unit: 'count' },
      basis: `${byRecords}${assumed}`,
    },
    {
      key: 'intake.loose',
      label: 'Порций без категории',
      value: { n: round2(week.loose), unit: 'count' },
      basis: `${week.looseRecords} ${plural(week.looseRecords, RECORDS)} из ${week.records}; в нормы не входят`,
    },
    {
      key: 'kcal.total',
      label: 'Ккал',
      value: counted === 0 ? noKcal : { n: Math.round(kcal), unit: 'kcal' },
      basis: counted < total ? `${kcalOf} — у остальных блюд ккал не известны` : kcalOf,
    },
    {
      key: 'kcal.perDay',
      label: 'Ккал в день учёта',
      value: counted === 0 ? noKcal : { n: Math.round(kcal / week.logged), unit: 'kcal' },
      basis: `В среднем за ${week.logged} ${plural(week.logged, ['день', 'дня', 'дней'])} учёта, ${kcalOf}`,
    },
  ]

  for (const norm of activeNorms(data.norms)) {
    const check = checkWeek(norm, index, from)
    const unknown = check.unknown === 0 ? '' : `, ${check.unknown} ${current ? 'без записей или впереди' : 'без записей'}`
    metrics.push({
      key: `norm.${norm.id}`,
      label: `Норма: ${norm.name}`,
      value: { verdict: check.verdict },
      basis: `${normRuleText(norm)}: ${days(check.days)} с записью${unknown}`,
    })
  }
  return metrics
}

/**
 * «Требует внимания» (Р-55, Я-18): вчера нет записи завтрака, обеда или
 * ужина. Только по записям — отметки «Не было» живут на устройстве (Р-29).
 * До первой записи вообще — пусто: учёт не начат.
 */
export function attentionOf(intake: readonly StoreRecord['intake'][], day: DateStr): Attention[] {
  const yesterday = addDays(day, -1)
  const live = intake.filter((record) => !record.deleted && isDateStr(record.date))
  if (!live.some((record) => record.date <= yesterday)) return []
  const missed = missedMeals(live, yesterday, MAIN_MEALS, [])
  if (missed.length === 0) return []
  const names = missed.map((meal) => MEAL_NAMES[meal].toLowerCase()).join(', ')
  return [
    {
      key: 'meals.missed',
      label: 'Приёмы без записи',
      count: missed.length,
      day: yesterday,
      link: dayLink(yesterday, day),
      basis: `По записям нет: ${names}. Отметки «Не было» живут на устройстве и не учтены`,
    },
  ]
}

/** Тело среза на день `day`: четыре отрезка ядра и «требует внимания». */
export function summary(data: DigestData, day: DateStr): SummaryBody {
  const dishes = new Map(data.dishes.map((dish) => [dish.id, dish]))
  const index = indexDays(data.intake, dishes)
  return {
    periods: summaryPeriods(day).map((period) => ({
      ...period,
      through: isCurrent(period, day) ? day : null,
      metrics: period.grain === 'week' ? weekMetrics(data, dishes, index, period.from, day) : MONTH,
    })),
    attention: attentionOf(data.intake, day),
  }
}
