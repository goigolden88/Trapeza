/**
 * Разделы импорта еды (02-Архитектура, «Импорт записей»; Р-03, Р-09):
 * `categories`, `dishes`, `intake`.
 *
 * Чистые функции: сырой раздел и то, что уже есть в базе, на входе, записи
 * к добавлению — на выходе. Импорт только добавляет: совпавшее по
 * естественному ключу пропускается. Ключи — название у категории и блюда;
 * дата, приём и блюдо у записи.
 *
 * Разделы разбираются по порядку — категории, блюда, записи, — и реестр
 * отдаёт каждому базу вместе с тем, что завели предыдущие: блюдо из того
 * же файла не заводит свою категорию второй раз.
 *
 * Образец — `modules/time/import.ts` «Делу Время».
 */

import { toDateStr } from '../../shared/core/dates.ts'
import {
  absent,
  dayOf,
  numberOf,
  recordsOf,
  shown,
  textOf,
  type ImportContext,
  type ImportPlan,
  type ImportSpec,
  type Issue,
} from '../../shared/core/importing.ts'
import type { Category, Dish, Intake, Meal, StoreRecord } from '../../app/model.ts'
import { createCategory, createDish } from './catalog.ts'
import { FORMS, MEAL_NAMES, MEALS } from './labels.ts'
import { findByName } from './names.ts'

/** Что разделам нужно из базы. С надгробиями: по ним видно, какие id заняты. */
export type FoodData = {
  categories: readonly Category[]
  dishes: readonly Dish[]
  intake: readonly Intake[]
}

const MEAL_LIST = MEALS.map((meal) => `"${meal}" — ${MEAL_NAMES[meal].toLocaleLowerCase('ru')}`).join(', ')

// Примеры выдуманные, а не чьи-то записи: промпт уезжает к любому,
// кто открыл приложение.

export const categoriesImportSpec: ImportSpec = {
  section: 'categories',
  about:
    'категории еды — то, по чему считаются итоги: «Каши», «Супы», «Сладости». Одна запись — одна ' +
    'категория. Если в данных таблица, где столбец — категория, — это и есть категории.',
  fields: [
    '"name" — название, обязательно',
    '"group" — укрупнение для сводок, если оно есть в данных: «Крупы», «Напитки»; иначе не писать',
  ],
  example: [
    { name: 'Каши', group: 'Крупы' },
    { name: 'Горячие напитки', group: 'Напитки' },
  ],
}

export const dishesImportSpec: ImportSpec = {
  section: 'dishes',
  about:
    'блюда и продукты, которые записываются: «Овсянка», «Борщ», «Сырок». Одна запись — одно блюдо. ' +
    'Порцию и калорийность здесь можно оценить: типичные значения для такого блюда — справочно.',
  fields: [
    '"name" — название, обязательно; одно и то же блюдо — одним названием',
    '"category" — название категории; недостающая заведётся; не знаешь — не писать',
    '"portionGrams" — вес обычной порции в граммах, числом больше нуля; можно оценкой',
    '"kcal100" — килокалорий на 100 граммов, числом; можно оценкой',
    '"kcalPortion" — килокалорий на порцию, числом, — когда граммы не подходят: «кофе с молоком»',
  ],
  example: [
    { name: 'Овсянка на молоке', category: 'Каши', portionGrams: 250, kcal100: 100 },
    { name: 'Кофе с молоком', category: 'Горячие напитки', kcalPortion: 60 },
  ],
}

export const intakeImportSpec: ImportSpec = {
  section: 'intake',
  about:
    'что съедено: одно блюдо в одном приёме одного дня. Два одинаковых блюда в одном приёме — одна ' +
    'запись с "portions". Таблица по дням, где в ячейке число порций, — одна запись на ячейку и приём.',
  fields: [
    '"date" — день, ГГГГ-ММ-ДД, обязательно',
    `"meal" — приём, обязательно: ${MEAL_LIST}`,
    '"dish" — название блюда, обязательно; недостающее заведётся без категории',
    '"portions" — сколько порций, числом больше нуля, если не одна: 2, 0.5',
    '"grams" — сколько граммов, если так и записано',
    '"at" — время ЧЧ:ММ, только если оно записано у этого приёма',
    '"note" — заметка к записи: «в кафе», «изжога»',
  ],
  example: [
    { date: '2026-02-03', meal: 'breakfast', dish: 'Овсянка на молоке' },
    { date: '2026-02-03', meal: 'breakfast', dish: 'Кофе с молоком', portions: 2, at: '08:30' },
    { date: '2026-02-03', meal: 'snack', dish: 'Яблоко', note: 'на работе' },
  ],
}

// ─── Общее ─────────────────────────────────────────────────────────────────

