import { describe, expect, it } from 'vitest'
import { monthPeriod, yearPeriod } from '../core/dates.ts'
import { exportSpan, monthChoices, monthTitle, yearChoices } from './period.ts'

/** 14.09.2026 — понедельник. */
const TODAY = '2026-09-14'

describe('подписи', () => {
  it('месяц заголовком — с большой буквы', () => {
    expect(monthTitle('2026-09')).toBe('Сентябрь 2026')
  })
})

// Своё «Трапезы»: у «Делу Время» с d86f0aa на выбор периода тестов нет.
describe('период выгрузки markdown — Р-34', () => {
  it('месяцы — от первой записи до текущего, свежие сверху; кривые и будущие даты не в счёт', () => {
    expect(monthChoices(['2026-07-03', 'когда-то', '2026-12-01', '2026-08-20'], TODAY)).toEqual([
      '2026-09',
      '2026-08',
      '2026-07',
    ])
    expect(monthChoices([], TODAY)).toEqual(['2026-09'])
  })

  it('через год — годы тех же месяцев, свежие сверху', () => {
    const months = monthChoices(['2025-11-30'], '2026-02-01')
    expect(months).toEqual(['2026-02', '2026-01', '2025-12', '2025-11'])
    expect(yearChoices(months)).toEqual([2026, 2025])
  })

  it('значение списка → период с названием для шапки; пустое и кривое — за всё время', () => {
    expect(exportSpan('m:2026-03')).toEqual({ period: monthPeriod('2026-03'), label: 'март 2026' })
    expect(exportSpan('y:2026')).toEqual({ period: yearPeriod(2026), label: '2026 год' })
    expect(exportSpan('')).toBeNull()
    expect(exportSpan('m:2026-13')).toBeNull()
    expect(exportSpan('y:26')).toBeNull()
  })
})
