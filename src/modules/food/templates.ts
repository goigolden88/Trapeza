/**
 * Шаблоны — приёма и дня (Р-08, п. 3; Р-28): завести из записанного,
 * применить к дню без дублей, переименовать, переставить.
 *
 * Одна запись на оба вида: у шаблона приёма есть `meal`, у шаблона дня его
 * нет, и приём — у каждого блюда. Инвариант держит этот модуль, а не тип:
 * кривое блюдо шаблона дня без приёма пропускается, а не падает.
 *
 * Чистые функции, без React и без базы. Образец — `modules/notes/templates.ts`
 * «Делу Время» (их Р-39, Р-75).
 */

import { nowIso, type DateStr } from '../../shared/core/dates.ts'
import { ulid } from '../../shared/core/id.ts'
import type { Dish, Intake, Meal, Template } from '../../app/model.ts'
import { amountText } from './forms.ts'
import { MEAL_NAMES, MEALS } from './labels.ts'
import { normName } from './names.ts'

export type TemplateItem = Template['items'][number]

/** Блюдо шаблона с приёмом — то, что ставится в день. */
export type PlacedItem = { meal: Meal; dishId: string; portions?: number; grams?: number }

/** Вид шаблона: приём или весь день. */
export type TemplateKind = Meal | 'day'

/** Длиннее кнопка шаблона на «Сегодня» не читается. */
export const MAX_TEMPLATE_NAME = 30

export function kindOf(template: Pick<Template, 'meal'>): TemplateKind {
  return template.meal ?? 'day'
}

function isMeal(value: unknown): value is Meal {
  return MEALS.includes(value as Meal)
}

/** Живые шаблоны одного вида в порядке кнопок. */
export function templatesOf(templates: readonly Template[], kind: TemplateKind): Template[] {
  return templates
    .filter((template) => !template.deleted && kindOf(template) === kind)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ru'))
}

/** Название по умолчанию: «Обычный завтрак», «Обычный день». */
export function defaultTemplateName(kind: TemplateKind): string {
  return kind === 'day' ? 'Обычный день' : `Обычный ${MEAL_NAMES[kind].toLowerCase()}`
}

// ─── Из записанного ────────────────────────────────────────────────────────

function amountOf(record: Pick<Intake, 'portions' | 'grams'>): Pick<TemplateItem, 'portions' | 'grams'> {
  const amount: Pick<TemplateItem, 'portions' | 'grams'> = {}
  if (record.portions !== undefined) amount.portions = record.portions
  if (record.grams !== undefined) amount.grams = record.grams
  return amount
}

/**
 * Блюда шаблона из записей (Р-28): порции и граммы — из записей, время и
 * заметка — нет, они про тот день. Приёмы — в порядке дня, внутри — в порядке
 * записи. Одно блюдо дважды в приёме — записи двух устройств (Р-20) — берётся
 * первым. `withMeal` — для шаблона дня: приём остаётся у блюда.
 */
