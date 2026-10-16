import { describe, expect, it } from 'vitest'
import type { Category, Dish, Intake, Norm } from '../../app/model.ts'
import { monthNormText, monthSummary, viewedMonth } from './month.ts'
import { indexDays } from './norms.ts'

/**
 * Итог месяца (Р-61). Февраль 2026 начинается в воскресенье: его недели —
 * 26 января – 1 февраля, 2–8, 9–15, 16–22 февраля; неделя 23 февраля –
 * 1 марта — уже мартовская.
 */

const at = '2026-02-11T09:00:00.000Z'
const FEB = '2026-02'

const categories: Category[] = [{ id: 'cat:Сладости', updatedAt: at, name: 'Сладости', order: 1 }]
const dishes = new Map<string, Dish>(
  (
    [
      { id: 'dish:Торт', updatedAt: at, name: 'Торт', categoryId: 'cat:Сладости', kcalPortion: 300 },
      { id: 'dish:Каша', updatedAt: at, name: 'Каша', kcalPortion: 200 },
      { id: 'dish:Сырок', updatedAt: at, name: 'Сырок' },
    ] satisfies Dish[]
  ).map((dish) => [dish.id, dish]),
)
const sweet: Norm = { id: '01NORMSWEET', updatedAt: at, name: 'Сладкое', categoryIds: ['cat:Сладости'], maxDays: 2, order: 0 }

let next = 0
function eaten(date: string, dish: string, fields: Partial<Intake> = {}): Intake {
  next += 1
  return { id: `i${next}`, updatedAt: at, date, meal: 'lunch', dishId: `dish:${dish}`, ...fields }
}

function month(intake: Intake[], today: string, norms: Norm[] = [sweet], of = FEB) {
  return monthSummary(intake, dishes, categories, norms, indexDays(intake, dishes), of, today)
}

describe('какой месяц — Р-61', () => {
  it('месяц из адреса; кривой, пустой и будущий — текущий', () => {
    expect(viewedMonth('2025-12', '2026-02-11')).toBe('2025-12')
    expect(viewedMonth(null, '2026-02-11')).toBe(FEB)
    expect(viewedMonth('', '2026-02-11')).toBe(FEB)
    expect(viewedMonth('2026-13', '2026-02-11')).toBe(FEB)
    expect(viewedMonth('2026-03', '2026-02-11')).toBe(FEB)
  })
})

describe('недели месяца — в месяце своего воскресенья', () => {
  it('февраль — четыре недели с 26 января по 22 февраля', () => {
    const feb = month([], '2026-03-10')
    expect(feb.weeks.map((week) => week.from)).toEqual(['2026-01-26', '2026-02-02', '2026-02-09', '2026-02-16'])
    expect(feb.span).toEqual({ from: '2026-01-26', to: '2026-02-22' })
    expect(feb.days).toBe(28)
  })

  it('записи с 23 февраля — в марте, 1 февраля — в феврале', () => {
    const intake = [eaten('2026-02-01', 'Каша'), eaten('2026-02-23', 'Каша'), eaten('2026-02-28', 'Каша')]
    expect(month(intake, '2026-03-10').records).toBe(1)
    expect(month(intake, '2026-03-10', [sweet], '2026-03').records).toBe(2)
  })
})

describe('итог месяца — сводка недель (Р-01, Р-61)', () => {
  const intake = [
    eaten('2026-02-02', 'Торт'),
    eaten('2026-02-02', 'Каша'),
    eaten('2026-02-03', 'Торт'),
    eaten('2026-02-10', 'Сырок'),
    eaten('2026-02-11', 'Каша', { deleted: true }),
    eaten('2026-02-17', 'Каша', { portions: 2 }),
  ]

  it('закончившийся: дни учёта из всех дней недель, ккал по известным', () => {
    const feb = month(intake, '2026-03-10')
    expect(feb).toMatchObject({ records: 5, logged: 4, elapsed: 28, current: false })
    expect(feb.kcal).toEqual({ kcal: 1200, counted: 4, total: 5 })
  })

  it('идущий: дни — из наступивших, неделя впереди пуста', () => {
    const feb = month(intake, '2026-02-11')
    expect(feb).toMatchObject({ records: 4, logged: 3, elapsed: 17, current: true })
  })

  it('без записей — ноль записей, а не ноль калорий', () => {
    const feb = month([], '2026-03-10')
    expect(feb).toMatchObject({ records: 0, logged: 0, kcal: { kcal: 0, counted: 0, total: 0 } })
  })
})

describe('нормы за месяц — числом недель (Р-24, Р-61)', () => {
  it('закончившиеся недели: выполнена, провалена, без записей', () => {
    const intake = [
      // 2–8: сладкое в трёх днях — провалена.
      eaten('2026-02-02', 'Торт'),
      eaten('2026-02-03', 'Торт'),
      eaten('2026-02-04', 'Торт'),
      // 9–15: каждый день учёт, сладкое в одном — выполнена.
      ...['09', '10', '11', '12', '13', '14', '15'].map((day) => eaten(`2026-02-${day}`, day === '09' ? 'Торт' : 'Каша')),
      // 16–22: учёт в двух днях без сладкого — не ясна.
      eaten('2026-02-16', 'Каша'),
      eaten('2026-02-17', 'Каша'),
    ]
    const [line] = month(intake, '2026-03-10').norms
    expect(line).toMatchObject({ counted: 2, met: 1, open: 1, empty: 1, pending: false })
    expect(line && monthNormText(line)).toBe('выполнена в 1 неделе из 2 · 1 неделя не ясна · 1 неделя без записей')
  })

  it('идущая судится досрочно, когда исход ясен; иначе — «идущая неделя пока не ясна»', () => {
    const failed = ['09', '10', '11'].map((day) => eaten(`2026-02-${day}`, 'Торт'))
    expect(month(failed, '2026-02-11').norms[0]).toMatchObject({ counted: 1, met: 0, pending: false })

    const [line] = month([eaten('2026-02-09', 'Торт')], '2026-02-11').norms
    expect(line).toMatchObject({ counted: 0, pending: true })
    expect(line && monthNormText(line)).toBe('недель в счёт нет · 2 недели без записей · идущая неделя пока не ясна')
  })

  it('недели до понедельника `since` не судятся; день начала — в тексте', () => {
    const since = { ...sweet, since: '2026-02-10' }
    const intake = [eaten('2026-02-02', 'Каша'), ...['16', '17', '18', '19', '20', '21', '22'].map((day) => eaten(`2026-02-${day}`, 'Каша'))]
    const [line] = month(intake, '2026-03-10', [since]).norms
    expect(line).toMatchObject({ before: 3, counted: 1, met: 1 })
    expect(line && monthNormText(line)).toBe('с 10 февраля 2026 · выполнена в 1 неделе из 1')
  })

  it('удалённой нормы нет', () => {
    expect(month([], '2026-03-10', [{ ...sweet, deleted: true }]).norms).toEqual([])
  })
})
