import { describe, expect, it } from 'vitest'
import type { Category, Dish, Intake } from '../../app/model.ts'
import { dayHref, loggedText, viewedWeek, weekKcalText, weekRoute, weekSummary } from './week.ts'

const at = '2026-09-17T10:00:00.000Z'
const MON = '2026-02-02'

const categories: Category[] = [
  { id: 'cat:Супы обычные', updatedAt: at, name: 'Супы обычные', order: 2, group: 'Супы' },
  { id: 'cat:Супы особые', updatedAt: at, name: 'Супы особые', order: 3, group: 'Супы' },
  { id: 'cat:Компот', updatedAt: at, name: 'Компот', order: 1 },
]
const dishes = new Map<string, Dish>(
  (
    [
      { id: 'dish:Щи', updatedAt: at, name: 'Щи', categoryId: 'cat:Супы обычные', kcalPortion: 200 },
      { id: 'dish:Борщ', updatedAt: at, name: 'Борщ', categoryId: 'cat:Супы особые', portionGrams: 300 },
      { id: 'dish:Компот', updatedAt: at, name: 'Компот', categoryId: 'cat:Компот', kcalPortion: 100 },
      { id: 'dish:Сырок', updatedAt: at, name: 'Сырок' },
    ] satisfies Dish[]
  ).map((dish) => [dish.id, dish]),
)

let next = 0
function eaten(date: string, dish: string, fields: Partial<Intake> = {}): Intake {
  next += 1
  return { id: `i${next}`, updatedAt: at, date, meal: 'lunch', dishId: `dish:${dish}`, ...fields }
}

describe('какая неделя — Р-25', () => {
  it('любой день — его понедельник; кривой, пустой и будущий — текущая', () => {
    expect(viewedWeek('2026-02-05', '2026-09-17')).toBe(MON)
    expect(viewedWeek(null, '2026-09-17')).toBe('2026-09-14')
    expect(viewedWeek('вчера', '2026-09-17')).toBe('2026-09-14')
    expect(viewedWeek('2026-09-21', '2026-09-17')).toBe('2026-09-14')
  })
})

describe('итог недели — Р-01, Р-18, Р-25', () => {
  const intake = [
    eaten(MON, 'Щи'),
    eaten(MON, 'Компот', { portions: 2 }),
    eaten(MON, 'Сырок', { meal: 'snack' }),
    eaten('2026-02-03', 'Борщ', { grams: 450 }),
    eaten('2026-02-03', 'Компот', { meal: 'dinner' }),
    eaten('2026-02-05', 'Щи', { meal: 'breakfast', deleted: true }),
    eaten('2026-02-08', 'Щи'),
    eaten('2026-02-09', 'Щи'), // следующая неделя
  ]

  it('дни: порции, приёмы, будущие', () => {
    const week = weekSummary(intake, dishes, categories, '2026-02-04', '2026-02-07')
    expect(week.period).toEqual({ from: MON, to: '2026-02-08' })
    expect(week.days.map((day) => [day.date.slice(8), day.records, day.portions, day.future])).toEqual([
      ['02', 3, 4, false],
      ['03', 2, 2.5, false],
      ['04', 0, 0, false],
      ['05', 0, 0, false],
      ['06', 0, 0, false],
      ['07', 0, 0, false],
      ['08', 1, 1, true],
    ])
    expect(week.days[0]?.meals).toEqual({ breakfast: 0, lunch: 2, dinner: 0, snack: 1 })
    expect(week.logged).toBe(3)
    expect(week.elapsed).toBe(6)
    expect(loggedText(week)).toBe('Учёт в 3 днях из 6')
  })

  it('состав: группы и категории с порциями и днями; без категории — отдельно', () => {
    const week = weekSummary(intake, dishes, categories, MON, '2026-09-17')
    expect(week.groups).toEqual([
      { name: null, portions: 3, days: 2, categories: [{ id: 'cat:Компот', name: 'Компот', portions: 3, days: 2 }] },
      {
        name: 'Супы',
        portions: 3.5,
        days: 3,
        categories: [
          { id: 'cat:Супы обычные', name: 'Супы обычные', portions: 2, days: 2 },
          { id: 'cat:Супы особые', name: 'Супы особые', portions: 1.5, days: 1 },
        ],
      },
    ])
    expect(week.looseRecords).toBe(1)
    expect(week.records).toBe(6)
    expect(week.kcal).toEqual({ kcal: 700, counted: 4, total: 6 })
  })

  it('калории в среднем за день учёта — с основанием', () => {
    expect(weekKcalText({ kcal: 700, counted: 4, total: 6 }, 3)).toBe(
      'в среднем 233 ккал в день — за 3 дня учёта, по 4 из 6 записей',
    )
    expect(weekKcalText({ kcal: 0, counted: 0, total: 1 }, 1)).toBe('ккал не известны ни у одной из 1 записи')
    expect(weekKcalText({ kcal: 0, counted: 0, total: 0 }, 0)).toBe('')
  })

  it('день на «Сегодня» — адресом', () => {
    expect(dayHref(MON)).toBe('#/?day=2026-02-02')
    expect(dayHref('кривая')).toBeUndefined()
    expect(weekRoute('2026-09-17', '2026-09-17')).toBe('/week')
    expect(weekRoute('2026-02-05', '2026-09-17')).toBe('/week?w=2026-02-02')
  })
})
