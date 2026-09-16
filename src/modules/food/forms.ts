/**
 * Разбор форм справочника: блюдо и категория. Что ввели строками — в поля
 * записи или в причину отказа.
 *
 * Чистые функции: правило «пустое поле — поле снимается, кривое — отказ
 * с причиной» проверяется тестами, а не глазами.
 */

import { numberOf } from '../../core/importing.ts'
import type { Category, Dish } from '../../core/model.ts'
import { cleanName, nameProblem, type NameProblem } from './names.ts'

/** Поля формы блюда — как их видит человек: строками. */
export type DishInput = {
  name: string
  /** '' — без категории. */
  categoryId: string
  portionGrams: string
  kcal100: string
  kcalPortion: string
}

export function dishInput(dish?: Dish): DishInput {
  const text = (value: number | undefined) => (value === undefined ? '' : String(value).replace('.', ','))
  return {
    name: dish?.name ?? '',
    categoryId: dish?.categoryId ?? '',
    portionGrams: text(dish?.portionGrams),
    kcal100: text(dish?.kcal100),
    kcalPortion: text(dish?.kcalPortion),
  }
}

const NAME_PROBLEMS: { readonly [P in NameProblem]: (what: string) => string } = {
  empty: () => 'Нужно название',
  duplicate: (what) => `${what} с таким названием уже есть`,
  archived: (what) => `${what} с таким названием лежит в архиве — верните его оттуда`,
}

export function nameProblemText(problem: NameProblem, what: string): string {
  return NAME_PROBLEMS[problem](what)
}

/** Свойства блюда из формы; пустое поле снимает свойство. */
export type DishChanges = {
  name: string
  categoryId: string | undefined
  portionGrams: number | undefined
  kcal100: number | undefined
  kcalPortion: number | undefined
}

/**
 * Форма блюда → свойства или причина отказа. `selfId` — при правке:
 * своё прежнее название не мешает.
 */
export function readDish(
  input: DishInput,
  dishes: readonly Dish[],
  categories: readonly Category[],
  selfId?: string,
): { changes: DishChanges } | { problem: string } {
  const problem = nameProblem(dishes, input.name, selfId)
  if (problem) return { problem: nameProblemText(problem, 'Блюдо') }

  const categoryId = input.categoryId || undefined
  if (categoryId && !categories.some((each) => each.id === categoryId && !each.deleted)) {
    return { problem: 'Такой категории больше нет — выберите другую' }
  }

  const numbers = {
    portionGrams: { label: 'Порция', min: 'больше нуля', ok: (value: number) => value > 0 },
    kcal100: { label: 'Ккал на 100 г', min: 'не меньше нуля', ok: (value: number) => value >= 0 },
    kcalPortion: { label: 'Ккал на порцию', min: 'не меньше нуля', ok: (value: number) => value >= 0 },
  } as const
  const read: Partial<Record<keyof typeof numbers, number>> = {}
  for (const key of Object.keys(numbers) as (keyof typeof numbers)[]) {
    const raw = input[key].trim()
    if (!raw) continue
    const value = numberOf(raw)
    const rule = numbers[key]
    if (value === null || !rule.ok(value)) return { problem: `${rule.label} — число ${rule.min}` }
    read[key] = value
  }

  return {
    changes: {
      name: cleanName(input.name),
      categoryId,
      portionGrams: read.portionGrams,
      kcal100: read.kcal100,
      kcalPortion: read.kcalPortion,
    },
  }
}

/** Блюдо с правками формы. Снятые поля уходят из записи, а не остаются `undefined`. */
export function applyDish(dish: Dish, changes: DishChanges): Dish {
  const next: Dish = { ...dish, name: changes.name }
  for (const key of ['categoryId', 'portionGrams', 'kcal100', 'kcalPortion'] as const) {
    const value = changes[key]
    if (value === undefined) delete next[key]
    else (next as Record<typeof key, unknown>)[key] = value
  }
  return next
}

/** Строка свойств блюда под названием: «300 г · 50 ккал/100 г». Пусто — ничего не известно. */
export function dishFacts(dish: Dish): string {
  const parts: string[] = []
  const number = (value: number) => String(value).replace('.', ',')
  if (dish.portionGrams !== undefined) parts.push(`порция ${number(dish.portionGrams)} г`)
  if (dish.kcal100 !== undefined) parts.push(`${number(dish.kcal100)} ккал/100 г`)
  if (dish.kcalPortion !== undefined) parts.push(`${number(dish.kcalPortion)} ккал/порция`)
  return parts.join(' · ')
}
