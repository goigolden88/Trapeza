import { describe, expect, it } from 'vitest'
import type { Intake } from '../../app/model.ts'
import { unfilledNotice } from './remind.ts'
import { MAIN_MEALS, skipKey } from './skips.ts'

const at = '2026-09-16T10:00:00.000Z'
const today = '2026-09-19'
const yesterday = '2026-09-18'

let next = 0
function eaten(date: string, meal: Intake['meal'], fields: Partial<Intake> = {}): Intake {
  next += 1
  return { id: `i${next}`, updatedAt: at, date, meal, dishId: 'dish:каша', ...fields }
}

const fullYesterday = [eaten(yesterday, 'breakfast'), eaten(yesterday, 'lunch'), eaten(yesterday, 'dinner')]

describe('напоминание о незаполненном дне — Р-30', () => {
  it('вчера всё записано и сегодня есть запись — напоминать не о чем', () => {
    expect(unfilledNotice([...fullYesterday, eaten(today, 'snack')], today, [], MAIN_MEALS)).toBeNull()
  })

  it('сегодня ни одной записи — даже перекус считается записью', () => {
    expect(unfilledNotice(fullYesterday, today, [], MAIN_MEALS)).toEqual({
      title: 'Сегодня ничего не записано',
      body: 'Одним тапом — блюдо на «Сегодня»; привычное — «Как обычно?» и шаблоны.',
    })
  })

  it('вчера не записан один приём — называется; перекус вчера не в счёт', () => {
    const intake = [eaten(yesterday, 'breakfast'), eaten(yesterday, 'lunch'), eaten(yesterday, 'snack'), eaten(today, 'breakfast')]
    expect(unfilledNotice(intake, today, [], MAIN_MEALS)).toEqual({
      title: 'Вчера не записан: ужин',
      body: 'На «Сегодня» — «Как обычно?» одним тапом.',
    })
  })

  it('вчера пропущено несколько и сегодня пусто — всё в одном уведомлении', () => {
    expect(unfilledNotice([eaten(yesterday, 'lunch')], today, [], MAIN_MEALS)).toEqual({
      title: 'Вчера не записаны: завтрак, ужин',
      body: 'И сегодня пока ничего. На «Сегодня» — «Как обычно?» одним тапом.',
    })
  })

  it('«Не было» — не пропуск; удалённая запись — не запись', () => {
    const intake = [eaten(yesterday, 'breakfast'), eaten(yesterday, 'lunch', { deleted: true }), eaten(today, 'lunch')]
    expect(unfilledNotice(intake, today, [skipKey(yesterday, 'dinner')], MAIN_MEALS)?.title).toBe('Вчера не записан: обед')
    expect(unfilledNotice(intake, today, [skipKey(yesterday, 'dinner'), skipKey(yesterday, 'lunch')], MAIN_MEALS)).toBeNull()
  })

  it('снятый в «Основных приёмах» — не пропуск — Р-59', () => {
    const intake = [eaten(yesterday, 'lunch'), eaten(yesterday, 'dinner'), eaten(today, 'lunch')]
    expect(unfilledNotice(intake, today, [], MAIN_MEALS)?.title).toBe('Вчера не записан: завтрак')
    expect(unfilledNotice(intake, today, [], ['lunch', 'dinner'])).toBeNull()
  })
})