/** Список, куда кладутся заведённые по ходу: надгробие с тем же id заменяется ожившей. */
function place<T extends { id: string }>(list: T[], record: T): void {
  const at = list.findIndex((each) => each.id === record.id)
  if (at === -1) list.push(record)
  else list[at] = record
}

/** Категория по названию: живая, архивная тоже; нет — заводится. */
function categoryFinder(data: FoodData, ctx: ImportContext) {
  const categories = [...data.categories]
  const created: Category[] = []
  function categoryFor(name: string, group?: string): Category {
    const known = findByName(categories, name)
    if (known) return known
    const category = { ...createCategory(categories, name, ctx.newId(), group), updatedAt: ctx.now }
    place(categories, category)
    created.push(category)
    return category
  }
  return { categoryFor, created }
}

/** Число больше нуля, или null. */
function positive(value: unknown): number | null {
  const number = numberOf(value)
  return number !== null && number > 0 ? number : null
}

/** Число не меньше нуля, или null. */
function nonNegative(value: unknown): number | null {
  const number = numberOf(value)
  return number !== null && number >= 0 ? number : null
}

type Checked = { value: number | undefined } | { problem: string }

/** Необязательное число: нет — undefined, кривое — причина. */
function optionalNumber(value: unknown, field: string, read: (value: unknown) => number | null, rule: string): Checked {
  if (absent(value)) return { value: undefined }
  const number = read(value)
  return number === null ? { problem: `${field} «${shown(value)}» — не ${rule}` } : { value: number }
}

const TIME = /^(\d{1,2}):(\d{2})$/

/** Время `ЧЧ:ММ`; «9:05» становится «09:05». Кривое — null. */
export function timeOf(value: unknown): string | null {
  const text = textOf(value)
  const match = text === null ? null : TIME.exec(text)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return `${String(hours).padStart(2, '0')}:${match[2]}`
}

/** Приём: код или его название по-русски — ИИ пишет и так. */
export function mealOf(value: unknown): Meal | null {
  const text = textOf(value)?.toLocaleLowerCase('ru')
  if (!text) return null
  return MEALS.find((meal) => meal === text || MEAL_NAMES[meal].toLocaleLowerCase('ru') === text) ?? null
}

// ─── Разделы ───────────────────────────────────────────────────────────────

export function importCategories(raw: unknown, data: FoodData, ctx: ImportContext): ImportPlan<StoreRecord> {
  const section = categoriesImportSpec.section
  const { records, issues } = recordsOf(section, raw)
  const { categoryFor, created } = categoryFinder(data, ctx)
  let skipped = 0

  for (const { raw: record, index } of records) {
    const name = textOf(record.name)
    if (!name) {
      issues.push({ section, title: `категория ${index + 1}`, reason: 'нет названия ("name")' })
      continue
    }
    if (!absent(record.group) && !textOf(record.group)) {
      issues.push({ section, title: name, reason: `группа «${shown(record.group)}» — не текст` })
      continue
    }
    const before = created.length
    categoryFor(name, textOf(record.group) ?? undefined)
    if (created.length === before) skipped += 1
  }

  return {
    writes: { categories: created },
    added: [{ count: created.length, forms: FORMS.category }].filter((each) => each.count > 0),
    skipped,
    issues,
  }
}

export function importDishes(raw: unknown, data: FoodData, ctx: ImportContext): ImportPlan<StoreRecord> {
  const section = dishesImportSpec.section
  const { records, issues } = recordsOf(section, raw)
  const issue = (title: string, reason: string) => issues.push({ section, title, reason })
  const { categoryFor, created: newCats } = categoryFinder(data, ctx)
  const dishes = [...data.dishes]
  const newDishes: Dish[] = []
  let skipped = 0

  for (const { raw: record, index } of records) {
    const name = textOf(record.name)
    if (!name) {
      issue(`блюдо ${index + 1}`, 'нет названия ("name")')
      continue
    }
    if (findByName(dishes, name)) {
      skipped += 1
      continue
    }

    const categoryName = textOf(record.category)
    if (!absent(record.category) && !categoryName) {
      issue(name, `категория «${shown(record.category)}» — не текст`)
      continue
    }

    const checks = {
      portionGrams: optionalNumber(record.portionGrams, 'порция', positive, 'граммы больше нуля'),
      kcal100: optionalNumber(record.kcal100, 'ккал на 100 г', nonNegative, 'число'),
      kcalPortion: optionalNumber(record.kcalPortion, 'ккал на порцию', nonNegative, 'число'),
    }
    const problem = Object.values(checks).find((check): check is { problem: string } => 'problem' in check)
    if (problem) {
      issue(name, problem.problem)
      continue
    }
    const value = (check: Checked) => ('value' in check ? check.value : undefined)

    // Категория заводится только для блюда, прошедшего проверки: кривая
    // запись не должна оставлять после себя пустых категорий.
    const category = categoryName ? categoryFor(categoryName) : null
    const dish = {
      ...createDish(dishes, name, ctx.newId(), {
        categoryId: category?.id,
        portionGrams: value(checks.portionGrams),
        kcal100: value(checks.kcal100),
        kcalPortion: value(checks.kcalPortion),
      }),
      updatedAt: ctx.now,
    }
    place(dishes, dish)
    newDishes.push(dish)
  }

  return {
    writes: { categories: newCats, dishes: newDishes },
    added: [
      { count: newDishes.length, forms: FORMS.dish },
      { count: newCats.length, forms: FORMS.category },
    ].filter((each) => each.count > 0),
    skipped,
    issues,
  }
}

