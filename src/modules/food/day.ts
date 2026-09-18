/**
 * День на «Сегодня»: какой показать, записи по приёмам, тап по блюду.
 *
 * Чистые функции; итог дня — `summary.ts`.
 */

import { isDateStr, type DateStr } from '../../shared/core/dates.ts'
import type { Intake, Meal } from '../../app/model.ts'
import { MEALS } from './labels.ts'

/**
 * Какой день показать: из адреса — прошлый или сегодняшний; кривой, пустой
 * или будущий — сегодня. Учёт про то, что съедено, и в будущее экран не
 * листается. Как `viewedDay` «Делу Время» (их Р-25).
 */
export function viewedDay(param: string | null, today: DateStr): DateStr {
  return param !== null && isDateStr(param) && param <= today ? param : today
}

/** Живые записи дня по приёмам, в порядке записи — ULID растёт со временем. */
export function dayMeals(intake: readonly Intake[], day: DateStr): Record<Meal, Intake[]> {
  const meals = Object.fromEntries(MEALS.map((meal) => [meal, [] as Intake[]])) as Record<Meal, Intake[]>
  for (const record of intake) {
    if (record.deleted || record.date !== day) continue
    meals[record.meal]?.push(record)
  }
  for (const meal of MEALS) meals[meal].sort((a, b) => a.id.localeCompare(b.id))
  return meals
}

/**
 * Тап по блюду в приёме (Р-02, Р-11): новая запись в одну порцию. Блюдо
 * в этом приёме этого дня уже есть — порция прибавляется к той записи:
 * одинаковые блюда одного приёма — одна запись с `portions`, тот же
 * естественный ключ, что у импорта. Запись в граммах не трогается:
 * порцию к граммам не прибавить, и об этом говорит `blocked`.
 */
export function tapDish(
  records: readonly Intake[],
  dishId: string,
  make: () => Pick<Intake, 'id' | 'updatedAt' | 'date' | 'meal'>,
): { record: Intake; added: boolean } | { blocked: Intake } {
  const same = records.find((record) => !record.deleted && record.dishId === dishId)
  if (!same) return { record: { ...make(), dishId }, added: true }
  if (same.grams !== undefined) return { blocked: same }
  return { record: { ...same, portions: (same.portions ?? 1) + 1 }, added: false }
}
