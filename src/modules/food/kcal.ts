/**
 * Калорийность записи и суммы с основанием (02-Архитектура, «Заметки по
 * модели»; Р-01).
 *
 * Калории справочные: считаются там, где у блюда хватает данных, и итог
 * всегда называет, по скольким записям он посчитан. Неизвестное — не ноль:
 * запись вне суммы, и это видно.
 */

import { plural } from '../../core/dates.ts'
import type { Dish, Intake } from '../../core/model.ts'

/** Ккал одной порции: `kcalPortion` или `portionGrams × kcal100 / 100`. Не хватает данных — null. */
export function portionKcal(dish: Dish): number | null {
  if (dish.kcalPortion !== undefined) return dish.kcalPortion
  if (dish.portionGrams !== undefined && dish.kcal100 !== undefined) return (dish.portionGrams * dish.kcal100) / 100
  return null
}

/**
 * Ккал записи. Есть граммы — `grams × kcal100 / 100`, без `kcal100` —
 * `grams / portionGrams × kcalPortion`. Нет граммов — `portions × ккал
 * порции`. Не хватает данных или блюда нет — null.
 */
export function intakeKcal(record: Intake, dish: Dish | undefined): number | null {
  if (!dish) return null
  if (record.grams !== undefined) {
    if (dish.kcal100 !== undefined) return (record.grams * dish.kcal100) / 100
    if (dish.portionGrams !== undefined && dish.portionGrams > 0 && dish.kcalPortion !== undefined) {
      return (record.grams / dish.portionGrams) * dish.kcalPortion
    }
    return null
  }
  const perPortion = portionKcal(dish)
  return perPortion === null ? null : (record.portions ?? 1) * perPortion
}

/** Сумма с основанием: сколько ккал, по скольким записям из скольких. */
export type KcalSum = { kcal: number; counted: number; total: number }

/** Сумма ккал живых записей. */
export function sumKcal(records: readonly Intake[], dishes: ReadonlyMap<string, Dish>): KcalSum {
  let kcal = 0
  let counted = 0
  let total = 0
  for (const record of records) {
    if (record.deleted) continue
    total += 1
    const value = intakeKcal(record, dishes.get(record.dishId))
    if (value === null) continue
    kcal += value
    counted += 1
  }
  return { kcal, counted, total }
}

/** Целые ккал с разрядами: «1 850». */
export function formatKcal(kcal: number): string {
  return Math.round(kcal).toLocaleString('ru-RU')
}

/**
 * «1 850 ккал по 9 из 11 записей» — число вместе с основанием (Р-01).
 * Ни у одной записи ккал не известны — так и сказано, без нуля.
 * Записей нет — пусто.
 */
export function kcalText(sum: KcalSum): string {
  if (sum.total === 0) return ''
  const of = `из ${sum.total} ${plural(sum.total, ['записи', 'записей', 'записей'])}`
  if (sum.counted === 0) return `ккал не известны ни у одной ${of}`
  return `${formatKcal(sum.kcal)} ккал по ${sum.counted} ${of}`
}
