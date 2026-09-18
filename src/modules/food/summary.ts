/**
 * Итог записей по группам и категориям (Р-01, Р-18).
 *
 * Чистые функции. Итог — в порциях: так мерила таблица, и сверка истории
 * в них же. Запись с граммами — `grams / portionGrams`; без `portionGrams`
 * — одна порция, и итог называет, сколько таких.
 */

import type { Category, Dish, Intake } from '../../app/model.ts'
import { sumKcal, type KcalSum } from './kcal.ts'

/** Порций в записи; `assumed` — граммы без веса порции, посчитано одной (Р-18). */
export function recordPortions(record: Intake, dish: Dish | undefined): { portions: number; assumed: boolean } {
  if (record.grams === undefined) return { portions: record.portions ?? 1, assumed: false }
  if (dish?.portionGrams !== undefined && dish.portionGrams > 0) {
    return { portions: record.grams / dish.portionGrams, assumed: false }
  }
  return { portions: 1, assumed: true }
}

export type CategoryLine = { id: string; name: string; portions: number }

/** Группа итога. Категория без группы — сама себе группа, `name` — null. */
export type GroupLine = { name: string | null; portions: number; categories: CategoryLine[] }

export type DaySummary = {
  groups: GroupLine[]
  /** Порций блюд без категории или с категорией, которой больше нет (Р-02). */
  loose: number
  looseRecords: number
  records: number
  /** Записей в граммах без веса порции — посчитаны одной порцией (Р-18). */
  assumed: number
  portions: number
  kcal: KcalSum
}

/**
 * Итог записей: группы в порядке их первой категории, категории — в своём
 * порядке. Пустые не показываются.
 */
export function summarize(
  records: readonly Intake[],
  dishes: ReadonlyMap<string, Dish>,
  categories: readonly Category[],
): DaySummary {
  const live = records.filter((record) => !record.deleted)
  const known = new Map(categories.filter((each) => !each.deleted).map((each) => [each.id, each]))
  const byCategory = new Map<string, number>()
  let loose = 0
  let looseRecords = 0
  let assumed = 0
  let portions = 0

  for (const record of live) {
    const dish = dishes.get(record.dishId)
    const counted = recordPortions(record, dish)
    portions += counted.portions
    if (counted.assumed) assumed += 1
    const category = dish?.categoryId === undefined ? undefined : known.get(dish.categoryId)
    if (!category) {
      loose += counted.portions
      looseRecords += 1
      continue
    }
    byCategory.set(category.id, (byCategory.get(category.id) ?? 0) + counted.portions)
  }

  const ordered = [...byCategory.keys()]
    .map((id) => known.get(id) as Category)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ru'))

  const groups: GroupLine[] = []
  for (const category of ordered) {
    const line = { id: category.id, name: category.name, portions: byCategory.get(category.id) ?? 0 }
    const name = category.group ?? null
    const group = name === null ? undefined : groups.find((each) => each.name === name)
    if (group) {
      group.categories.push(line)
      group.portions += line.portions
    } else {
      groups.push({ name, portions: line.portions, categories: [line] })
    }
  }

  return { groups, loose, looseRecords, records: live.length, assumed, portions, kcal: sumKcal(live, dishes) }
}
