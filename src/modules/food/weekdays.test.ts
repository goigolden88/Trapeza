import { describe, expect, it } from 'vitest'
import { addDays } from '../../shared/core/dates.ts'
import type { Dish, Intake } from '../../app/model.ts'
import {
  ratioText,
  WEEKDAY_MIN_DAYS,
  WEEKDAY_WEEKS,
  weekdayDishes,
  weekdayLineText,
  weekdayWindow,
  weekdayWindowText,
} from './weekdays.ts'

const at = '2026-09-17T10:00:00.000Z'

function dish(name: string, fields: Partial<Dish> = {}): Dish {
  return { id: `dish:${name}`, updatedAt: at, name, ...fields }
}

const DISHES = new Map<string, Dish>(
  [
    dish('Каша'),
    dish('Пицца'),
    dish('Борщ'),
    dish('Суши'),
    dish('Блины'),
    dish('Арбуз', { archived: true }),
    dish('Пирог старый', { deleted: true, movedTo: 'dish:Пирог' }),
    dish('Пирог'),
  ].map((each) => [each.id, each]),
)

let next = 0
function eaten(date: string, name: string, fields: Partial<Intake> = {}): Intake {
  next += 1
  return { id: `i${next}`, updatedAt: at, date, meal: 'lunch', dishId: `dish:${name}`, ...fields }
}

/**
 * Окно, кончающееся воскресеньем 2026-10-25: понедельники 2026-08-31 … 2026-10-19.
 * Сегодня — вторник 2026-10-27, неделя 26.10 идёт.
 */
const TODAY = '2026-10-27'
const FROM = '2026-08-31'
/** День `weekday` (0 — пн) недели `week` окна (0 — первая). */
const dayOf = (week: number, weekday: number) => addDays(FROM, week * 7 + weekday)
const WEEKS = Array.from({ length: WEEKDAY_WEEKS }, (_, week) => week)

/** Каша каждый день окна — день учёта у всех дней недели. */
const everyDay = WEEKS.flatMap((week) => Array.from({ length: 7 }, (_, weekday) => eaten(dayOf(week, weekday), 'Каша')))

describe('окно — Р-63', () => {
  it('неделя закончилась — окно кончается ею, иначе прошлой', () => {
    expect(weekdayWindow('2026-10-19', TODAY)).toEqual({ from: FROM, to: '2026-10-25' })
    expect(weekdayWindow('2026-10-26', TODAY)).toEqual({ from: FROM, to: '2026-10-25' })
    // В воскресенье неделя ещё идёт.
    expect(weekdayWindow('2026-10-19', '2026-10-25')).toEqual({ from: '2026-08-24', to: '2026-10-18' })
    expect(weekdayWindow('2026-10-19', '2026-10-26')).toEqual({ from: FROM, to: '2026-10-25' })
  })

  it('на стыке месяцев и года — полные недели с понедельника', () => {
    // Неделя 29.12.2025 – 04.01.2026 закончилась.
    expect(weekdayWindow('2025-12-29', '2026-01-10')).toEqual({ from: '2025-11-10', to: '2026-01-04' })
    // Любой день недели — та же неделя.
    expect(weekdayWindow('2026-01-01', '2026-01-10')).toEqual({ from: '2025-11-10', to: '2026-01-04' })
    // Идущая неделя на стыке года — окно кончается прошлой.
    expect(weekdayWindow('2025-12-29', '2025-12-31')).toEqual({ from: '2025-11-03', to: '2025-12-28' })
  })

  it('записи вне окна и идущей недели не в счёт', () => {
    const intake = [
      ...everyDay,
      ...WEEKS.map((week) => eaten(dayOf(week, 0), 'Пицца', { deleted: week > 0 })),
      eaten('2026-10-26', 'Пицца'),
      eaten('2026-08-30', 'Пицца'),
    ]
    const result = weekdayDishes(intake, DISHES, '2026-10-26', TODAY)
    expect(result.lines[0]).toEqual({ weekday: 0, logged: 8, dishes: [] })
  })
})

