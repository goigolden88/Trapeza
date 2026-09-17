import { describe, expect, it } from 'vitest'
import { monthPeriod } from '../../core/dates.ts'
import { filterFeed } from '../../core/feed.ts'
import type { Category, Dish, Intake } from '../../core/model.ts'
import { dayDetail, dayLink, intakeFeed, intakeMarkdown, mealsLine, MISSING_DISH } from './feed.ts'

const at = '2026-09-16T10:00:00.000Z'
const TODAY = '2026-09-17'

const categories: Category[] = [
  { id: 'cat:сладости', updatedAt: at, name: 'Сладости', order: 0, group: 'Пироги и сладости' },
  { id: 'cat:каши', updatedAt: at, name: 'Каши', order: 1, group: 'Каши' },
]

const dishes: Dish[] = [
  { id: 'dish:каша', updatedAt: at, name: 'Каша', categoryId: 'cat:каши', kcalPortion: 200 },
  { id: 'dish:компот', updatedAt: at, name: 'Компот' },
  { id: 'dish:суп', updatedAt: at, name: 'Суп', portionGrams: 300 },
  { id: 'dish:торт', updatedAt: at, name: 'Торт', categoryId: 'cat:сладости' },
  { id: 'dish:пирог', updatedAt: at, name: 'Пирог', deleted: true },
]

let counter = 0
function eaten(date: string, meal: Intake['meal'], dish: string, fields: Partial<Intake> = {}): Intake {
  counter += 1
  return { id: `i${String(counter).padStart(4, '0')}`, updatedAt: at, date, meal, dishId: `dish:${dish}`, ...fields }
}

const march = [
  eaten('2026-03-02', 'dinner', 'торт', { note: 'у мамы' }),
  eaten('2026-03-02', 'breakfast', 'каша'),
  eaten('2026-03-02', 'breakfast', 'компот', { portions: 2 }),
  eaten('2026-03-02', 'lunch', 'суп', { grams: 450, at: '14:40' }),
  eaten('2026-03-02', 'snack', 'пирог'),
  eaten('2026-03-02', 'snack', 'нет-такого', { deleted: true }),
]

const byId = new Map(dishes.map((dish) => [dish.id, dish]))

describe('строка ленты на день', () => {
  it('приёмы в порядке дня, блюда в порядке записи; порции ×, граммы — «г»; надгробие — своим именем', () => {
    expect(mealsLine(march.filter((record) => !record.deleted), byId)).toBe(
      'Завтрак: Каша, Компот ×2 · Обед: Суп 450 г · Ужин: Торт · Перекус: Пирог',
    )
    expect(mealsLine([eaten('2026-03-03', 'lunch', 'пропало')], byId)).toBe(`Обед: ${MISSING_DISH}`)
  })

  it('под строкой — порции дня и ккал с основанием; ккал не известны ни у одной — без них', () => {
    const live = march.filter((record) => !record.deleted)
    // Каша 1 + Компот 2 + Суп 450/300 + Торт 1 + Пирог 1 = 6,5; ккал — только у каши.
    expect(dayDetail(live, byId)).toBe('6,5 порции · 200 ккал по 1 из 5 записей')
    expect(dayDetail([eaten('2026-03-03', 'lunch', 'компот')], byId)).toBe('1 порция')
  })

  it('строка на день, не на запись; удалённые не в счёт; тап — день на «Сегодня», сегодня — без параметра', () => {
    const items = intakeFeed([...march, eaten(TODAY, 'lunch', 'каша')], dishes, categories, TODAY)
    expect(items.map((item) => [item.id, item.date, item.link])).toEqual([
      ['day:2026-03-02', '2026-03-02', '/?day=2026-03-02'],
      [`day:${TODAY}`, TODAY, '/'],
    ])
    expect(dayLink('2026-03-02', TODAY)).toBe('/?day=2026-03-02')
  })

  it('поиск находит день по категории, группе, заметке и дате словами, а не только по названиям', () => {
    const items = intakeFeed(march, dishes, categories, TODAY)
    for (const query of ['сладости март', 'пироги', 'у мамы', 'каши 02.03.2026', 'компот']) {
      expect(filterFeed(items, { query }).map((item) => item.id), query).toEqual(['day:2026-03-02'])
    }
    expect(filterFeed(items, { query: 'сладости апрель' })).toEqual([])
  })

  it('кривая дата — своей строкой, без перехода: запись не теряется', () => {
    const [item] = intakeFeed([eaten('03.02.2026', 'lunch', 'каша')], dishes, categories, TODAY)
    expect(item?.date).toBe('03.02.2026')
    expect(item?.link).toBeUndefined()
  })
})

describe('раздел markdown', () => {
  const april = [eaten('2026-04-01', 'breakfast', 'каша', { note: '*сладкая* с [ягодами]' })]

  it('месяц с итогом и основанием, день с порциями, приёмы подпунктами; от старых к новым', () => {
    const text = intakeMarkdown([...april, ...march], dishes)
    expect(text.split('\n')).toEqual([
      '### Март 2026',
      '',
      'Учёт в 1 дне · 6,5 порции · 5 записей · 200 ккал по 1 из 5 записей',
      '',
      '- 02.03, пн — 6,5 порции',
      '  - Завтрак: Каша, Компот ×2',
      '  - Обед: Суп 450 г (14:40)',
      '  - Ужин: Торт (у мамы)',
      '  - Перекус: Пирог',
      '',
      '### Апрель 2026',
      '',
      'Учёт в 1 дне · 1 порция · 1 запись · 200 ккал по 1 из 1 записи',
      '',
      '- 01.04, ср — 1 порция',
      '  - Завтрак: Каша (\\*сладкая\\* с \\[ягодами\\])',
    ])
  })

  it('за период — только его дни; кривая дата в период не попадает, за всё время — в конце', () => {
    const crooked = eaten('когда-то', 'lunch', 'компот')
    const period = intakeMarkdown([...april, ...march, crooked], dishes, monthPeriod('2026-04'))
    expect(period).toContain('### Апрель 2026')
    expect(period).not.toContain('Март')
    expect(period).not.toContain('Дата не разобрана')
    const all = intakeMarkdown([...april, ...march, crooked], dishes)
    expect(all.split('\n').slice(-4)).toEqual(['### Дата не разобрана', '', '- «когда-то» — 1 порция', '  - Обед: Компот'])
  })

  it('записей нет — так и сказано', () => {
    expect(intakeMarkdown([], dishes)).toBe('Записей нет.')
    expect(intakeMarkdown(march, dishes, monthPeriod('2026-05'))).toBe('Записей нет.')
  })
})
