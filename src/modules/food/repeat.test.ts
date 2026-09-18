import { describe, expect, it } from 'vitest'
import type { Dish, Intake } from '../../app/model.ts'
import { byFrequency, FREQUENCY_MONTHS, previousMeal, repeatItems, windowStart } from './repeat.ts'

const at = '2026-09-16T10:00:00.000Z'

function dish(name: string): Dish {
  return { id: `dish:${name}`, updatedAt: at, name }
}

let next = 0
function eaten(date: string, name: string, fields: Partial<Intake> = {}): Intake {
  next += 1
  return { id: `i${String(next).padStart(3, '0')}`, updatedAt: at, date, meal: 'lunch', dishId: `dish:${name}`, ...fields }
}

const names = (list: Dish[]) => list.map((each) => each.name)

describe('окно частоты — Р-17', () => {
  it('месяц: то же число прошлого месяца; числа нет — последний день месяца', () => {
    expect(FREQUENCY_MONTHS).toBe(1)
    expect(windowStart('2026-03-19')).toBe('2026-02-19')
    expect(windowStart('2026-03-31')).toBe('2026-02-28')
    expect(windowStart('2028-03-31')).toBe('2028-02-29')
    expect(windowStart('2026-01-15')).toBe('2025-12-15')
    expect(windowStart('2026-05-31')).toBe('2026-04-30')
  })
})

describe('порядок по частоте — Р-08, Р-17', () => {
  const dishes = [dish('Борщ'), dish('Компот'), dish('Щи'), dish('Плов')]

  it('по дням в окне, а не по записям; сам день не в счёт; при равенстве — по названию', () => {
    const intake = [
      eaten('2026-03-10', 'Щи'),
      eaten('2026-03-11', 'Щи'),
      eaten('2026-03-12', 'Компот', { portions: 3 }),
      eaten('2026-03-12', 'Борщ'),
      eaten('2026-03-12', 'Борщ', { meal: 'dinner' }),
      eaten('2026-03-13', 'Плов'),
      eaten('2026-03-13', 'Плов'),
      eaten('2026-03-13', 'Плов'),
    ]
    expect(names(byFrequency(dishes, intake, 'lunch', '2026-03-13'))).toEqual(['Щи', 'Борщ', 'Компот', 'Плов'])
  })

  it('окно главнее всей истории: недавнее наверху, давнее — ниже', () => {
    const intake = [
      eaten('2026-01-05', 'Борщ'),
      eaten('2026-01-06', 'Борщ'),
      eaten('2026-01-07', 'Борщ'),
      eaten('2026-03-01', 'Щи'),
    ]
    expect(names(byFrequency(dishes, intake, 'lunch', '2026-03-13'))).toEqual(['Щи', 'Борщ', 'Компот', 'Плов'])
  })

  it('пустое окно — вся история до дня: через полгода после таблицы порядок не алфавит', () => {
    const intake = [eaten('2026-02-03', 'Щи'), eaten('2026-02-04', 'Щи'), eaten('2026-02-04', 'Плов')]
    expect(names(byFrequency(dishes, intake, 'lunch', '2026-09-16'))).toEqual(['Щи', 'Плов', 'Борщ', 'Компот'])
  })

  it('задним числом — от того дня: будущие для него записи не в счёт', () => {
    const intake = [eaten('2026-02-03', 'Плов'), eaten('2026-03-01', 'Щи'), eaten('2026-03-02', 'Щи')]
    expect(names(byFrequency(dishes, intake, 'lunch', '2026-02-10'))).toEqual(['Плов', 'Борщ', 'Компот', 'Щи'])
  })

  it('удалённые и кривые даты не в счёт', () => {
    const intake = [eaten('2026-03-10', 'Щи', { deleted: true }), eaten('03.03.2026', 'Плов')]
    expect(names(byFrequency(dishes, intake, 'lunch', '2026-03-13'))).toEqual(['Борщ', 'Компот', 'Плов', 'Щи'])
  })
})

describe('«как вчера» — Р-08', () => {
  it('последний такой же приём до дня — не обязательно вчера', () => {
    const intake = [
      eaten('2026-03-01', 'Щи'),
      eaten('2026-03-05', 'Борщ', { portions: 2 }),
      eaten('2026-03-05', 'Компот'),
      eaten('2026-03-06', 'Плов', { meal: 'dinner' }),
      eaten('2026-03-07', 'Плов'),
    ]
    const previous = previousMeal(intake, 'lunch', '2026-03-07')
    expect(previous?.date).toBe('2026-03-05')
    expect(previous?.records.map((each) => each.dishId)).toEqual(['dish:Борщ', 'dish:Компот'])
    expect(previousMeal(intake, 'snack', '2026-03-07')).toBeNull()
  })

  it('без дублей: то, что уже в приёме, второй раз не ставится; порции и граммы — прошлые, время и заметка — нет', () => {
    const previous = [
      eaten('2026-03-05', 'Борщ', { portions: 2, at: '14:00', note: 'в кафе' }),
      eaten('2026-03-05', 'Компот', { grams: 300 }),
      eaten('2026-03-05', 'Щи'),
    ]
    const current = [eaten('2026-03-07', 'Щи'), eaten('2026-03-07', 'Плов')]
    expect(repeatItems(previous, current)).toEqual([
      { dishId: 'dish:Борщ', portions: 2 },
      { dishId: 'dish:Компот', grams: 300 },
    ])
    expect(repeatItems(previous, [...current, eaten('2026-03-07', 'Борщ'), eaten('2026-03-07', 'Компот')])).toEqual([])
  })
})
