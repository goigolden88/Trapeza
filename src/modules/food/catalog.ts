/**
 * Справочник: категории и блюда — порядок, архив, заведение, удаление
 * с переносом и слияние одноимённых (Р-12).
 *
 * Чистые функции, без React и без базы. Образец — `modules/time/categories.ts`
 * «Делу Время» (их Р-22, Р-29); своё здесь — два справочника вместо одного
 * и то, что за ними тянется: блюда ссылаются на категорию, записи и шаблоны —
 * на блюдо, нормы — на набор категорий (Р-13).
 */

import { nowIso } from '../../core/dates.ts'
import type { Category, Dish, Intake, MealTemplate, Norm } from '../../core/model.ts'
import { cleanName, idFor, normName, type Named } from './names.ts'

/** Всё, что задевает справочник. С надгробиями: по ним видно, какие id заняты. */
export type CatalogData = {
  categories: readonly Category[]
  dishes: readonly Dish[]
  templates: readonly MealTemplate[]
  norms: readonly Norm[]
  intake: readonly Intake[]
}

/** Что записать. Хранилище без правок — пустой список. */
export type CatalogPlan = {
  categories: Category[]
  dishes: Dish[]
  templates: MealTemplate[]
  norms: Norm[]
  intake: Intake[]
}

function emptyPlan(): CatalogPlan {
  return { categories: [], dishes: [], templates: [], norms: [], intake: [] }
}

/** Сколько записей в плане. */
export function planSize(plan: CatalogPlan): number {
  return (
    plan.categories.length + plan.dishes.length + plan.templates.length + plan.norms.length + plan.intake.length
  )
}

// ─── Порядок и архив ───────────────────────────────────────────────────────

/** Живые категории по порядку, архив тоже. */
export function sortCategories(categories: readonly Category[]): Category[] {
  return categories
    .filter((category) => !category.deleted)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ru'))
}

/** Категории, в которые раскладывают сейчас: живые, не в архиве, по порядку. */
export function activeCategories(categories: readonly Category[]): Category[] {
  return sortCategories(categories).filter((category) => !category.archived)
}

export function archivedCategories(categories: readonly Category[]): Category[] {
  return sortCategories(categories).filter((category) => category.archived === true)
}