describe('свойственные блюда — Р-63', () => {
  it('половина и вдвое — на границах включительно', () => {
    // Пн: пицца в 4 из 8 — ровно половина; в остальные дни — 4 из 48: доля 1/12, вдвое — 1/6 < 1/2.
    // Вт: борщ в 4 из 8; в остальные — 24 из 48: 1/2 — не вдвое.
    // Ср: суши в 4 из 8; в остальные — 12 из 48: 1/4, вдвое — ровно 1/2.
    // Чт: блины в 3 из 8 — меньше половины.
    const intake = [
      ...everyDay,
      ...WEEKS.slice(0, 4).map((week) => eaten(dayOf(week, 0), 'Пицца')),
      ...WEEKS.slice(0, 4).map((week) => eaten(dayOf(week, 6), 'Пицца')),
      ...WEEKS.slice(0, 4).map((week) => eaten(dayOf(week, 1), 'Борщ')),
      ...WEEKS.slice(0, 4).flatMap((week) => [4, 5, 6, 0, 2, 3].map((weekday) => eaten(dayOf(week, weekday), 'Борщ'))),
      ...WEEKS.slice(0, 4).map((week) => eaten(dayOf(week, 2), 'Суши')),
      ...WEEKS.slice(0, 4).flatMap((week) => [4, 5, 6].map((weekday) => eaten(dayOf(week, weekday), 'Суши'))),
      ...WEEKS.slice(0, 3).map((week) => eaten(dayOf(week, 3), 'Блины')),
    ]
    const { lines } = weekdayDishes(intake, DISHES, '2026-10-19', TODAY)
    expect(lines[0]?.dishes).toEqual([{ dishId: 'dish:Пицца', name: 'Пицца', days: 4 }])
    expect(lines[1]?.dishes).toEqual([])
    expect(lines[2]?.dishes).toEqual([{ dishId: 'dish:Суши', name: 'Суши', days: 4 }])
    expect(lines[3]?.dishes).toEqual([])
    // Каша каждый день — свойственна всем, не одному.
    expect(lines.every((line) => !line.dishes?.some((each) => each.name === 'Каша'))).toBe(true)
  })

  it('блюдо дважды в день — день один', () => {
    const intake = [
      ...everyDay,
      ...WEEKS.slice(0, 3).flatMap((week) => [eaten(dayOf(week, 4), 'Пицца'), eaten(dayOf(week, 4), 'Пицца', { meal: 'dinner' })]),
    ]
    expect(weekdayDishes(intake, DISHES, '2026-10-19', TODAY).lines[4]?.dishes).toEqual([])
  })

  it('до трёх: чаще — первым, при равенстве — по названию', () => {
    const intake = [
      ...everyDay,
      ...WEEKS.map((week) => eaten(dayOf(week, 5), 'Суши')),
      ...WEEKS.slice(0, 6).map((week) => eaten(dayOf(week, 5), 'Пицца')),
      ...WEEKS.slice(0, 6).map((week) => eaten(dayOf(week, 5), 'Борщ')),
      ...WEEKS.slice(0, 5).map((week) => eaten(dayOf(week, 5), 'Блины')),
    ]
    const line = weekdayDishes(intake, DISHES, '2026-10-19', TODAY).lines[5]
    expect(line?.dishes?.map((each) => [each.name, each.days])).toEqual([
      ['Суши', 8],
      ['Борщ', 6],
      ['Пицца', 6],
    ])
    expect(line && weekdayLineText(line)).toBe('Суши — 8 из 8 сб, Борщ — 6 из 8 сб, Пицца — 6 из 8 сб')
  })

  it('слитое — под живым названием, в архиве — как есть', () => {
    const intake = [
      ...everyDay,
      ...WEEKS.slice(0, 2).map((week) => eaten(dayOf(week, 6), 'Пирог старый')),
      ...WEEKS.slice(2, 4).map((week) => eaten(dayOf(week, 6), 'Пирог')),
      ...WEEKS.slice(0, 4).map((week) => eaten(dayOf(week, 6), 'Арбуз')),
    ]
    expect(weekdayDishes(intake, DISHES, '2026-10-19', TODAY).lines[6]?.dishes).toEqual([
      { dishId: 'dish:Арбуз', name: 'Арбуз', days: 4 },
      { dishId: 'dish:Пирог', name: 'Пирог', days: 4 },
    ])
  })
})

describe('мало данных — Р-63', () => {
  it('дней учёта меньше порога — мало данных; отметки «Не было» — не учёт', () => {
    // Пн — в двух неделях из восьми, вт — в трёх.
    const intake = [
      ...WEEKS.slice(0, WEEKDAY_MIN_DAYS - 1).map((week) => eaten(dayOf(week, 0), 'Борщ')),
      ...WEEKS.slice(0, WEEKDAY_MIN_DAYS).map((week) => eaten(dayOf(week, 1), 'Пицца')),
    ]
    const { lines } = weekdayDishes(intake, DISHES, '2026-10-19', TODAY)
    expect(lines[0]).toEqual({ weekday: 0, logged: 2, dishes: null })
    expect(lines[0] && weekdayLineText(lines[0])).toBe('мало данных — учёт в 2 пн из 8')
    // В остальные дни пиццы не было — вдвое чаще нуля.
    expect(lines[1]?.dishes).toEqual([{ dishId: 'dish:Пицца', name: 'Пицца', days: 3 }])
  })

  it('учёта нет — мало данных про все дни', () => {
    const { lines } = weekdayDishes([], DISHES, '2026-10-19', TODAY)
    expect(lines).toHaveLength(7)
    expect(lines.every((line) => line.dishes === null && line.logged === 0)).toBe(true)
  })

  it('ничего особенного — с основанием', () => {
    const line = weekdayDishes(everyDay, DISHES, '2026-10-19', TODAY).lines[3]
    expect(line && weekdayLineText(line)).toBe('ничего особенного — учёт в 8 чт из 8')
  })
})

describe('тексты', () => {
  it('сводка окна и кратность', () => {
    expect(weekdayWindowText()).toBe('за 8 недель')
    expect(ratioText(2)).toBe('в 2 раза')
    expect(ratioText(5)).toBe('в 5 раз')
  })
})
