/**
 * Выбор блюда в приёме (Р-26): «Частые» сверху, дальше все блюда по
 * категориям; поиск — найденное под названиями категорий.
 *
 * Чистые функции. Порядок внутри — частота Р-17 от просматриваемого дня.
 */

import type { DateStr } from '../../shared/core/dates.ts'
import type { Category, Dish, Intake, Meal } from '../../app/model.ts'
import { sortCategories } from './catalog.ts'
import { cleanName, findByName, normName } from './names.ts'
import { byFrequency, mealFrequency } from './repeat.ts'

/** Сколько блюд в «Частых» — два ряда кнопок на телефоне. */
export const FREQUENT_MAX = 8

/** Блюда одной категории в выборе. `id` null — «Без категории». */
export type PickSection = { id: string | null; name: string; dishes: Dish[] }

export const LOOSE_NAME = 'Без категории'

/**
 * «Частые» (Р-26): блюда, бывшие в этом приёме до дня — за окно Р-17,
 * пустое окно — за всю историю, — по частоте, не больше `FREQUENT_MAX`.
 */
export function frequentDishes(
  live: readonly Dish[],
  intake: readonly Intake[],
  meal: Meal,
  day: DateStr,
  max: number = FREQUENT_MAX,
): Dish[] {
  const { counted } = mealFrequency(intake, meal, day)
  return byFrequency(live, intake, meal, day)
    .filter((dish) => (counted.get(dish.id) ?? 0) > 0)
    .slice(0, max)
}

/**
 * Блюда по категориям (Р-26): категории — в ручном порядке, архивные на
 * своём месте, без блюд — не показываются; внутри — по частоте. Блюда без
 * категории или с пропавшей — «Без категории», последними.
 */
export function pickSections(
  live: readonly Dish[],
  categories: readonly Category[],
  intake: readonly Intake[],
  meal: Meal,
  day: DateStr,
): PickSection[] {
  const ordered = byFrequency(live, intake, meal, day)
  const sections: PickSection[] = sortCategories(categories).map((category) => ({
    id: category.id,
    name: category.name,
    dishes: ordered.filter((dish) => dish.categoryId === category.id),
  }))
  const known = new Set(sections.map((section) => section.id))
  sections.push({
    id: null,
    name: LOOSE_NAME,
    dishes: ordered.filter((dish) => dish.categoryId === undefined || !known.has(dish.categoryId)),
  })
  return sections.filter((section) => section.dishes.length > 0)
}

/** Поиск (Р-26): найденное — теми же разделами; регистр, «ё» и пробелы не в счёт. */
export function searchSections(sections: readonly PickSection[], query: string): PickSection[] {
  const key = normName(query)
  if (!key) return [...sections]
  return sections
    .map((section) => ({ ...section, dishes: section.dishes.filter((dish) => normName(dish.name).includes(key)) }))
    .filter((section) => section.dishes.length > 0)
}

/**
 * Новое блюдо из поиска (Р-36): поиск не нашёл ни одного живого блюда —
 * завести блюдо с названием запроса и записать. Блюдо с таким названием
 * лежит в архиве — вернуть его, а не заводить второе (Р-12). Нашлось хоть
 * одно или запрос пуст — ничего.
 */
export type NewDishOffer = { kind: 'create'; name: string } | { kind: 'restore'; dish: Dish } | null

export function newDishOffer(query: string, dishes: readonly Dish[], found: number): NewDishOffer {
  const name = cleanName(query)
  if (!name || found > 0) return null
  const archived = findByName(dishes, name)
  if (archived?.archived) return { kind: 'restore', dish: archived }
  return archived ? null : { kind: 'create', name }
}

/** Сколько блюд в разделах. */
export function sectionsSize(sections: readonly PickSection[]): number {
  return sections.reduce((sum, section) => sum + section.dishes.length, 0)
}
