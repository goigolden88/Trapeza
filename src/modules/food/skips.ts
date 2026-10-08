/**
 * «Не было» и основные приёмы (Р-59).
 *
 * Отметка «Не было» — синхронизируемая запись: её видят второе устройство,
 * «Неделя» и срез для «Тотального Учёта». Ставится у пустого основного
 * приёма; запись еды в тот же приём её снимает — значит, всё-таки ел.
 *
 * Основные приёмы — одна запись `meals:main` на все устройства: какие из
 * завтрака, обеда и ужина спрашивает «Как обычно?», напоминание и срез.
 * Снятый приём пропуском не считается; записать в него еду можно как раньше.
 *
 * Чистые функции, без React и без базы.
 */

import { daysBetween, inPeriod, weekStart, type DateStr, type Period } from '../../shared/core/dates.ts'
import type { Intake, MainMeals, Meal, Skip } from '../../app/model.ts'
import { MEAL_NAMES, WEEKDAYS_SHORT } from './labels.ts'

/** Приёмы, о которых спрашивают и напоминают: перекус без часов — никогда (Р-29). */
export const MAIN_MEALS: readonly Meal[] = ['breakfast', 'lunch', 'dinner']

// ─── Основные приёмы ───────────────────────────────────────────────────────

/** id единственной записи основных приёмов (Р-59). */
export const MAIN_MEALS_ID = 'meals:main'

/**
 * Основные приёмы по записи настройки — в порядке дня. Записи нет, она
 * удалена или в ней ни одного из трёх — все три: испорченная настройка
 * не должна молча выключить вопросы и напоминания.
 */
export function readMainMeals(records: readonly MainMeals[]): Meal[] {
  const record = records.find((each) => each.id === MAIN_MEALS_ID && !each.deleted)
  const stored = Array.isArray(record?.meals) ? record.meals : []
  const meals = MAIN_MEALS.filter((meal) => stored.includes(meal))
  return meals.length > 0 ? meals : [...MAIN_MEALS]
}

/**
 * Запись настройки с включённым или снятым приёмом. Null — снимается
 * последний: хотя бы один основной приём остаётся (Р-59).
 */
export function withMainMeal(records: readonly MainMeals[], meal: Meal, on: boolean, at: string): MainMeals | null {
  if (!MAIN_MEALS.includes(meal)) return null
  const current = readMainMeals(records)
  const meals = MAIN_MEALS.filter((each) => (each === meal ? on : current.includes(each)))
  if (meals.length === 0) return null
  return { id: MAIN_MEALS_ID, updatedAt: at, meals }
}

/** «завтрак, обед, ужин» — итог у свёрнутого раздела настроек. */
export function mainMealsText(meals: readonly Meal[]): string {
  return meals.map((meal) => MEAL_NAMES[meal].toLowerCase()).join(', ')
}

// ─── «Не было» ─────────────────────────────────────────────────────────────

/** Приём дня одной строкой: `ГГГГ-ММ-ДД:приём`. */
export function skipKey(date: DateStr, meal: Meal): string {
  return `${date}:${meal}`
}

/** Есть ли в приёме дня живая запись еды. */
function eaten(intake: readonly Intake[], date: DateStr, meal: Meal): boolean {
  return intake.some((record) => !record.deleted && record.date === date && record.meal === meal)
}

/**
 * Действующие отметки: живые, у основного приёма, без еды в том же приёме —
 * еда главнее отметки, даже пока та не снята (Р-59). Одна на приём — поздняя:
 * два устройства могли отметить один приём до обмена.
 */
export function activeSkips(skips: readonly Skip[], intake: readonly Intake[]): Skip[] {
  const latest = new Map<string, Skip>()
  for (const skip of skips) {
    if (skip.deleted || !MAIN_MEALS.includes(skip.meal) || eaten(intake, skip.date, skip.meal)) continue
    const key = skipKey(skip.date, skip.meal)
    const known = latest.get(key)
    if (!known || skip.updatedAt > known.updatedAt) latest.set(key, skip)
  }
  return [...latest.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || MAIN_MEALS.indexOf(a.meal) - MAIN_MEALS.indexOf(b.meal),
  )
}

/** Ключи действующих отметок — для `missedMeals`. */
export function skippedKeys(skips: readonly Skip[], intake: readonly Intake[]): string[] {
  return activeSkips(skips, intake).map((skip) => skipKey(skip.date, skip.meal))
}

/** Отметка приёма дня. Нет — undefined. */
export function skipOf(skips: readonly Skip[], intake: readonly Intake[], date: DateStr, meal: Meal): Skip | undefined {
  return activeSkips(skips, intake).find((skip) => skip.date === date && skip.meal === meal)
}

/** Новая отметка. Причина — без крайних пробелов; пустая не пишется. */
export function createSkip(date: DateStr, meal: Meal, reason: string, id: string, at: string): Skip {
  const text = reason.trim()
  return { id, updatedAt: at, date, meal, ...(text ? { reason: text } : {}) }
}

/** «Снять» — надгробия всех живых отметок приёма дня: с двух устройств их бывает две. */
export function clearSkip(skips: readonly Skip[], date: DateStr, meal: Meal): Skip[] {
  return skips
    .filter((skip) => !skip.deleted && skip.date === date && skip.meal === meal)
    .map((skip) => ({ ...skip, deleted: true }))
}

/** Отметки, которые сняла записанная еда: живые, а в их приёме теперь есть запись (Р-59). */
export function liftedSkips(skips: readonly Skip[], intake: readonly Intake[]): Skip[] {
  return skips
    .filter((skip) => !skip.deleted && eaten(intake, skip.date, skip.meal))
    .map((skip) => ({ ...skip, deleted: true }))
}

/** Действующие отметки отрезка — «Неделя» (Р-59). */
export function periodSkips(skips: readonly Skip[], intake: readonly Intake[], period: Period): Skip[] {
  return activeSkips(skips, intake).filter((skip) => inPeriod(skip.date, period))
}

/** Строка недели: «вт, завтрак — не успел»; без причины — «вт, завтрак». */
export function skipLineText(skip: Pick<Skip, 'date' | 'meal' | 'reason'>): string {
  const weekday = WEEKDAYS_SHORT[daysBetween(weekStart(skip.date), skip.date)] ?? ''
  const what = `${weekday}, ${MEAL_NAMES[skip.meal].toLowerCase()}`
  return skip.reason ? `${what} — ${skip.reason}` : what
}
