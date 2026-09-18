import { describe, expect, it } from 'vitest'
import type { Category, Dish, Intake, Template, Norm } from '../../app/model.ts'
import {
  activeCategories,
  activeDishes,
  archivedCategories,
  createCategory,
  createDish,
  moveCategory,
  planSize,
  reconcilePlan,
  removeCategoryPlan,
  removeDishPlan,
  restoreCategory,
  type CatalogData,
} from './catalog.ts'
import { cleanName, idFor, nameProblem, normName, sameName } from './names.ts'

const at = '2026-09-16T10:00:00.000Z'
const later = '2026-09-16T11:00:00.000Z'

function cat(name: string, fields: Partial<Category> = {}): Category {
  return { id: `cat:${normName(name)}`, updatedAt: at, name, order: 0, ...fields }
}

function dish(name: string, fields: Partial<Dish> = {}): Dish {
  return { id: `dish:${normName(name)}`, updatedAt: at, name, ...fields }
}

function intake(id: string, dishId: string, fields: Partial<Intake> = {}): Intake {
  return { id, updatedAt: at, date: '2026-02-03', meal: 'lunch', dishId, ...fields }
}

function data(fields: Partial<CatalogData> = {}): CatalogData {
  return { categories: [], dishes: [], templates: [], norms: [], intake: [], ...fields }
}

describe('названия и id — Р-12', () => {
  it('регистр, «ё» и лишние пробелы не в счёт', () => {
    expect(normName('  Ёжики   в  Тумане ')).toBe('ежики в тумане')
    expect(sameName('Щи ', 'щи')).toBe(true)
    expect(sameName('Мёд', 'мед')).toBe(true)
    expect(sameName('Борщ', 'Борщи')).toBe(false)
    expect(cleanName('  Суп   с  фрикадельками ')).toBe('Суп с фрикадельками')
  })

  it('свободное — из названия; занято живой переименованной — с суффиксом; надгробием — тот же id', () => {
    expect(idFor([], 'dish', 'Борщ', 'x')).toBe('dish:борщ')
    const renamed = dish('Щи', { id: 'dish:борщ' })
    expect(idFor([renamed], 'dish', 'Борщ', 'x')).toBe('dish:борщ:x')
    expect(idFor([{ ...renamed, deleted: true }], 'dish', 'Борщ', 'x')).toBe('dish:борщ')
    expect(idFor([], 'cat', 'Каши', 'x')).toBe('cat:каши')
  })

  it('пустое, двойник и двойник в архиве — разные причины; своё прежнее название не мешает', () => {
    const list = [dish('Борщ'), dish('Кисель', { archived: true }), dish('Плов', { deleted: true })]
    expect(nameProblem(list, '   ')).toBe('empty')
    expect(nameProblem(list, 'борщ')).toBe('duplicate')
    expect(nameProblem(list, 'КИСЕЛЬ')).toBe('archived')
    expect(nameProblem(list, 'Плов')).toBeNull()
    expect(nameProblem(list, 'Борщ', 'dish:борщ')).toBeNull()
  })
})