/** Живые блюда по названию, архив тоже. Своего порядка у блюда нет: в приёме порядок — частота (Р-08). */
export function sortDishes(dishes: readonly Dish[]): Dish[] {
  return dishes.filter((dish) => !dish.deleted).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

/** Блюда, которые записывают сейчас. */
export function activeDishes(dishes: readonly Dish[]): Dish[] {
  return sortDishes(dishes).filter((dish) => !dish.archived)
}

export function archivedDishes(dishes: readonly Dish[]): Dish[] {
  return sortDishes(dishes).filter((dish) => dish.archived === true)
}

function nextOrder(categories: readonly Category[]): number {
  const live = categories.filter((category) => !category.deleted)
  return live.length === 0 ? 0 : Math.max(...live.map((category) => category.order)) + 1
}

/**
 * Новая категория — в конец списка. Название проверено `nameProblem`.
 * На месте надгробия оживает с тем же id.
 */
export function createCategory(
  categories: readonly Category[],
  name: string,
  suffix: string,
  group?: string,
): Category {
  const cleanGroup = group === undefined ? '' : cleanName(group)
  return {
    id: idFor(categories, 'cat', name, suffix),
    updatedAt: nowIso(),
    name: cleanName(name),
    order: nextOrder(categories),
    ...(cleanGroup ? { group: cleanGroup } : {}),
  }
}

/** Свойства блюда, кроме названия. */
export type DishFields = Pick<Dish, 'categoryId' | 'portionGrams' | 'kcal100' | 'kcalPortion'>

/** Новое блюдо. Название проверено `nameProblem`; на месте надгробия оживает. */
export function createDish(dishes: readonly Dish[], name: string, suffix: string, fields: DishFields = {}): Dish {
  const dish: Dish = { id: idFor(dishes, 'dish', name, suffix), updatedAt: nowIso(), name: cleanName(name) }
  if (fields.categoryId !== undefined) dish.categoryId = fields.categoryId
  if (fields.portionGrams !== undefined) dish.portionGrams = fields.portionGrams
  if (fields.kcal100 !== undefined) dish.kcal100 = fields.kcal100
  if (fields.kcalPortion !== undefined) dish.kcalPortion = fields.kcalPortion
  return dish
}

/** Из архива — в конец списка: прежнее место давно заняли. */
export function restoreCategory(categories: readonly Category[], category: Category): Category {
  return { ...category, archived: false, order: nextOrder(categories) }
}

/**
 * Сдвиг категории на место выше или ниже среди неархивных.
 *
 * Порядок пересчитывается подряд с нуля: после архивов и слияний в нём
 * бывают дыры и повторы, и обмен двух чисел их бы не убрал. Возвращает
 * только те, у которых порядок изменился. Сдвигать некуда — пусто.
 */
export function moveCategory(categories: readonly Category[], id: string, step: -1 | 1): Category[] {
  const list = activeCategories(categories)
  const from = list.findIndex((category) => category.id === id)
  const a = list[from]
  const b = list[from + step]
  if (from === -1 || !a || !b) return []
  list[from] = b
  list[from + step] = a
  return list.flatMap((category, order) => (category.order === order ? [] : [{ ...category, order }]))
}

// ─── Что ссылается ─────────────────────────────────────────────────────────

/** Живые блюда категории. */
export function dishesOf(dishes: readonly Dish[], categoryId: string): Dish[] {
  return dishes.filter((dish) => !dish.deleted && dish.categoryId === categoryId)
}

/** Сколько живых записей ссылается на блюдо. */
export function intakeUsing(intake: readonly Intake[], dishId: string): number {
  return intake.filter((record) => !record.deleted && record.dishId === dishId).length
}

/** Живые шаблоны, где стоит блюдо. */
function templatesUsing(templates: readonly MealTemplate[], dishId: string): MealTemplate[] {
  return templates.filter((template) => !template.deleted && template.items.some((item) => item.dishId === dishId))
}

/** Живые нормы, где стоит категория. */
function normsUsing(norms: readonly Norm[], categoryId: string): Norm[] {
  return norms.filter((norm) => !norm.deleted && norm.categoryIds.includes(categoryId))
}

/** Шаблон, где блюда переехали по `move`. Блюдо, уже стоящее в шаблоне, второй раз не ставится (Р-08). */
function moveTemplate(template: MealTemplate, move: (id: string) => string): MealTemplate | null {
  const seen = new Set<string>()
  const items: MealTemplate['items'] = []
  let changed = false
  for (const item of template.items) {
    const dishId = move(item.dishId)
    if (dishId !== item.dishId) changed = true
    if (seen.has(dishId)) {
      changed = true
      continue
    }
    seen.add(dishId)
    items.push(dishId === item.dishId ? item : { ...item, dishId })
  }
  return changed ? { ...template, items } : null
}

/** Норма, где категории переехали по `move`, без повторов. */
function moveNorm(norm: Norm, move: (id: string) => string): Norm | null {
  const categoryIds = [...new Set(norm.categoryIds.map(move))]
  const same =
    categoryIds.length === norm.categoryIds.length && categoryIds.every((id, index) => id === norm.categoryIds[index])
  return same ? null : { ...norm, categoryIds }
}

// ─── Удаление с переносом (Р-12) ───────────────────────────────────────────

/**
 * Удаление категории: надгробие. Если на неё ссылаются блюда или нормы,
 * они сначала переходят в `moveTo` — без этого удалить нельзя, и ответ null.
 * Null и тогда, когда удалять нечего.
 *
 * Надгробие помнит, куда перенесено, — `movedTo`: блюдо, заведённое в эту
 * категорию на другом устройстве до обмена, приедет позже и перейдёт туда
 * же само (`reconcilePlan`). Перенос — это и слияние двух категорий.
 */
export function removeCategoryPlan(data: CatalogData, id: string, moveTo: string | null): CatalogPlan | null {
  const category = data.categories.find((each) => each.id === id && !each.deleted)
  if (!category) return null
  const target = data.categories.find((each) => each.id === moveTo && !each.deleted && each.id !== id)

  const dishes = dishesOf(data.dishes, id)
  const norms = normsUsing(data.norms, id)
  if ((dishes.length > 0 || norms.length > 0) && !target) return null

  const plan = emptyPlan()
  plan.categories.push({ ...category, deleted: true, ...(target ? { movedTo: target.id } : {}) })
  if (target) {
    const move = (each: string) => (each === id ? target.id : each)
    plan.dishes = dishes.map((dish) => ({ ...dish, categoryId: target.id }))
    plan.norms = norms.flatMap((norm) => moveNorm(norm, move) ?? [])
  }
  return plan
}

/**
 * Удаление блюда: надгробие. Записи и шаблоны, где оно стоит, сначала
 * переходят в `moveTo`; есть записи или шаблоны, а переноса нет — null.
 */
export function removeDishPlan(data: CatalogData, id: string, moveTo: string | null): CatalogPlan | null {
  const dish = data.dishes.find((each) => each.id === id && !each.deleted)
  if (!dish) return null
  const target = data.dishes.find((each) => each.id === moveTo && !each.deleted && each.id !== id)

  const intake = data.intake.filter((record) => !record.deleted && record.dishId === id)
  const templates = templatesUsing(data.templates, id)
  if ((intake.length > 0 || templates.length > 0) && !target) return null

  const plan = emptyPlan()
  plan.dishes.push({ ...dish, deleted: true, ...(target ? { movedTo: target.id } : {}) })
  if (target) {
    const move = (each: string) => (each === id ? target.id : each)
    plan.intake = intake.map((record) => ({ ...record, dishId: target.id }))
    plan.templates = templates.flatMap((template) => moveTemplate(template, move) ?? [])
  }
  return plan
}

// ─── Одноимённые и надгробия с переносом (Р-12) ───────────────────────────

/**
 * Какая из одноимённых остаётся: чей id совпадает с названием, иначе
 * с наименьшим id. По id, а не по времени правки: время два устройства
 * могут видеть разным, id — одинаковым, и выбор на обоих выйдет один.
 */
function survivorOf<T extends Named>(group: readonly T[], prefix: 'cat' | 'dish', key: string): T {
  const named = group.find((each) => each.id === `${prefix}:${key}`)
  if (named) return named
  return group.reduce((best, each) => (each.id < best.id ? each : best))
}

/** Самая поздняя правка группы. Равные по времени — по id: ответ один. */
function latestOf<T extends Named & { updatedAt: string }>(group: readonly T[]): T {
  return group.reduce((best, each) =>
    each.updatedAt > best.updatedAt || (each.updatedAt === best.updatedAt && each.id < best.id) ? each : best,
  )
}

/** Содержимое категории — всё, кроме `Base` и `movedTo`. */
const CATEGORY_CONTENT = ['name', 'order', 'group', 'archived'] as const
/** Содержимое блюда. Рецепт — тоже содержимое (Р-07). */
const DISH_CONTENT = ['name', 'categoryId', 'portionGrams', 'kcal100', 'kcalPortion', 'recipe', 'archived'] as const

/** Значение поля для сравнения: архив «нет» и отсутствие поля — одно и то же. */
function contentOf(value: unknown, field: PropertyKey): unknown {
  return field === 'archived' && !value ? undefined : value
}

/** Оставшаяся с содержимым поздней правки. Ничего не поменялось — null. */
function withContent<T extends Named & { movedTo?: string }>(
  survivor: T,
  latest: T,
  fields: readonly (keyof T)[],
): T | null {
  const next = { ...survivor }
  let changed = survivor.movedTo !== undefined
  delete next.movedTo
  for (const field of fields) {
    const value = contentOf(latest[field], field)
    if (JSON.stringify(value) !== JSON.stringify(contentOf(survivor[field], field))) changed = true
    if (value === undefined) delete next[field]
    else next[field] = value as T[keyof T]
  }
  return changed ? next : null
}

/** Куда ведёт цепочка переносов. */
type Moves = { next: Map<string, string>; live: Set<string> }

/** Конец цепочки переносов, если он у живой записи. Кольцо или мёртвый конец — null. */
function destination(moves: Moves, id: string): string | null {
  const seen = new Set<string>()
  let current = id
  while (moves.next.has(current)) {
    if (seen.has(current)) return null
    seen.add(current)
    current = moves.next.get(current) as string
  }
  return current !== id && moves.live.has(current) ? current : null
}

/**
 * Слить одноимённые в одном справочнике: группы по ключу названия, оставшаяся
 * получает содержимое поздней правки, остальные — надгробия с `movedTo`.
 * Правки кладутся в `out` по id, чтобы одна запись не попала в план дважды.
 */
function mergeNamesakes<T extends Named & { updatedAt: string; movedTo?: string }>(
  list: readonly T[],
  prefix: 'cat' | 'dish',
  fields: readonly (keyof T)[],
  out: Map<string, T>,
): Moves {
  const next = new Map<string, string>()
  for (const each of list) {
    if (each.deleted && each.movedTo) next.set(each.id, each.movedTo)
  }

  const groups = new Map<string, T[]>()
  for (const each of list) {
    const key = normName(each.name)
    if (each.deleted || !key) continue
    groups.set(key, [...(groups.get(key) ?? []), each])
  }

  for (const [key, group] of groups) {
    if (group.length < 2) continue
    const survivor = survivorOf(group, prefix, key)
    const updated = withContent(survivor, latestOf(group), fields)
    if (updated) out.set(updated.id, updated)
    for (const each of group) {
      if (each.id === survivor.id) continue
      out.set(each.id, { ...each, deleted: true, movedTo: survivor.id })
      next.set(each.id, survivor.id)
    }
  }

  const live = new Set(list.filter((each) => !each.deleted && !next.has(each.id)).map((each) => each.id))
  return { next, live }
}

/**
 * Слияние одноимённых категорий и блюд и перенос от надгробий (Р-12) —
 * после прихода данных с сервера или из файла.
 *
 * Одноимённые — регистр, «ё» и пробелы не в счёт — сливаются: остаётся
 * `survivorOf`, содержимое берётся у поздней правки, остальные уходят
 * надгробием с `movedTo`. Всё, что ссылается на надгробие с `movedTo`, —
 * блюда на категорию, записи и шаблоны на блюдо, нормы на категории —
 * переходит по цепочке туда, куда оно указывает. Кольцо в цепочке или конец
 * не у живой записи — не трогаем.
 *
 * Считается одинаково на всех устройствах: увидев одно и то же, два
 * устройства пишут одно и то же. Делать нечего — план пуст.
 */
export function reconcilePlan(data: CatalogData): CatalogPlan {
  const categories = new Map<string, Category>()
  const dishes = new Map<string, Dish>()

  const catMoves = mergeNamesakes(data.categories, 'cat', CATEGORY_CONTENT, categories)
  const dishMoves = mergeNamesakes(data.dishes, 'dish', DISH_CONTENT, dishes)
  const catOf = (id: string) => destination(catMoves, id) ?? id
  const dishOf = (id: string) => destination(dishMoves, id) ?? id

  // Блюдо — в оставшуюся категорию. Берётся уже слитая версия, если она есть.
  for (const original of data.dishes) {
    const dish = dishes.get(original.id) ?? original
    if (dish.deleted || dish.categoryId === undefined) continue
    const to = catOf(dish.categoryId)
    if (to !== dish.categoryId) dishes.set(dish.id, { ...dish, categoryId: to })
  }

  const plan = emptyPlan()
  plan.categories = [...categories.values()]
  plan.dishes = [...dishes.values()]
  plan.intake = data.intake.flatMap((record) => {
    if (record.deleted) return []
    const to = dishOf(record.dishId)
    return to === record.dishId ? [] : [{ ...record, dishId: to }]
  })
  plan.templates = data.templates.flatMap((template) => (template.deleted ? [] : (moveTemplate(template, dishOf) ?? [])))
  plan.norms = data.norms.flatMap((norm) => (norm.deleted ? [] : (moveNorm(norm, catOf) ?? [])))
  return plan
}