/** Естественный ключ записи (02-Архитектура): дата, приём, блюдо. */
function intakeKey(date: string, meal: Meal, dishId: string): string {
  return `${date}|${meal}|${dishId}`
}

export function importIntake(raw: unknown, data: FoodData, ctx: ImportContext): ImportPlan<StoreRecord> {
  const section = intakeImportSpec.section
  const { records, issues } = recordsOf(section, raw)
  const issue = (title: string, reason: string) => issues.push({ section, title, reason } satisfies Issue)
  const today = toDateStr(new Date(ctx.now))

  const dishes = [...data.dishes]
  const newDishes: Dish[] = []
  const newIntake: Intake[] = []
  const known = new Set(
    data.intake.filter((record) => !record.deleted).map((record) => intakeKey(record.date, record.meal, record.dishId)),
  )
  const inFile = new Set<string>()
  let skipped = 0

  function dishFor(name: string): Dish {
    const found = findByName(dishes, name)
    if (found) return found
    const dish = { ...createDish(dishes, name, ctx.newId()), updatedAt: ctx.now }
    place(dishes, dish)
    newDishes.push(dish)
    return dish
  }

  for (const { raw: record, index } of records) {
    const title = `запись ${index + 1}`

    const date = dayOf(record.date)
    if (!date) {
      issue(title, absent(record.date) ? 'нет дня ("date")' : `день «${shown(record.date)}» — не ГГГГ-ММ-ДД`)
      continue
    }
    if (date > today) {
      issue(title, `день ${date} ещё не наступил — учёт про то, что было`)
      continue
    }

    const meal = mealOf(record.meal)
    if (!meal) {
      issue(title, absent(record.meal) ? 'нет приёма ("meal")' : `приём «${shown(record.meal)}» — не из ${MEALS.join(', ')}`)
      continue
    }

    const name = textOf(record.dish)
    if (!name) {
      issue(title, 'нет блюда ("dish")')
      continue
    }
    const where = `${name}, ${date}, ${MEAL_NAMES[meal].toLocaleLowerCase('ru')}`

    const portions = optionalNumber(record.portions, 'порции', positive, 'число больше нуля')
    const grams = optionalNumber(record.grams, 'граммы', positive, 'число больше нуля')
    const bad = [portions, grams].find((check): check is { problem: string } => 'problem' in check)
    if (bad) {
      issue(where, bad.problem)
      continue
    }
    const time = timeOf(record.at)
    if (!absent(record.at) && !time) {
      issue(where, `время «${shown(record.at)}» — не ЧЧ:ММ`)
      continue
    }
    if (!absent(record.note) && !textOf(record.note)) {
      issue(where, `заметка «${shown(record.note)}» — не текст`)
      continue
    }

    // Блюдо заводится только для записи, прошедшей проверки.
    const dish = dishFor(name)
    const key = intakeKey(date, meal, dish.id)
    if (known.has(key)) {
      skipped += 1
      continue
    }
    if (inFile.has(key)) {
      // Молча пропустить — потерять порции: в таблице это одна ячейка с суммой.
      issue(where, 'повтор в файле — одинаковые блюда одного приёма пишутся одной записью с "portions"')
      continue
    }
    inFile.add(key)

    const saved: Intake = { id: ctx.newId(), updatedAt: ctx.now, date, meal, dishId: dish.id }
    if ('value' in portions && portions.value !== undefined) saved.portions = portions.value
    if ('value' in grams && grams.value !== undefined) saved.grams = grams.value
    if (time) saved.at = time
    const note = textOf(record.note)
    if (note) saved.note = note
    newIntake.push(saved)
  }

  return {
    writes: { dishes: newDishes, intake: newIntake },
    added: [
      { count: newIntake.length, forms: FORMS.intake },
      { count: newDishes.length, forms: FORMS.dish },
    ].filter((each) => each.count > 0),
    skipped,
    issues,
  }
}