describe('порядок и архив', () => {
  const list = [
    cat('Супы', { order: 2 }),
    cat('Каши', { order: 0 }),
    cat('Компот', { order: 1, archived: true }),
    cat('Плов', { order: 3, deleted: true }),
    cat('Салаты', { order: 2 }),
  ]

  it('категории по порядку, при равном — по названию; архив отдельно; удалённых нет', () => {
    expect(activeCategories(list).map((each) => each.name)).toEqual(['Каши', 'Салаты', 'Супы'])
    expect(archivedCategories(list).map((each) => each.name)).toEqual(['Компот'])
  })

  it('блюда — по названию, без архива и удалённых', () => {
    const dishes = [dish('Щи'), dish('Борщ'), dish('Кисель', { archived: true }), dish('Акрошка', { deleted: true })]
    expect(activeDishes(dishes).map((each) => each.name)).toEqual(['Борщ', 'Щи'])
  })

  it('новая и возвращённая из архива — в конец; группа без пробелов, пустая не пишется', () => {
    const created = createCategory(list, '  Мясное ', 'x', ' Мясное+Рыбное ')
    expect(created).toMatchObject({ id: 'cat:мясное', name: 'Мясное', order: 3, group: 'Мясное+Рыбное' })
    expect(createCategory(list, 'Рыба', 'x', '  ')).not.toHaveProperty('group')
    expect(restoreCategory(list, cat('Компот', { order: 1, archived: true }))).toMatchObject({ archived: false, order: 3 })
  })

  it('новое блюдо — только заданные поля', () => {
    const created = createDish([], ' Борщ ', 'x', { categoryId: 'cat:супы', kcal100: 50 })
    expect(created).toMatchObject({ id: 'dish:борщ', name: 'Борщ', categoryId: 'cat:супы', kcal100: 50 })
    expect(created).not.toHaveProperty('portionGrams')
  })

  it('сдвиг пересчитывает порядок подряд и отдаёт только изменённые; сдвигать некуда — пусто', () => {
    const moved = moveCategory(list, 'cat:супы', -1)
    // Салаты уже стоят на 2 — их не пишем.
    expect(moved.map((each) => [each.name, each.order])).toEqual([['Супы', 1]])
    const gaps = [cat('А', { order: 5 }), cat('Б', { order: 9 })]
    expect(moveCategory(gaps, 'cat:б', -1).map((each) => [each.name, each.order])).toEqual([
      ['Б', 0],
      ['А', 1],
    ])
    expect(moveCategory(list, 'cat:каши', -1)).toEqual([])
    expect(moveCategory(list, 'cat:нет', 1)).toEqual([])
  })
})

describe('удаление с переносом — Р-12', () => {
  const soups = cat('Супы')
  const hot = cat('Горячее', { order: 1 })
  const borsch = dish('Борщ', { categoryId: soups.id })
  const shchi = dish('Щи', { categoryId: soups.id })

  it('пустая категория — просто надгробие', () => {
    const plan = removeCategoryPlan(data({ categories: [soups, hot] }), hot.id, null)
    expect(plan?.categories).toEqual([{ ...hot, deleted: true }])
    expect(planSize(plan!)).toBe(1)
  })

  it('категория с блюдами или нормами без переноса — нельзя', () => {
    expect(removeCategoryPlan(data({ categories: [soups], dishes: [borsch] }), soups.id, null)).toBeNull()
    const norm: Norm = { id: 'n1', updatedAt: at, name: 'Суп', categoryIds: [soups.id], order: 0 }
    expect(removeCategoryPlan(data({ categories: [soups], norms: [norm] }), soups.id, null)).toBeNull()
    expect(removeCategoryPlan(data({ categories: [soups], dishes: [borsch] }), soups.id, soups.id)).toBeNull()
  })

  it('перенос категории: блюда и нормы переходят, повтор в норме снимается, надгробие помнит куда', () => {
    const norm: Norm = { id: 'n1', updatedAt: at, name: 'Горячее', categoryIds: [hot.id, soups.id], order: 0 }
    const plan = removeCategoryPlan(data({ categories: [soups, hot], dishes: [borsch], norms: [norm] }), soups.id, hot.id)
    expect(plan?.categories).toEqual([{ ...soups, deleted: true, movedTo: hot.id }])
    expect(plan?.dishes).toEqual([{ ...borsch, categoryId: hot.id }])
    expect(plan?.norms).toEqual([{ ...norm, categoryIds: [hot.id] }])
  })

  it('блюдо с записями без переноса — нельзя; с переносом — записи и шаблоны переходят без дублей', () => {
    const record = intake('i1', borsch.id)
    const template: Template = {
      id: 't1',
      updatedAt: at,
      name: 'Обед',
      meal: 'lunch',
      items: [{ dishId: borsch.id }, { dishId: shchi.id, portions: 2 }],
      order: 0,
    }
    const both = data({ dishes: [borsch, shchi], intake: [record], templates: [template] })
    expect(removeDishPlan(both, borsch.id, null)).toBeNull()

    const plan = removeDishPlan(both, borsch.id, shchi.id)
    expect(plan?.dishes).toEqual([{ ...borsch, deleted: true, movedTo: shchi.id }])
    expect(plan?.intake).toEqual([{ ...record, dishId: shchi.id }])
    expect(plan?.templates).toEqual([{ ...template, items: [{ dishId: shchi.id }] }])
  })

  it('удалять нечего — удалённое или неизвестное', () => {
    expect(removeDishPlan(data({ dishes: [{ ...borsch, deleted: true }] }), borsch.id, null)).toBeNull()
    expect(removeDishPlan(data(), 'dish:нет', null)).toBeNull()
  })
})