export function itemsFromRecords(records: readonly Intake[], withMeal: boolean): TemplateItem[] {
  const live = records
    .filter((record) => !record.deleted && isMeal(record.meal))
    .sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal) || a.id.localeCompare(b.id))
  const seen = new Set<string>()
  const items: TemplateItem[] = []
  for (const record of live) {
    const key = `${record.meal}|${record.dishId}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push({ ...(withMeal ? { meal: record.meal } : {}), dishId: record.dishId, ...amountOf(record) })
  }
  return items
}

// ─── Название ──────────────────────────────────────────────────────────────

export type NameCheck =
  | { ok: true }
  | { ok: false; problem: 'empty' | 'long' | 'other-kind' }
  /** То же название у шаблона того же вида — можно заменить его состав. */
  | { ok: false; problem: 'same-kind'; existing: Template }

export const NAME_PROBLEM_TEXT: Record<'empty' | 'long' | 'other-kind' | 'same-kind', string> = {
  empty: 'У шаблона нет названия',
  long: `Название шаблона — не длиннее ${MAX_TEMPLATE_NAME} знаков`,
  'other-kind': 'Шаблон с таким названием уже есть — у другого приёма или у дня',
  'same-kind': 'Шаблон с таким названием уже есть',
}

/**
 * Годится ли название (Р-28). Два шаблона с одним названием на кнопках не
 * различить — регистр, «ё» и пробелы не в счёт. `selfId` — у переименования.
 */
export function checkTemplateName(
  templates: readonly Template[],
  name: string,
  kind: TemplateKind,
  selfId?: string,
): NameCheck {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, problem: 'empty' }
  if (trimmed.length > MAX_TEMPLATE_NAME) return { ok: false, problem: 'long' }
  const key = normName(trimmed)
  const existing = templates.find((each) => !each.deleted && each.id !== selfId && normName(each.name) === key)
  if (!existing) return { ok: true }
  return kindOf(existing) === kind ? { ok: false, problem: 'same-kind', existing } : { ok: false, problem: 'other-kind' }
}

// ─── Заведение и правка ────────────────────────────────────────────────────

/** Новый шаблон — последним среди своего вида. Название проверено `checkTemplateName`. */
export function createTemplate(
  templates: readonly Template[],
  name: string,
  kind: TemplateKind,
  items: TemplateItem[],
): Template {
  const order = Math.max(-1, ...templatesOf(templates, kind).map((each) => each.order)) + 1
  return {
    id: ulid(),
    updatedAt: nowIso(),
    name: name.trim(),
    ...(kind === 'day' ? {} : { meal: kind }),
    items,
    order,
  }
}

/** «Заменить состав»: пересохранение из записанного под занятым названием (Р-28). */
export function replaceItems(template: Template, items: TemplateItem[]): Template {
  return { ...template, items }
}

export function renameTemplate(template: Template, name: string): Template {
  return { ...template, name: name.trim() }
}

/**
 * Сдвиг шаблона выше или ниже среди живых своего вида (их Р-75). Порядок
 * заново подряд с нуля: после удалений в нём бывают дыры. Возвращает
 * изменённые; сдвигать некуда — пусто.
 */
export function moveTemplate(templates: readonly Template[], id: string, step: -1 | 1): Template[] {
  const self = templates.find((template) => template.id === id && !template.deleted)
  if (!self) return []
  const list = templatesOf(templates, kindOf(self))
  const from = list.findIndex((template) => template.id === id)
  const a = list[from]
  const b = list[from + step]
  if (!a || !b) return []
  list[from] = b
  list[from + step] = a
  return list.flatMap((template, order) => (template.order === order ? [] : [{ ...template, order }]))
}

// ─── Применение ────────────────────────────────────────────────────────────

/** Блюда шаблона с приёмами. У шаблона дня блюдо без приёма пропускается. */
export function placedItems(template: Template): PlacedItem[] {
  return template.items.flatMap((item): PlacedItem[] => {
    const meal = template.meal ?? item.meal
    if (!isMeal(meal)) return []
    return [{ meal, dishId: item.dishId, ...amountOf(item) }]
  })
}

export type Applied = {
  /** Что поставить в день — без дублей. */
  add: PlacedItem[]
  /** Приёмы шаблона, оставленные на потом: на сегодня они ещё не начались. */
  later: Meal[]
}

/**
 * Применить шаблон к дню без дублей (Р-08, Р-28): блюдо, уже стоящее в этом
 * приёме этого дня, второй раз не ставится. `allowed` — приёмы, которые можно
 * писать: на сегодня — начавшиеся, на прошлый день — все. Блюдо, которого
 * в справочнике нет или оно удалено, пропускается.
 */
export function applyTemplate(
  template: Template,
  dayRecords: readonly Intake[],
  allowed: readonly Meal[],
  dishes: ReadonlyMap<string, Dish>,
): Applied {
  const taken = new Set(dayRecords.filter((record) => !record.deleted).map((record) => `${record.meal}|${record.dishId}`))
  const add: PlacedItem[] = []
  const later = new Set<Meal>()
  for (const item of placedItems(template)) {
    const dish = dishes.get(item.dishId)
    if (!dish || dish.deleted) continue
    const key = `${item.meal}|${item.dishId}`
    if (taken.has(key)) continue
    if (!allowed.includes(item.meal)) {
      later.add(item.meal)
      continue
    }
    taken.add(key)
    add.push(item)
  }
  return { add, later: MEALS.filter((meal) => later.has(meal)) }
}

/** Записи из применённого: ULID, приём и день. */
export function intakeFrom(items: readonly PlacedItem[], day: DateStr): Intake[] {
  return items.map((item) => ({ id: ulid(), updatedAt: nowIso(), date: day, ...item }))
}

/** Блюда шаблона одного приёма: у шаблона приёма — все, у шаблона дня — этого приёма. */
export function itemsForMeal(template: Template, meal: Meal): PlacedItem[] {
  return placedItems(template).filter((item) => item.meal === meal)
}

/**
 * Состав словами: у шаблона приёма — «Каша 2 порции, Компот»; у шаблона
 * дня — по приёмам: «Завтрак: Каша, Компот · Обед: Суп».
 */
export function templateText(template: Template, dishes: ReadonlyMap<string, Dish>): string {
  const items = placedItems(template)
  const names = (list: readonly PlacedItem[]) =>
    list
      .map((item) => {
        const amount = amountText(item)
        return `${dishes.get(item.dishId)?.name ?? 'блюдо удалено'}${amount ? ` ${amount}` : ''}`
      })
      .join(', ')
  if (template.meal !== undefined) return names(items)
  return MEALS.flatMap((meal) => {
    const here = items.filter((item) => item.meal === meal)
    return here.length > 0 ? [`${MEAL_NAMES[meal]}: ${names(here)}`] : []
  }).join(' · ')
}
