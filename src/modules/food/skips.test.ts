import { describe, expect, it } from 'vitest'
import type { Intake, MainMeals, Skip } from '../../app/model.ts'
import {
  activeSkips,
  clearSkip,
  createSkip,
  liftedSkips,
  MAIN_MEALS,
  MAIN_MEALS_ID,
  mainMealsText,
  periodSkips,
  readMainMeals,
  skipLineText,
  skipOf,
  skippedKeys,
  withMainMeal,
} from './skips.ts'

const at = '2026-10-06T10:00:00.000Z'
const later = '2026-10-07T10:00:00.000Z'

function skip(id: string, date: string, meal: Skip['meal'], fields: Partial<Skip> = {}): Skip {
  return { id, updatedAt: at, date, meal, ...fields }
}

function eaten(date: string, meal: Intake['meal'], fields: Partial<Intake> = {}): Intake {
  return { id: `i:${date}:${meal}`, updatedAt: at, date, meal, dishId: 'dish:каша', ...fields }
}

function mains(meals: unknown, fields: Partial<MainMeals> = {}): MainMeals[] {
  return [{ id: MAIN_MEALS_ID, updatedAt: at, meals: meals as MainMeals['meals'], ...fields }]
}

describe('основные приёмы — Р-59', () => {
  it('записи нет — все три; порядок — дня, а не записи', () => {
    expect(readMainMeals([])).toEqual(['breakfast', 'lunch', 'dinner'])
    expect(readMainMeals(mains(['dinner', 'lunch']))).toEqual(['lunch', 'dinner'])
  })

  it('удалённая, пустая, кривая или чужая запись — все три: настройка не выключает вопросы молча', () => {
    expect(readMainMeals(mains(['lunch'], { deleted: true }))).toEqual(MAIN_MEALS)
    expect(readMainMeals(mains([]))).toEqual(MAIN_MEALS)
    expect(readMainMeals(mains('lunch'))).toEqual(MAIN_MEALS)
    expect(readMainMeals(mains(['snack', 'полдник']))).toEqual(MAIN_MEALS)
    expect(readMainMeals(mains(['lunch'], { id: 'meals:other' }))).toEqual(MAIN_MEALS)
  })

  it('снять и вернуть приём — одна запись с постоянным id', () => {
    expect(withMainMeal([], 'breakfast', false, later)).toEqual({ id: MAIN_MEALS_ID, updatedAt: later, meals: ['lunch', 'dinner'] })
    expect(withMainMeal(mains(['dinner']), 'breakfast', true, later)?.meals).toEqual(['breakfast', 'dinner'])
  })

  it('последний не снимается; перекус основным не бывает', () => {
    expect(withMainMeal(mains(['lunch']), 'lunch', false, later)).toBeNull()
    expect(withMainMeal([], 'snack', true, later)).toBeNull()
  })

  it('итог словами — строчными', () => {
    expect(mainMealsText(['lunch', 'dinner'])).toBe('обед, ужин')
  })
})

describe('отметки «Не было» — Р-59', () => {
  const day = '2026-10-06'

  it('причина — по желанию: пустая не пишется, пробелы по краям срезаются', () => {
    expect(createSkip(day, 'breakfast', '  не успел ', 's1', at)).toEqual({
      id: 's1',
      updatedAt: at,
      date: day,
      meal: 'breakfast',
      reason: 'не успел',
    })
    expect(createSkip(day, 'breakfast', '   ', 's1', at)).not.toHaveProperty('reason')
  })

  it('действует живая отметка основного приёма; с двух устройств — одна, поздняя', () => {
    const skips = [
      skip('a', day, 'breakfast', { reason: 'старая' }),
      skip('b', day, 'breakfast', { reason: 'поздняя', updatedAt: later }),
      skip('c', day, 'lunch', { deleted: true }),
      skip('d', day, 'snack'),
    ]
    expect(activeSkips(skips, []).map((each) => each.id)).toEqual(['b'])
    expect(skipOf(skips, [], day, 'breakfast')?.reason).toBe('поздняя')
    expect(skipOf(skips, [], day, 'lunch')).toBeUndefined()
    expect(skippedKeys(skips, [])).toEqual(['2026-10-06:breakfast'])
  })

  it('еда в приёме главнее отметки, даже не снятой; удалённая еда — нет', () => {
    const skips = [skip('a', day, 'breakfast')]
    expect(activeSkips(skips, [eaten(day, 'breakfast')])).toEqual([])
    expect(activeSkips(skips, [eaten(day, 'breakfast', { deleted: true }), eaten(day, 'lunch')])).toHaveLength(1)
  })

  it('«Снять» — надгробия всех живых отметок приёма дня', () => {
    const skips = [skip('a', day, 'breakfast'), skip('b', day, 'breakfast'), skip('c', day, 'lunch'), skip('d', day, 'breakfast', { deleted: true })]
    expect(clearSkip(skips, day, 'breakfast')).toEqual([
      { ...skip('a', day, 'breakfast'), deleted: true },
      { ...skip('b', day, 'breakfast'), deleted: true },
    ])
  })

  it('записанная еда снимает отметку своего приёма — и только его', () => {
    const skips = [skip('a', day, 'breakfast'), skip('b', day, 'lunch'), skip('c', '2026-10-05', 'breakfast')]
    expect(liftedSkips(skips, [eaten(day, 'breakfast')])).toEqual([{ ...skip('a', day, 'breakfast'), deleted: true }])
    expect(liftedSkips(skips, [eaten(day, 'snack')])).toEqual([])
  })
})

describe('«Неделя»: приёмов не было — Р-59', () => {
  it('отметки недели — по дням и приёмам; чужая неделя и снятые едой — нет', () => {
    const skips = [
      skip('a', '2026-10-07', 'dinner'),
      skip('b', '2026-10-06', 'breakfast', { reason: 'не успел' }),
      skip('c', '2026-10-12', 'breakfast'),
      skip('d', '2026-10-08', 'lunch'),
    ]
    const week = { from: '2026-10-05', to: '2026-10-11' }
    expect(periodSkips(skips, [eaten('2026-10-08', 'lunch')], week).map((each) => each.id)).toEqual(['b', 'a'])
  })

  it('строка — день недели, приём и причина, если есть', () => {
    expect(skipLineText({ date: '2026-10-06', meal: 'breakfast', reason: 'не успел' })).toBe('вт, завтрак — не успел')
    expect(skipLineText({ date: '2026-10-11', meal: 'dinner' })).toBe('вс, ужин')
  })
})
