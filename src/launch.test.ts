import { describe, expect, it } from 'vitest'
import { GO_ROUTES, SHORTCUTS, launchRoute, shortcutUrl } from './launch.ts'

describe('адрес запуска → маршрут — Р-16', () => {
  it('ярлык «Записать» ведёт на «Сегодня»', () => {
    expect(launchRoute('?go=write')).toBe('/')
  })

  it('незнакомый ярлык — главный экран, а не ошибка', () => {
    expect(launchRoute('?go=inbox')).toBe('/')
    // Имена из прототипа объекта ярлыками не считаются.
    expect(launchRoute('?go=toString')).toBe('/')
    expect(launchRoute('?go=')).toBe('/')
  })

  it('обычный запуск и чужие параметры адрес не трогают', () => {
    expect(launchRoute('')).toBeNull()
    expect(launchRoute('?utm_source=x')).toBeNull()
  })

  it('«Поделиться» не принимается: параметры share — чужие', () => {
    expect(launchRoute('?text=борщ')).toBeNull()
  })
})

describe('ярлыки в манифесте', () => {
  const base = '/Trapeza/'

  it('адрес каждого ярлыка разбирается обратно в свой экран', () => {
    for (const shortcut of SHORTCUTS) {
      const url = new URL(shortcutUrl(base, shortcut.go), 'https://example.com')
      expect(url.pathname, shortcut.name).toBe(base)
      const expected = shortcut.go === null ? null : GO_ROUTES[shortcut.go]
      expect(launchRoute(url.search), shortcut.name).toBe(expected)
    }
  })

  it('один ярлык — «Записать», адрес `?go=write` не меняется никогда — Р-16', () => {
    expect(SHORTCUTS.map((shortcut) => shortcut.name)).toEqual(['Записать'])
    expect(shortcutUrl(base, 'write')).toBe('/Trapeza/?go=write')
  })
})
