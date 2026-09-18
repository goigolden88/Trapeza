import { describe, expect, it } from 'vitest'
import { monthPeriod, inPeriod } from '../../shared/core/dates.ts'
import { SYNCED_STORES, type Norm } from '../../app/model.ts'
import { indexDays, normHistory } from './norms.ts'
import { planImport, type Data } from '../../registry.ts'
import { summarize } from './summary.ts'

/**
 * Сверка истории таблицы — «Готово когда» Этапа 1 (Р-09, Р-19): февраль —
 * 271 порция, март — 162, как суммы таблицы.
 *
 * Файл личный и лежит в `seed/` под `.gitignore`: нет файла — тест
 * пропускается, на сборке в GitHub Actions его нет. Glob, а не `node:fs`:
 * типов Node в проекте нет, а пустой glob — это и есть «файла нет». Приём —
 * у «Делу Время» (`modules/time/february.test.ts`).
 */
const found = import.meta.glob<{ default: unknown }>('../../../seed/trapeza-import-2026-02-03.json', { eager: true })
const file = Object.values(found)[0]?.default

function empty(): Data {
  return Object.fromEntries(SYNCED_STORES.map((store) => [store, []])) as unknown as Data
}

function imported() {
  let next = 0
  const plan = planImport(JSON.stringify(file), empty(), {
    newId: () => `id${String(next++).padStart(5, '0')}`,
    now: '2026-09-16T10:00:00.000Z',
  })
  return plan
}

describe('история таблицы — Р-09, Р-19', () => {
  it.skipIf(!file)('разбирается без замечаний: 25 категорий, 25 блюд', () => {
    const plan = imported()
    expect(plan.issues).toEqual([])
    expect(plan.writes.categories).toHaveLength(25)
    expect(plan.writes.dishes).toHaveLength(25)
  })

  it.skipIf(!file)('порции сходятся с суммами таблицы: февраль — 271 за 28 дней, март — 162 за 19', () => {
    const plan = imported()
    const intake = plan.writes.intake ?? []
    const dishes = new Map((plan.writes.dishes ?? []).map((dish) => [dish.id, dish]))

    for (const [month, portions, days] of [
      ['2026-02', 271, 28],
      ['2026-03', 162, 19],
    ] as const) {
      const records = intake.filter((record) => inPeriod(record.date, monthPeriod(month)))
      const summary = summarize(records, dishes, plan.writes.categories ?? [])
      expect(summary.portions).toBe(portions)
      expect(summary.loose).toBe(0)
      expect(new Set(records.map((record) => record.date)).size).toBe(days)
    }
  })

  it.skipIf(!file)('норма, заведённая в сентябре, видит февраль–март: шесть полных недель в счёт (Р-13, Р-24)', () => {
    const plan = imported()
    const dishes = new Map((plan.writes.dishes ?? []).map((dish) => [dish.id, dish]))
    const index = indexDays(plan.writes.intake ?? [], dishes)
    const all = (plan.writes.categories ?? []).map((category) => category.id)
    const norm = (rules: Partial<Norm>): Norm => ({ id: 'n', updatedAt: '', name: 'Всё', categoryIds: all, order: 0, ...rules })
    const today = '2026-09-17'

    // Учёт был все 47 дней: полные недели — 2 февраля … 15 марта. Неделя
    // с 1 февраля и 16–19 марта неполны; полгода после — без учёта.
    const every = normHistory(norm({ minDays: 7 }), index, today, today)
    expect([every.weeks.length, every.kept, every.open]).toEqual([6, 6, 2])
    expect(every.weeks[0]?.week.from).toBe('2026-02-02')
    expect(every.weeks.at(-1)?.week.to).toBe('2026-03-15')
    // «Не больше 0» провалена уже одним днём — и неполные недели ясны.
    const never = normHistory(norm({ maxDays: 0 }), index, today, today)
    expect([never.weeks.length, never.kept, never.open]).toEqual([8, 0, 0])
  })

  it.skipIf(!file)('повторная загрузка ничего не удваивает', () => {
    const first = imported()
    const data = { ...empty(), ...first.writes } as Data
    const again = planImport(JSON.stringify(file), data, { newId: () => 'x', now: '2026-09-16T10:00:00.000Z' })
    expect(again.issues).toEqual([])
    expect(Object.values(again.writes).every((records) => (records?.length ?? 0) === 0)).toBe(true)
  })
})
