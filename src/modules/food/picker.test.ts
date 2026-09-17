import { describe, expect, it } from 'vitest'
import type { Category, Dish, Intake } from '../../core/model.ts'
import { FREQUENT_MAX, frequentDishes, LOOSE_NAME, newDishOffer, pickSections, searchSections, sectionsSize } from './picker.ts'

const at = '2026-09-16T10:00:00.000Z'

function category(name: string, order: number, fields: Partial<Category> = {}): Category {
  return { id: `cat:${name}`, updatedAt: at, name, order, ...fields }
}

function dish(name: string, categoryName?: string): Dish {
  return { id: `dish:${name}`, updatedAt: at, name, ...(categoryName ? { categoryId: `cat:${categoryName}` } : {}) }
}

let next = 0
function eaten(date: string, name: string, fields: Partial<Intake> = {}): Intake {
  next += 1
  return { id: `i${String(next).padStart(3, '0')}`, updatedAt: at, date, meal: 'lunch', dishId: `dish:${name}`, ...fields }
}

const names = (list: readonly Dish[]) => list.map((each) => each.name)

describe('«Частые» — Р-26', () => {
  const live = [dish('Борщ', 'Супы'), dish('Компот', 'Напитки'), dish('Щи', 'Супы'), dish('Плов', 'Второе')]

  it('только бывшее в этом приёме до дня, по частоте; другой приём и сам день не в счёт', () => {
    const intake = [
      eaten('2026-03-10', 'Щи'),
      eaten('2026-03-11', 'Щи'),
      eaten('2026-03-11', 'Компот'),
      eaten('2026-03-11', 'Плов', { meal: 'dinner' }),
      eaten('2026-03-12', 'Борщ'),
    ]
    expect(names(frequentDishes(live, intake, 'lunch', '2026-03-12'))).toEqual(['Щи', 'Компот'])
  })

  it('окно не пусто — давнее вне окна в «Частые» не идёт', () => {
    const intake = [eaten('2026-01-05', 'Борщ'), eaten('2026-03-10', 'Щи')]
    expect(names(frequentDishes(live, intake, 'lunch', '2026-03-12'))).toEqual(['Щи'])
  })

  it('окно пусто — вся история до дня, как у порядка Р-17', () => {
    const intake = [eaten('2026-02-05', 'Борщ'), eaten('2026-02-06', 'Борщ'), eaten('2026-03-10', 'Компот')]
    expect(names(frequentDishes(live, intake, 'lunch', '2026-09-18'))).toEqual(['Борщ', 'Компот'])
  })

  it('не больше предела; истории нет — пусто', () => {
    const many = Array.from({ length: FREQUENT_MAX + 3 }, (_, n) => dish(`Блюдо ${String(n).padStart(2, '0')}`))
    const intake = many.map((each) => eaten('2026-03-10', each.name))
    expect(frequentDishes(many, intake, 'lunch', '2026-03-12')).toHaveLength(FREQUENT_MAX)
    expect(frequentDishes(live, [], 'lunch', '2026-03-12')).toEqual([])
  })
})

describe('разделы по категориям — Р-26', () => {
  const categories = [
    category('Напитки', 2),
    category('Супы', 0),
    category('Второе', 1, { archived: true }),
    category('Пустая', 3),
    category('Старая', 4, { deleted: true }),
  ]
  const live = [
    dish('Борщ', 'Супы'),
    dish('Щи', 'Супы'),
    dish('Компот', 'Напитки'),
    dish('Плов', 'Второе'),
    dish('Сырок'),
    dish('Пряник', 'Старая'),
  ]

  it('категории в ручном порядке, архивная на месте, пустая не показана; без категории и с удалённой — последними', () => {
    const sections = pickSections(live, categories, [], 'lunch', '2026-03-12')
    expect(sections.map((section) => section.name)).toEqual(['Супы', 'Второе', 'Напитки', LOOSE_NAME])
    expect(sections.at(-1)).toEqual({ id: null, name: LOOSE_NAME, dishes: [dish('Пряник', 'Старая'), dish('Сырок')] })
    expect(sectionsSize(sections)).toBe(live.length)
  })

  it('внутри категории — по частоте в этом приёме, затем по названию', () => {
    const intake = [eaten('2026-03-10', 'Щи'), eaten('2026-03-11', 'Щи'), eaten('2026-03-11', 'Борщ', { meal: 'dinner' })]
    const soups = pickSections(live, categories, intake, 'lunch', '2026-03-12')[0]
    expect(names(soups?.dishes ?? [])).toEqual(['Щи', 'Борщ'])
  })

  it('поиск — те же разделы, только найденное; регистр и «ё» не в счёт; пустой запрос — всё', () => {
    const extra = [...live, dish('Ёжики', 'Второе')]
    const sections = pickSections(extra, categories, [], 'lunch', '2026-03-12')
    const found = searchSections(sections, ' ЕЖ ')
    expect(found.map((section) => [section.name, names(section.dishes)])).toEqual([['Второе', ['Ёжики']]])
    expect(searchSections(sections, 'щ').map((section) => section.name)).toEqual(['Супы'])
    expect(searchSections(sections, '')).toEqual(sections)
    expect(searchSections(sections, 'нет такого')).toEqual([])
  })
})

describe('новое блюдо из поиска — Р-36', () => {
  const pizza = { ...dish('Пицца'), archived: true }
  const gone = { ...dish('Шаурма'), deleted: true }

  it('поиск пуст — завести с названием запроса без лишних пробелов', () => {
    expect(newDishOffer('  пицца   с грибами ', [dish('Борщ')], 0)).toEqual({ kind: 'create', name: 'пицца с грибами' })
  })

  it('нашлось хоть одно или запрос пуст — ничего', () => {
    expect(newDishOffer('бор', [dish('Борщ')], 1)).toBeNull()
    expect(newDishOffer('   ', [dish('Борщ')], 0)).toBeNull()
  })

  it('то же название в архиве — вернуть его, регистр и «ё» не в счёт; надгробие — заводится заново', () => {
    expect(newDishOffer('ПИЦЦА', [pizza], 0)).toEqual({ kind: 'restore', dish: pizza })
    expect(newDishOffer('шаурма', [gone], 0)).toEqual({ kind: 'create', name: 'шаурма' })
  })
})
