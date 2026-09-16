/**
 * Тексты модуля: названия приёмов, порции, склонения.
 *
 * Числа в текстах — из констант, а не цифрами в строке (CLAUDE.md,
 * «Правила интерфейса»).
 */

import { days, formatDateLong, plural } from '../../core/dates.ts'
import type { Meal, Norm } from '../../core/model.ts'
import { NORM_MIN_WEEKS, type NormHistory, type Touch, type WeekCheck } from './norms.ts'

/** Приёмы в порядке дня. Перекус — последним: он без часов (Р-11). */
export const MEALS: readonly Meal[] = ['breakfast', 'lunch', 'dinner', 'snack']

export const MEAL_NAMES: { readonly [M in Meal]: string } = {
  breakfast: 'Завтрак',
  lunch: 'Обед',
  dinner: 'Ужин',
  snack: 'Перекус',
}

/** Склонения — для сводок и отчёта импорта. */
export const FORMS: { readonly [K in 'category' | 'dish' | 'dishOf' | 'intake' | 'record' | 'portion']: [string, string, string] } = {
  category: ['категория', 'категории', 'категорий'],
  dish: ['блюдо', 'блюда', 'блюд'],
  // После «из»: «из 1 блюда», «из 3 блюд», «из 5 блюд».
  dishOf: ['блюда', 'блюд', 'блюд'],
  intake: ['запись еды', 'записи еды', 'записей еды'],
  record: ['запись', 'записи', 'записей'],
  portion: ['порция', 'порции', 'порций'],
}

/** Число по-русски: десятичная запятая, без хвоста нулей. `1.5` → `1,5`. */
export function formatNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return String(rounded).replace('.', ',')
}

/** `1` → `1 порция`, `1.5` → `1,5 порции`. */
export function portions(value: number): string {
  return `${formatNumber(value)} ${plural(value, FORMS.portion)}`
}

/** Дни недели с понедельника — подписи недели. */
export const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'] as const

// ─── Нормы (Р-23, Р-24) ────────────────────────────────────────────────────

// После «из», «до», «с»: «из 1 дня», «до 5 дней», «с 3 недель».
const DAYS_OF: [string, string, string] = ['дня', 'дней', 'дней']
const WEEKS_OF: [string, string, string] = ['недели', 'недель', 'недель']

/** Правило нормы: «не меньше 5 дней», «не больше 4 дней», «от 3 до 6 дней». */
export function normRuleText(norm: Pick<Norm, 'minDays' | 'maxDays'>): string {
  const { minDays: min, maxDays: max } = norm
  if (min !== undefined && max !== undefined) return `от ${min} до ${max} ${plural(max, DAYS_OF)}`
  if (min !== undefined) return `не меньше ${min} ${plural(min, DAYS_OF)}`
  if (max !== undefined) return `не больше ${max} ${plural(max, DAYS_OF)}`
  return ''
}

/**
 * Итог недели словами, без оценки (Р-23): «3 из 5 дней», «3 дня при пределе 4»,
 * «4 дня при норме от 3 до 6 дней». Исход ясен и выполнен — ✓.
 */
export function normCheckText(norm: Pick<Norm, 'minDays' | 'maxDays'>, check: Pick<WeekCheck, 'days' | 'verdict'>): string {
  const { minDays: min, maxDays: max } = norm
  const text =
    min !== undefined && max !== undefined
      ? `${days(check.days)} при норме ${normRuleText(norm)}`
      : min !== undefined
        ? `${check.days} из ${min} ${plural(min, DAYS_OF)}`
        : `${days(check.days)} при пределе ${max ?? ''}`
  return check.verdict === 'met' ? `${text} ✓` : text
}

/**
 * История нормы (Р-24): «выполнена в 5 из 6 недель»; недель в счёт мало —
 * сколько набралось. Неясные — числом; `since` — днём начала.
 */
export function normHistoryText(history: NormHistory): string {
  const counted = history.weeks.length
  const parts: string[] = []
  if (history.since !== null) parts.push(`с ${formatDateLong(history.since)}`)
  parts.push(
    history.enough
      ? `выполнена в ${history.kept} из ${counted} ${plural(counted, WEEKS_OF)}`
      : `история — с ${NORM_MIN_WEEKS} ${plural(NORM_MIN_WEEKS, WEEKS_OF)} в счёт, пока ${counted}`,
  )
  if (history.open > 0) {
    parts.push(`${history.open} ${plural(history.open, ['неделя не ясна', 'недели не ясны', 'недель не ясны'])}`)
  }
  return parts.join(' · ')
}

/** Строка после тапа (Р-25): «Сладкое: 3 дня при пределе 4 — день уже в счёте». */
export function touchText(touch: Touch): string {
  const text = `${touch.norm.name}: ${normCheckText(touch.norm, touch.check)}`
  return touch.already ? `${text} — день уже в счёте` : text
}
