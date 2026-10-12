import { describe, expect, it } from 'vitest'
import { addDays, weekPeriod, type DateStr } from '../shared/core/dates.ts'
import { checkDemo } from '../shared/core/demo.ts'
import { config } from '../app/config.ts'
import { planSize, reconcilePlan } from '../modules/food/catalog.ts'
import { nameId } from '../modules/food/names.ts'
import { checkWeek, indexDays } from '../modules/food/norms.ts'
import { activeSkips, liftedSkips, MAIN_MEALS } from '../modules/food/skips.ts'
import { DEMO_DAYS, demo } from './demo.ts'

/**
 * Демо-данные (Я-44, Я-45 «FamilyCore»): каждое хранилище не пусто,
 * ссылки — на записи того же демо, слиянию и снятию отметок делать нечего,
 * и неделя показывает норму, которая не уложилась. Дни — понедельник,
 * воскресенье и первое число: неделя и месяц режутся по-разному.
 */

const DAYS: readonly DateStr[] = ['2026-10-12', '2026-10-18', '2026-03-01']

describe.each(DAYS)('демо от %s', (day) => {
  const data = demo(day)

  it('сторож ядра доволен: все хранилища, поля Base, id без повторов', () => {
    expect(checkDemo(config, day)).toEqual([])
  })

  it('ссылки — на категории и блюда того же демо', () => {
    const categories = new Set(data.categories.map((each) => each.id))
    const dishes = new Set(data.dishes.map((each) => each.id))
    for (const dish of data.dishes) if (dish.categoryId) expect(categories).toContain(dish.categoryId)
    for (const record of data.intake) expect(dishes).toContain(record.dishId)
    for (const template of data.templates) for (const item of template.items) expect(dishes).toContain(item.dishId)
    for (const norm of data.norms) for (const id of norm.categoryIds) expect(categories).toContain(id)
  })

  it('id справочника — из названия (Р-12), одноимённых нет: слиянию делать нечего', () => {
    for (const each of data.categories) expect(each.id).toBe(nameId('cat', each.name))
    for (const each of data.dishes) expect(each.id).toBe(nameId('dish', each.name))
    expect(planSize(reconcilePlan(data))).toBe(0)
  })

  it('еда — две недели до дня входа, сегодня и вчера с записями', () => {
    const dates = new Set(data.intake.map((each) => each.date))
    expect(dates.size).toBe(DEMO_DAYS)
    expect(dates).toContain(day)
    expect(dates).toContain(addDays(day, -1))
    expect([...dates].every((each) => each >= addDays(day, -(DEMO_DAYS - 1)) && each <= day)).toBe(true)
  })

  it('«Не было» — у основных приёмов без еды: еда их не снимает (Р-59)', () => {
    expect(data.skips.every((each) => MAIN_MEALS.includes(each.meal))).toBe(true)
    expect(liftedSkips(data.skips, data.intake)).toEqual([])
    expect(activeSkips(data.skips, data.intake)).toHaveLength(data.skips.length)
  })

  it('в прошлой неделе «Сладкое» не уложилось', () => {
    const sweet = data.norms.find((each) => each.name === 'Сладкое')
    expect(sweet).toBeDefined()
    if (!sweet) return
    const index = indexDays(data.intake, new Map(data.dishes.map((each) => [each.id, each])))
    const check = checkWeek(sweet, index, addDays(day, -7))
    expect(check.week).toEqual(weekPeriod(addDays(day, -7)))
    expect(check.verdict).toBe('failed')
  })
})
