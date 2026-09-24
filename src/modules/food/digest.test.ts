import { describe, expect, it } from 'vitest'
import { buildSummary, checkSummary, UNKNOWN, type Metric, type PeriodSummary } from '../../shared/core/summary.ts'
import type { Category, Dish, Intake, Norm } from '../../app/model.ts'
import { attentionOf, NO_KCAL, summary, type DigestData } from './digest.ts'

/**
 * Срез итогов (Р-55). День расчёта — среда 11 февраля: прошлая неделя —
 * 2–8 февраля, идущая — 9–15, месяцы — январь и февраль.
 */

const at = '2026-02-11T09:00:00.000Z'
const DAY = '2026-02-11'
const NOTE = 'заметка-секрет'
const RECIPE = 'рецепт-секрет'

const categories: Category[] = [
  { id: 'cat:Супы', updatedAt: at, name: 'Супы', order: 1, group: 'Первое' },
  { id: 'cat:Сладости', updatedAt: at, name: 'Сладости', order: 2 },
]
const dishes: Dish[] = [
  { id: 'dish:Щи', updatedAt: at, name: 'Щи', categoryId: 'cat:Супы', kcalPortion: 200, recipe: RECIPE },
  { id: 'dish:Торт', updatedAt: at, name: 'Торт', categoryId: 'cat:Сладости', kcalPortion: 300 },
  { id: 'dish:Борщ', updatedAt: at, name: 'Борщ', categoryId: 'cat:Супы' },
  { id: 'dish:Сырок', updatedAt: at, name: 'Сырок' },
]
const norms: Norm[] = [
  { id: '01NORMSWEET', updatedAt: at, name: 'Сладкое', categoryIds: ['cat:Сладости'], maxDays: 2, order: 0 },
  { id: '01NORMGONE', updatedAt: at, name: 'Удалённая', categoryIds: ['cat:Супы'], minDays: 1, order: 1, deleted: true },
]

let next = 0
function eaten(date: string, meal: Intake['meal'], dish: string, fields: Partial<Intake> = {}): Intake {
  next += 1
  return { id: `i${next}`, updatedAt: at, date, meal, dishId: `dish:${dish}`, ...fields }
}

const intake: Intake[] = [
  // Прошлая неделя: пять дней учёта из семи, сладкое — в трёх.
  eaten('2026-02-02', 'breakfast', 'Торт'),
  eaten('2026-02-02', 'lunch', 'Щи'),
  eaten('2026-02-03', 'lunch', 'Торт'),
  eaten('2026-02-04', 'dinner', 'Торт'),
  eaten('2026-02-05', 'lunch', 'Сырок'),
  eaten('2026-02-06', 'lunch', 'Борщ', { grams: 250, note: NOTE }),
  // Идущая: понедельник и вторник, вчера — без ужина.
  eaten('2026-02-09', 'lunch', 'Щи'),
  eaten('2026-02-10', 'breakfast', 'Щи'),
  eaten('2026-02-10', 'lunch', 'Торт'),
]

const data: DigestData = { categories, dishes, templates: [], norms, intake }
const empty: DigestData = { categories: [], dishes: [], templates: [], norms: [], intake: [] }

function metricsOf(period: PeriodSummary | undefined): Metric[] {
  if (!period || !Array.isArray(period.metrics)) throw new Error('у отрезка нет показателей')
  return period.metrics
}

function metric(period: PeriodSummary | undefined, key: string): Metric {
  const found = metricsOf(period).find((each) => each.key === key)
  if (!found) throw new Error(`нет показателя ${key}`)
  return found
}

describe('срез итогов — форма договора (Я-17, Р-55)', () => {
  it('проходит проверку ядра на своих данных и на пустых', () => {
    expect(() => checkSummary(buildSummary(summary(data, DAY), data, DAY))).not.toThrow()
    expect(() => checkSummary(buildSummary(summary(empty, DAY), empty, DAY))).not.toThrow()
  })

  it('четыре отрезка: у идущих through — день расчёта, у закончившихся — null', () => {
    const periods = summary(data, DAY).periods
    expect(periods.map(({ grain, from, to, through }) => [grain, from, to, through])).toEqual([
      ['week', '2026-02-02', '2026-02-08', null],
      ['week', '2026-02-09', '2026-02-15', DAY],
      ['month', '2026-01-01', '2026-01-31', null],
      ['month', '2026-02-01', '2026-02-28', DAY],
    ])
  })

  it('месяцы — not-provided со словами (Я-19, п. 1)', () => {
    for (const period of summary(data, DAY).periods.slice(2)) {
      expect(period.metrics).toMatchObject({ unknown: UNKNOWN.notProvided })
      expect(period.metrics).toHaveProperty('text', expect.stringContaining('месяц'))
    }
  })

  it('одинаковые данные в один день — одинаковый срез', () => {
    expect(JSON.stringify(summary(data, DAY))).toBe(JSON.stringify(summary(data, DAY)))
  })

  it('заметка записи и рецепт блюда в срез не идут (Я-14)', () => {
    const text = JSON.stringify(summary(data, DAY))
    expect(text).not.toContain(NOTE)
    expect(text).not.toContain(RECIPE)
  })

  it('групп и категорий в срезе нет', () => {
    const keys = summary(data, DAY).periods.flatMap((period) => (Array.isArray(period.metrics) ? period.metrics : []))
    expect(keys.map((each) => each.key).filter((key) => /group|cat/.test(key))).toEqual([])
    expect(JSON.stringify(keys)).not.toContain('Первое')
  })
})

