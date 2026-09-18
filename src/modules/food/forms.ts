/**
 * Разбор форм: блюдо и правка записи еды. Что ввели строками — в поля
 * записи или в причину отказа.
 *
 * Чистые функции: правило «пустое поле — поле снимается, кривое — отказ
 * с причиной» проверяется тестами, а не глазами.
 */

import { numberOf } from '../../shared/core/importing.ts'
import type { Category, Dish, Intake, Meal } from '../../app/model.ts'
import { timeOf } from './import.ts'
import { portions as portionsText } from './labels.ts'
import { cleanName, nameProblem, type NameProblem } from './names.ts'
import { cleanRecipe } from './recipe.ts'

/** Поля формы блюда — как их видит человек: строками. */
export type DishInput = {
  name: string
  /** '' — без категории. */
  categoryId: string
  portionGrams: string
  kcal100: string
  kcalPortion: string
  /** рецепт текстом (Р-39); '' — рецепта нет */
  recipe: string
}

export function dishInput(dish?: Dish): DishInput {
  const text = (value: number | undefined) => (value === undefined ? '' : String(value).replace('.', ','))
  return {
    name: dish?.name ?? '',
    categoryId: dish?.categoryId ?? '',
    portionGrams: text(dish?.portionGrams),
    kcal100: text(dish?.kcal100),
    kcalPortion: text(dish?.kcalPortion),
    recipe: dish?.recipe ?? '',
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
  recipe: string | undefined
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
      recipe: cleanRecipe(input.recipe),
    },
  }
}

/** Блюдо с правками формы. Снятые поля уходят из записи, а не остаются `undefined`. */
export function applyDish(dish: Dish, changes: DishChanges): Dish {
  const next: Dish = { ...dish, name: changes.name }
  for (const key of ['categoryId', 'portionGrams', 'kcal100', 'kcalPortion', 'recipe'] as const) {
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

// ─── Запись еды ────────────────────────────────────────────────────────────

/** Шаг кнопок «−» и «+» у порций (Р-18). */
export const PORTION_STEP = 0.5

/** Поля правки записи — строками, как в форме. */
export type IntakeInput = { meal: Meal; portions: string; grams: string; at: string; note: string }

function numberText(value: number | undefined): string {
  return value === undefined ? '' : String(value).replace('.', ',')
}

export function intakeInput(record: Intake): IntakeInput {
  return {
    meal: record.meal,
    portions: numberText(record.portions ?? 1),
    grams: numberText(record.grams),
    at: record.at ?? '',
    note: record.note ?? '',
  }
}

/**
 * Шаг порций кнопкой: на половину вверх или вниз, не меньше половины.
 * Кривое поле — от одной порции.
 */
export function stepPortions(text: string, direction: 1 | -1): string {
  const value = numberOf(text)
  const from = value === null || value <= 0 ? 1 : value
  const next = Math.max(PORTION_STEP, Math.round((from + direction * PORTION_STEP) * 100) / 100)
  return numberText(next)
}

/**
 * Правка записи → запись или причина отказа. `others` — живые записи того
 * же дня: в приёме, куда запись переезжает, этого блюда быть не должно —
 * одинаковые блюда приёма пишутся одной записью.
 */
export function readIntake(
  input: IntakeInput,
  record: Intake,
  others: readonly Intake[],
): { record: Intake } | { problem: string } {
  const portions = input.portions.trim() ? numberOf(input.portions) : 1
  if (portions === null || portions <= 0) return { problem: 'Порции — число больше нуля' }
  const grams = input.grams.trim() ? numberOf(input.grams) : undefined
  if (grams === null || (grams !== undefined && grams <= 0)) return { problem: 'Граммы — число больше нуля' }
  const at = input.at.trim() ? timeOf(input.at) : undefined
  if (at === null) return { problem: 'Время — ЧЧ:ММ' }

  const twin = others.find(
    (other) => !other.deleted && other.id !== record.id && other.meal === input.meal && other.dishId === record.dishId,
  )
  if (twin) return { problem: 'В этом приёме это блюдо уже записано — поправьте порции там' }

  const next: Intake = { ...record, meal: input.meal }
  const set = <K extends 'portions' | 'grams' | 'at' | 'note'>(key: K, value: Intake[K] | undefined) => {
    if (value === undefined) delete next[key]
    else next[key] = value
  }
  set('portions', portions === 1 ? undefined : portions)
  set('grams', grams)
  set('at', at)
  set('note', input.note.trim() || undefined)
  return { record: next }
}

/** Порция записи словами: «1,5 порции», «250 г», пусто — одна порция. */
export function amountText(record: Pick<Intake, 'grams' | 'portions'>): string {
  if (record.grams !== undefined) return `${numberText(record.grams)} г`
  if (record.portions === undefined || record.portions === 1) return ''
  return portionsText(record.portions)
}
