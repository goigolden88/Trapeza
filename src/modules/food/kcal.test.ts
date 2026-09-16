import { describe, expect, it } from 'vitest'
import type { Dish, Intake } from '../../core/model.ts'
import { dayMeals, tapDish, viewedDay } from './day.ts'
import { formatKcal, intakeKcal, kcalText, portionKcal, sumKcal } from './kcal.ts'
import { currentMeal, DEFAULT_MEAL_HOURS, mealByHour, readMealHours } from './meals.ts'

const at = '2026-09-16T10:00:00.000Z'

function dish(fields: Partial<Dish>): Dish {
  return { id: 'dish:x', updatedAt: at, name: 'Икс', ...fields }
}

function record(fields: Partial<Intake> = {}): Intake {
  return { id: 'i1', updatedAt: at, date: '2026-02-03', meal: 'lunch', dishId: 'dish:x', ...fields }
}

describe('калорийность записи — 02-Архитектура', () => {
  it('ккал порции: kcalPortion главнее, иначе порция × ккал на 100 г', () => {
    expect(portionKcal(dish({ kcalPortion: 80, portionGrams: 300, kcal100: 50 }))).toBe(80)
    expect(portionKcal(dish({ portionGrams: 300, kcal100: 50 }))).toBe(150)
    expect(portionKcal(dish({ kcal100: 50 }))).toBeNull()
  })

  it('граммы: × ккал на 100 г; без них — доля порции × ккал порции; иначе null', () => {
    expect(intakeKcal(record({ grams: 200 }), dish({ kcal100: 50, kcalPortion: 999 }))).toBe(100)
    expect(intakeKcal(record({ grams: 150 }), dish({ portionGrams: 300, kcalPortion: 80 }))).toBe(40)
    expect(intakeKcal(record({ grams: 150 }), dish({ kcalPortion: 80 }))).toBeNull()
    expect(intakeKcal(record({ grams: 150 }), dish({ portionGrams: 0, kcalPortion: 80 }))).toBeNull()
  })

  it('без граммов: порции × ккал порции, нет порций — одна; нет блюда — null', () => {
    expect(intakeKcal(record(), dish({ kcalPortion: 80 }))).toBe(80)
    expect(intakeKcal(record({ portions: 1.5 }), dish({ portionGrams: 200, kcal100: 100 }))).toBe(300)
    expect(intakeKcal(record(), undefined)).toBeNull()
  })

  it('сумма называет основание; удалённые не в счёт', () => {
    const dishes = new Map([
      ['dish:a', dish({ id: 'dish:a', kcalPortion: 1200 })],
      ['dish:b', dish({ id: 'dish:b', kcal100: 65 })],
      ['dish:c', dish({ id: 'dish:c' })],
    ])
    const sum = sumKcal(
      [
        record({ dishId: 'dish:a' }),
        record({ dishId: 'dish:b', grams: 1000 }),
        record({ dishId: 'dish:c' }),
        record({ dishId: 'dish:a', deleted: true }),
      ],
      dishes,
    )
    expect(sum).toEqual({ kcal: 1850, counted: 2, total: 3 })
    expect(kcalText(sum).replace(/\s/g, ' ')).toBe('1 850 ккал по 2 из 3 записей')
  })

  it('текст: одна запись, ни одной известной, пусто', () => {
    expect(kcalText({ kcal: 80, counted: 1, total: 1 })).toBe('80 ккал по 1 из 1 записи')
    expect(kcalText({ kcal: 0, counted: 0, total: 21 })).toBe('ккал не известны ни у одной из 21 записи')
    expect(kcalText({ kcal: 0, counted: 0, total: 0 })).toBe('')
    expect(formatKcal(99.6)).toBe('100')
  })
})

describe('приём по часам — Р-11', () => {
  it('умолчания 13 и 18: завтрак, обед, ужин; перекус по часам не ставится', () => {
    expect(mealByHour(0, DEFAULT_MEAL_HOURS)).toBe('breakfast')
    expect(mealByHour(12, DEFAULT_MEAL_HOURS)).toBe('breakfast')
    expect(mealByHour(13, DEFAULT_MEAL_HOURS)).toBe('lunch')
    expect(mealByHour(17, DEFAULT_MEAL_HOURS)).toBe('lunch')
    expect(mealByHour(18, DEFAULT_MEAL_HOURS)).toBe('dinner')
    expect(mealByHour(23, DEFAULT_MEAL_HOURS)).toBe('dinner')
    expect(currentMeal(new Date(2026, 8, 16, 14, 40), DEFAULT_MEAL_HOURS)).toBe('lunch')
  })

  it('настройка: своя — берётся; нет, кривая или обед не раньше ужина — умолчания', () => {
    expect(readMealHours({ lunch: 14, dinner: 19 })).toEqual({ lunch: 14, dinner: 19 })
    expect(readMealHours(undefined)).toEqual(DEFAULT_MEAL_HOURS)
    expect(readMealHours({ lunch: 14.5, dinner: 19 })).toEqual(DEFAULT_MEAL_HOURS)
    expect(readMealHours({ lunch: 19, dinner: 19 })).toEqual(DEFAULT_MEAL_HOURS)
    expect(readMealHours({ lunch: '13', dinner: 18 })).toEqual(DEFAULT_MEAL_HOURS)
  })
})

describe('записи дня', () => {
  it('по приёмам, в порядке записи; другой день и удалённые не попадают', () => {
    const meals = dayMeals(
      [
        record({ id: '02', meal: 'breakfast' }),
        record({ id: '01', meal: 'breakfast' }),
        record({ id: '03', meal: 'snack' }),
        record({ id: '04', date: '2026-02-04' }),
        record({ id: '05', deleted: true }),
      ],
      '2026-02-03',
    )
    expect(meals.breakfast.map((each) => each.id)).toEqual(['01', '02'])
    expect(meals.lunch).toEqual([])
    expect(meals.dinner).toEqual([])
    expect(meals.snack.map((each) => each.id)).toEqual(['03'])
  })
})

describe('день на экране и тап по блюду', () => {
  it('день из адреса: прошлый — он; кривой, пустой и будущий — сегодня', () => {
    expect(viewedDay('2026-02-03', '2026-09-16')).toBe('2026-02-03')
    expect(viewedDay('2026-09-16', '2026-09-16')).toBe('2026-09-16')
    expect(viewedDay('2026-09-17', '2026-09-16')).toBe('2026-09-16')
    expect(viewedDay('2026-02-31', '2026-09-16')).toBe('2026-09-16')
    expect(viewedDay(null, '2026-09-16')).toBe('2026-09-16')
  })

  const make = () => ({ id: 'new', updatedAt: at, date: '2026-02-03', meal: 'lunch' as const })

  it('нового блюда в приёме — запись в одну порцию', () => {
    expect(tapDish([], 'dish:x', make)).toEqual({ record: { ...make(), dishId: 'dish:x' }, added: true })
  })

  it('блюдо уже в приёме — порция прибавляется к той же записи; удалённая не в счёт', () => {
    const same = record({ id: 'i1', portions: 1.5 })
    expect(tapDish([same], 'dish:x', make)).toEqual({ record: { ...same, portions: 2.5 }, added: false })
    expect(tapDish([record({ id: 'i1' })], 'dish:x', make)).toMatchObject({ record: { portions: 2 }, added: false })
    expect(tapDish([record({ deleted: true })], 'dish:x', make)).toMatchObject({ added: true })
  })

  it('запись в граммах не трогается', () => {
    const grams = record({ grams: 200 })
    expect(tapDish([grams], 'dish:x', make)).toEqual({ blocked: grams })
  })
})
