import { describe, expect, it } from 'vitest'
import { monthPeriod, yearPeriod } from '../core/dates.ts'
import {
  closedMonth,
  defaultMonth,
  MONTH_LOOKBACK_DAYS,
  monthLabel,
  monthTitle,
  runningText,
  viewedMonth,
  viewedYear,
} from './period.ts'

/** 14.09.2026 — понедельник. */
const TODAY = '2026-09-14'

describe('какой месяц показать — Р-54', () => {
  it('в первые дни месяца — прошлый, дальше — текущий, через год тоже', () => {
    const edge = `2026-09-${String(MONTH_LOOKBACK_DAYS).padStart(2, '0')}`
    expect(defaultMonth(edge)).toBe('2026-08')
    expect(defaultMonth(`2026-09-${String(MONTH_LOOKBACK_DAYS + 1).padStart(2, '0')}`)).toBe('2026-09')
    expect(defaultMonth('2026-01-03')).toBe('2025-12')
  })

  it('из адреса — не позже текущего; кривое и будущее — по умолчанию', () => {
    expect(viewedMonth('2026-02', TODAY)).toBe('2026-02')
    expect(viewedMonth('2026-09', TODAY)).toBe('2026-09')
    expect(viewedMonth('2026-10', TODAY)).toBe('2026-09')
    expect(viewedMonth('2026-9', TODAY)).toBe('2026-09')
    expect(viewedMonth(null, '2026-10-02')).toBe('2026-09')
  })

  it('год: из адреса не позже текущего; иначе — год месяца по умолчанию', () => {
    expect(viewedYear('2025', TODAY)).toBe(2025)
    expect(viewedYear('2027', TODAY)).toBe(2026)
    expect(viewedYear('двадцать', TODAY)).toBe(2026)
    expect(viewedYear(null, '2026-01-05')).toBe(2025)
  })
})

describe('неделя, закрывшая месяц — Р-54', () => {
  it('конец месяца в неделе и уже наступил', () => {
    expect(closedMonth('2026-09-28', '2026-10-05')).toBe('2026-09')
    // Неделя идёт, 30 сентября ещё не настало.
    expect(closedMonth('2026-09-28', '2026-09-29')).toBeNull()
    expect(closedMonth('2026-09-07', TODAY)).toBeNull()
    // 31.05.2026 — воскресенье: неделя с 25 мая закрывает май.
    expect(closedMonth('2026-05-27', '2026-06-01')).toBe('2026-05')
  })
})

describe('подписи', () => {
  it('месяц заголовком и подписью — с большой буквы', () => {
    expect(monthTitle('2026-09')).toBe('Сентябрь 2026')
    expect(monthLabel('2026-02')).toBe('Февраль')
  })

  it('идущий промежуток — с основанием и склонением; прошедший — ничего', () => {
    expect(runningText(monthPeriod('2026-09'), TODAY, 'Месяц')).toBe('Месяц ещё идёт: прошло 14 дней из 30')
    expect(runningText(monthPeriod('2026-09'), '2026-09-01', 'Месяц')).toBe('Месяц ещё идёт: прошёл 1 день из 30')
    expect(runningText(yearPeriod(2026), '2026-01-03', 'Год')).toBe('Год ещё идёт: прошло 3 дня из 365')
    expect(runningText(monthPeriod('2026-08'), TODAY, 'Месяц')).toBeNull()
  })
})
