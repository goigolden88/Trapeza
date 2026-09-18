/**
 * Приём по часам устройства (Р-11): завтрак до начала обеда, обед до начала
 * ужина, дальше ужин. Перекус по часам не ставится никогда — только явно.
 *
 * Границы — настройка устройства `mealHours` (02-Архитектура, «Локальное
 * хранилище»); экрана правки пока нет, умолчания — 13 и 18.
 */

import type { Meal } from '../../app/model.ts'

export type MealHours = { lunch: number; dinner: number }

/** Ключ настройки устройства. */
export const MEAL_HOURS_KEY = 'mealHours'

export const DEFAULT_MEAL_HOURS: MealHours = { lunch: 13, dinner: 18 }

/** Час суток — целое от 0 до 23. */
function isHour(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23
}

/**
 * Границы из настройки. Нет, кривые или обед не раньше ужина — умолчания:
 * испорченная настройка не должна ставить весь день в один приём.
 */
export function readMealHours(stored: unknown): MealHours {
  if (typeof stored !== 'object' || stored === null) return DEFAULT_MEAL_HOURS
  const { lunch, dinner } = stored as Record<string, unknown>
  return isHour(lunch) && isHour(dinner) && lunch < dinner ? { lunch, dinner } : DEFAULT_MEAL_HOURS
}

/** Приём по часу: завтрак, обед или ужин. */
export function mealByHour(hour: number, hours: MealHours): Meal {
  if (hour < hours.lunch) return 'breakfast'
  if (hour < hours.dinner) return 'lunch'
  return 'dinner'
}

/** Текущий приём по часам устройства. */
export function currentMeal(now: Date, hours: MealHours): Meal {
  return mealByHour(now.getHours(), hours)
}

/**
 * Какие приёмы шаблон дня может записать (Р-28): на сегодня — начавшиеся
 * по часам, до текущего включительно, без перекуса — у него нет часов; на
 * прошлый день (`current` null) — все четыре.
 */
export function startedMeals(current: Meal | null): Meal[] {
  if (current === null) return ['breakfast', 'lunch', 'dinner', 'snack']
  const main: Meal[] = ['breakfast', 'lunch', 'dinner']
  return main.slice(0, main.indexOf(current) + 1)
}
