/**
 * Тексты модуля: названия приёмов, порции, склонения.
 *
 * Числа в текстах — из констант, а не цифрами в строке (CLAUDE.md,
 * «Правила интерфейса»).
 */

import { plural } from '../../core/dates.ts'
import type { Meal } from '../../core/model.ts'

/** Приёмы в порядке дня. Перекус — последним: он без часов (Р-11). */
export const MEALS: readonly Meal[] = ['breakfast', 'lunch', 'dinner', 'snack']

export const MEAL_NAMES: { readonly [M in Meal]: string } = {
  breakfast: 'Завтрак',
  lunch: 'Обед',
  dinner: 'Ужин',
  snack: 'Перекус',
}

/** Склонения — для сводок и отчёта импорта. */
export const FORMS: { readonly [K in 'category' | 'dish' | 'intake' | 'record' | 'portion']: [string, string, string] } = {
  category: ['категория', 'категории', 'категорий'],
  dish: ['блюдо', 'блюда', 'блюд'],
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
