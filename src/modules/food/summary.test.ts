import { describe, expect, it } from 'vitest'
import type { Category, Dish, Intake } from '../../core/model.ts'
import { recordPortions, summarize } from './summary.ts'

const at = '2026-09-16T10:00:00.000Z'

function category(name: string, order: number, group?: string, fields: Partial<Category> = {}): Category {
  return { id: `cat:${name}`, updatedAt: at, name, order, ...(group ? { group } : {}), ...fields }
}

function dish(name: string, fields: Partial<Dish> = {}): Dish {
  return { id: `dish:${name}`, updatedAt: at, name, ...fields }
}

let next = 0
function eaten(name: string, fields: Partial<Intake> = {}): Intake {
  next += 1
  return { id: `i${next}`, updatedAt: at, date: '2026-02-03', meal: 'lunch', dishId: `dish:${name}`, ...fields }
}

describe('порции записи — Р-18', () => {
  it('без граммов — порции, нет — одна; граммы — доля порции; без веса порции — одна и помечено', () => {
    expect(recordPortions(eaten('Щи'), dish('Щи'))).toEqual({ portions: 1, assumed: false })
    expect(recordPortions(eaten('Щи', { portions: 2.5 }), dish('Щи'))).toEqual({ portions: 2.5, assumed: false })
    expect(recordPortions(eaten('Щи', { grams: 450, portions: 9 }), dish('Щи', { portionGrams: 300 }))).toEqual({
      portions: 1.5,
      assumed: false,
    })
    expect(recordPortions(eaten('Щи', { grams: 450 }), dish('Щи'))).toEqual({ portions: 1, assumed: true })
    expect(recordPortions(eaten('Щи', { grams: 450 }), undefined)).toEqual({ portions: 1, assumed: true })
  })
})

describe('итог дня — Р-01, Р-18', () => {
  const categories = [
    category('Супы особые', 3, 'Супы'),
    category('Каши', 0, 'Каши'),
    category('Супы обычные', 2, 'Супы'),
    category('Компот', 1),
    category('Старое', 4, undefined, { deleted: true }),
  ]
  const dishes = new Map(
    [
      dish('Борщ', { categoryId: 'cat:Супы особые', kcalPortion: 250 }),
      dish('Лапша', { categoryId: 'cat:Супы обычные' }),
      dish('Гречка', { categoryId: 'cat:Каши', portionGrams: 200, kcal100: 100 }),
      dish('Компот', { categoryId: 'cat:Компот' }),
      dish('Сырок'),
      dish('Кекс', { categoryId: 'cat:Старое' }),
    ].map((each) => [each.id, each]),
  )

  it('группы в порядке первой категории; категория без группы — сама по себе; без категории — отдельно', () => {
    const summary = summarize(
      [
        eaten('Борщ'),
        eaten('Лапша', { portions: 2 }),
        eaten('Гречка', { grams: 300 }),
        eaten('Компот', { portions: 3 }),
        eaten('Сырок'),
        eaten('Кекс'),
        eaten('Борщ', { deleted: true }),
      ],
      dishes,
      categories,
    )
    expect(summary.groups).toEqual([
      { name: 'Каши', portions: 1.5, categories: [{ id: 'cat:Каши', name: 'Каши', portions: 1.5 }] },
      { name: null, portions: 3, categories: [{ id: 'cat:Компот', name: 'Компот', portions: 3 }] },
      {
        name: 'Супы',
        portions: 3,
        categories: [
          { id: 'cat:Супы обычные', name: 'Супы обычные', portions: 2 },
          { id: 'cat:Супы особые', name: 'Супы особые', portions: 1 },
        ],
      },
    ])
    expect(summary.loose).toBe(2)
    expect(summary.looseRecords).toBe(2)
    expect(summary.records).toBe(6)
    expect(summary.portions).toBe(9.5)
    expect(summary.assumed).toBe(0)
    expect(summary.kcal).toEqual({ kcal: 550, counted: 2, total: 6 })
  })

  it('пустой день — пустой итог', () => {
    const summary = summarize([], dishes, categories)
    expect(summary.groups).toEqual([])
    expect(summary.records).toBe(0)
    expect(summary.kcal.total).toBe(0)
  })

  it('граммы без веса порции — считаются одной и называются', () => {
    const summary = summarize([eaten('Компот', { grams: 250 })], dishes, categories)
    expect(summary.assumed).toBe(1)
    expect(summary.portions).toBe(1)
  })
})