describe('слияние одноимённых — Р-12', () => {
  it('ничего одноимённого и надгробий с переносом — план пуст', () => {
    const plan = reconcilePlan(data({ categories: [cat('Супы')], dishes: [dish('Борщ')], intake: [intake('i1', 'dish:борщ')] }))
    expect(planSize(plan)).toBe(0)
  })

  it('два «Борща» с двух устройств: остаётся id из названия, содержимое — поздней правки, записи переходят', () => {
    const phone = dish('Борщ', { kcal100: 50, portionGrams: 300 })
    const desktop = dish('борщ ', { id: 'dish:борщ:01J', updatedAt: later, kcal100: 60, categoryId: 'cat:супы' })
    const record = intake('i1', desktop.id)
    const plan = reconcilePlan(data({ categories: [cat('Супы')], dishes: [phone, desktop], intake: [record] }))

    expect(plan.dishes).toContainEqual({ ...phone, name: 'борщ ', kcal100: 60, categoryId: 'cat:супы', portionGrams: undefined })
    expect(plan.dishes.find((each) => each.id === phone.id)).not.toHaveProperty('portionGrams')
    expect(plan.dishes).toContainEqual({ ...desktop, deleted: true, movedTo: phone.id })
    expect(plan.intake).toEqual([{ ...record, dishId: phone.id }])
  })

  it('без id из названия остаётся наименьший — на обоих устройствах один и тот же', () => {
    const a = cat('Каши', { id: 'cat:крупы:02', updatedAt: later })
    const b = cat('каши', { id: 'cat:крупы:01' })
    const plan = reconcilePlan(data({ categories: [a, b] }))
    expect(plan.categories).toContainEqual({ ...a, deleted: true, movedTo: b.id })
    expect(plan.categories).toContainEqual({ ...b, name: 'Каши', updatedAt: at })
  })

  it('встречное переименование: «Щи» стали «Борщом» на одном устройстве, «Борщ» заведён на другом', () => {
    const renamed = dish('Борщ', { id: 'dish:щи', updatedAt: later })
    const fresh = dish('Борщ')
    const plan = reconcilePlan(data({ dishes: [renamed, fresh], intake: [intake('i1', 'dish:щи'), intake('i2', 'dish:борщ')] }))
    expect(plan.dishes).toContainEqual({ ...renamed, deleted: true, movedTo: 'dish:борщ' })
    expect(plan.intake.map((each) => [each.id, each.dishId])).toEqual([['i1', 'dish:борщ']])
  })

  it('слияние категорий доезжает до блюд и норм, повтор в норме снимается', () => {
    const a = cat('Сладости')
    const b = cat('сладости', { id: 'cat:сладкое', updatedAt: later, group: 'Пироги и сладости' })
    const cake = dish('Торт', { categoryId: b.id })
    const norm: Norm = { id: 'n1', updatedAt: at, name: 'Сладкое', categoryIds: [a.id, b.id], order: 0 }
    const plan = reconcilePlan(data({ categories: [a, b], dishes: [cake], norms: [norm] }))
    expect(plan.categories).toContainEqual({ ...a, name: 'сладости', group: 'Пироги и сладости' })
    expect(plan.dishes).toEqual([{ ...cake, categoryId: a.id }])
    expect(plan.norms).toEqual([{ ...norm, categoryIds: [a.id] }])
  })

  it('слитое блюдо и перенос его категории — одной записью в плане', () => {
    const oldCat = { ...cat('Первое'), deleted: true, movedTo: 'cat:супы' }
    const a = dish('Борщ', { categoryId: 'cat:первое' })
    const b = dish('борщ', { id: 'dish:борщ:01', updatedAt: later, categoryId: 'cat:первое', kcal100: 55 })
    const plan = reconcilePlan(data({ categories: [oldCat, cat('Супы')], dishes: [a, b] }))
    const kept = plan.dishes.filter((each) => each.id === a.id)
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatchObject({ categoryId: 'cat:супы', kcal100: 55, name: 'борщ' })
  })

  it('запись, приехавшая к надгробию позже, уходит по цепочке; кольцо и мёртвый конец не трогаются', () => {
    const tombA = { ...dish('Щи'), deleted: true, movedTo: 'dish:борщ' }
    const tombB = { ...dish('Борщ'), deleted: true, movedTo: 'dish:солянка' }
    const live = dish('Солянка')
    const chain = reconcilePlan(data({ dishes: [tombA, tombB, live], intake: [intake('i1', 'dish:щи')] }))
    expect(chain.intake).toEqual([intake('i1', 'dish:солянка')])

    const ring = [
      { ...dish('Щи'), deleted: true, movedTo: 'dish:борщ' },
      { ...dish('Борщ'), deleted: true, movedTo: 'dish:щи' },
    ]
    expect(planSize(reconcilePlan(data({ dishes: ring, intake: [intake('i1', 'dish:щи')] })))).toBe(0)

    const dead = [{ ...dish('Щи'), deleted: true, movedTo: 'dish:нет' }]
    expect(planSize(reconcilePlan(data({ dishes: dead, intake: [intake('i1', 'dish:щи')] })))).toBe(0)
  })

  it('шаблон: переехавшее блюдо, уже стоящее в шаблоне, второй раз не ставится', () => {
    const tomb = { ...dish('Щи'), deleted: true, movedTo: 'dish:борщ' }
    const template: Template = {
      id: 't1',
      updatedAt: at,
      name: 'Обед',
      meal: 'lunch',
      items: [{ dishId: 'dish:борщ' }, { dishId: 'dish:щи' }],
      order: 0,
    }
    const plan = reconcilePlan(data({ dishes: [tomb, dish('Борщ')], templates: [template] }))
    expect(plan.templates).toEqual([{ ...template, items: [{ dishId: 'dish:борщ' }] }])
  })

  it('шаблон дня: повтор — только в том же приёме; одно блюдо в обеде и ужине остаётся — Р-28', () => {
    const tomb = { ...dish('Щи'), deleted: true, movedTo: 'dish:борщ' }
    const template: Template = {
      id: 't2',
      updatedAt: at,
      name: 'День',
      items: [
        { meal: 'lunch', dishId: 'dish:борщ' },
        { meal: 'lunch', dishId: 'dish:щи' },
        { meal: 'dinner', dishId: 'dish:щи', portions: 2 },
      ],
      order: 0,
    }
    const plan = reconcilePlan(data({ dishes: [tomb, dish('Борщ')], templates: [template] }))
    expect(plan.templates).toEqual([
      {
        ...template,
        items: [
          { meal: 'lunch', dishId: 'dish:борщ' },
          { meal: 'dinner', dishId: 'dish:борщ', portions: 2 },
        ],
      },
    ])
  })

  it('архив поздней правки переходит к оставшейся; снятый архив снимается', () => {
    const a = dish('Кисель', { archived: true })
    const b = dish('кисель', { id: 'dish:кисель:01', updatedAt: later })
    const plan = reconcilePlan(data({ dishes: [a, b] }))
    expect(plan.dishes.find((each) => each.id === a.id)).not.toHaveProperty('archived')
  })
})