describe('неделя — числа экрана «Неделя» с основанием (Р-01, Р-55)', () => {
  const [last, current] = summary(data, DAY).periods

  it('дни учёта, записи, порции, без категории', () => {
    expect(metric(last, 'intake.logged')).toMatchObject({ value: { n: 5, unit: 'days' }, basis: 'Из 7 дней недели' })
    expect(metric(last, 'intake.records')).toMatchObject({ value: { n: 6, unit: 'count' }, basis: 'Учёт в 5 днях из 7' })
    expect(metric(last, 'intake.portions')).toMatchObject({
      value: { n: 6, unit: 'count' },
      basis: 'по 6 записям; 1 запись в граммах без веса порции посчитана одной порцией',
    })
    expect(metric(last, 'intake.loose')).toMatchObject({
      value: { n: 1, unit: 'count' },
      basis: '1 запись из 6; в нормы не входят',
    })
  })

  it('ккал — сумма и среднее на день учёта, по скольким записям', () => {
    expect(metric(last, 'kcal.total')).toMatchObject({
      value: { n: 1100, unit: 'kcal' },
      basis: 'по 4 из 6 записей — у остальных блюд ккал не известны',
    })
    expect(metric(last, 'kcal.perDay')).toMatchObject({
      value: { n: 220, unit: 'kcal' },
      basis: 'В среднем за 5 дней учёта, по 4 из 6 записей',
    })
  })

  it('идущая неделя — из наступивших дней', () => {
    expect(metric(current, 'intake.logged')).toMatchObject({ value: { n: 2 }, basis: 'Из 3 наступивших дней недели' })
    expect(metric(current, 'intake.records').basis).toBe('Учёт в 2 днях из 3 наступивших')
  })

  it('ккал не известны ни у одной — no-kcal, не ноль', () => {
    const week = summary({ ...data, intake: [eaten('2026-02-10', 'lunch', 'Сырок')] }, DAY).periods[1]
    expect(metric(week, 'kcal.total').value).toEqual({ unknown: NO_KCAL, text: 'Ккал не известны ни у одной из 1 записи' })
    expect(metric(week, 'kcal.perDay').value).toMatchObject({ unknown: NO_KCAL })
  })

  it('неделя без записей — no-data целиком', () => {
    const periods = summary(data, '2026-03-04').periods
    expect(periods[0]?.metrics).toMatchObject({ unknown: UNKNOWN.noData })
    expect(periods[1]?.metrics).toMatchObject({ unknown: UNKNOWN.noData })
  })
})

describe('нормы — вердикт экрана «Неделя» (Р-24, Р-55)', () => {
  const [last, current] = summary(data, DAY).periods

  it('ключ — id нормы, подпись — её имя, в основании правило и дни', () => {
    expect(metric(last, 'norm.01NORMSWEET')).toEqual({
      key: 'norm.01NORMSWEET',
      label: 'Норма: Сладкое',
      value: { verdict: 'failed' },
      basis: 'не больше 2 дней: 3 дня с записью, 2 без записей',
    })
  })

  it('идущая — не ясна, пока исход зависит от дней впереди', () => {
    expect(metric(current, 'norm.01NORMSWEET')).toMatchObject({
      value: { verdict: 'open' },
      basis: 'не больше 2 дней: 1 день с записью, 5 без записей или впереди',
    })
  })

  it('идущая судится досрочно, когда исход уже ясен', () => {
    const sweet = [eaten('2026-02-09', 'lunch', 'Торт'), eaten('2026-02-10', 'lunch', 'Торт'), eaten('2026-02-11', 'lunch', 'Торт')]
    const week = summary({ ...data, intake: sweet }, DAY).periods[1]
    expect(metric(week, 'norm.01NORMSWEET').value).toEqual({ verdict: 'failed' })
  })

  it('удалённой нормы нет', () => {
    expect(metricsOf(last).some((each) => each.key === 'norm.01NORMGONE')).toBe(false)
  })
})

describe('«требует внимания» — вчерашние пропуски по записям (Р-55, Я-19 п. 2)', () => {
  it('вчера без ужина — один приём, день — вчера, ссылка — день на «Сегодня»', () => {
    expect(attentionOf(intake, DAY)).toEqual([
      {
        key: 'meals.missed',
        label: 'Приёмы без записи',
        count: 1,
        day: '2026-02-10',
        link: '/?day=2026-02-10',
        basis: 'По записям нет: ужин. Отметки «Не было» живут на устройстве и не учтены',
      },
    ])
  })

  it('пустой вчерашний день — все три основных приёма', () => {
    expect(attentionOf(intake, '2026-03-04')[0]).toMatchObject({ count: 3, day: '2026-03-03' })
  })

  it('перекус не в счёт; все три записаны — пункта нет', () => {
    const main: Intake['meal'][] = ['breakfast', 'lunch', 'dinner']
    const full = [eaten(DAY, 'snack', 'Сырок'), ...main.map((meal) => eaten('2026-02-10', meal, 'Щи'))]
    expect(attentionOf(full, DAY)).toEqual([])
  })

  it('до первой записи вообще — пункта нет: учёт не начат', () => {
    expect(attentionOf(intake, '2026-02-02')).toEqual([])
    expect(attentionOf([], DAY)).toEqual([])
  })

  it('удалённая запись приём не закрывает', () => {
    const gone = [eaten('2026-02-09', 'lunch', 'Щи'), eaten('2026-02-10', 'breakfast', 'Щи', { deleted: true })]
    expect(attentionOf(gone, DAY)[0]?.count).toBe(3)
  })
})
