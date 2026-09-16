import { describe, expect, it } from 'vitest'
import { isDateStr } from './core/dates.ts'
import { CHANGES, latestChange, unseenChanges, type Change } from './changes.ts'

describe('список изменений', () => {
  it('id с единицы и растут на один — по ним устройство помнит прочитанное', () => {
    CHANGES.forEach((change, index) => expect(change.id).toBe(index + 1))
  })

  it('даты читаются и не убывают', () => {
    CHANGES.forEach((change, index) => {
      expect(isDateStr(change.date)).toBe(true)
      const previous = CHANGES[index - 1]
      if (previous) expect(change.date >= previous.date).toBe(true)
    })
  })

  it('в каждой записи есть строки, пустых нет', () => {
    for (const change of CHANGES) {
      expect(change.lines.length).toBeGreaterThan(0)
      for (const line of change.lines) expect(line.trim()).not.toBe('')
    }
  })
})

describe('что показать после обновления', () => {
  const list: Change[] = [
    { id: 1, date: '2026-09-11', lines: ['первое'] },
    { id: 2, date: '2026-09-20', lines: ['второе'] },
    { id: 3, date: '2026-10-01', lines: ['третье'] },
  ]

  it('свежая установка: ничего не показывать, всё отметить прочитанным', () => {
    expect(unseenChanges(list, null, true)).toEqual({ show: [], markSeen: 3 })
  })

  it('обновилась копия без ключа, данные есть: только последняя запись', () => {
    expect(unseenChanges(list, null, false)).toEqual({ show: [list[2]], markSeen: null })
  })

  it('ключ есть: всё новее прочитанного', () => {
    expect(unseenChanges(list, 1, false).show.map((change) => change.id)).toEqual([2, 3])
    expect(unseenChanges(list, 1, true).show.map((change) => change.id)).toEqual([2, 3])
  })

  it('всё прочитано — ничего', () => {
    expect(unseenChanges(list, 3, false)).toEqual({ show: [], markSeen: null })
  })

  it('«Понятно» пишет последний id; пустой список — ноль', () => {
    expect(latestChange(list)).toBe(3)
    expect(latestChange([])).toBe(0)
  })
})
