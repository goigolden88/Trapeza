import { describe, expect, it } from 'vitest'
import { GO_ROUTES, SHORTCUTS, launchRoute, sharedText, shortcutUrl } from './launch.ts'

/** Текст, который увидят входящие, — из маршрута обратно. */
function sharedOf(route: string | null): string | null {
  if (route === null) return null
  const query = route.split('?')[1]
  return query === undefined ? '' : new URLSearchParams(query).get('shared')
}

describe('текст из «Поделиться» — Р-16', () => {
  it('заголовок и ссылка — двумя строками', () => {
    const params = new URLSearchParams({ title: 'Статья про сон', url: 'https://example.com/son' })
    expect(sharedText(params)).toBe('Статья про сон\nhttps://example.com/son')
  })

  it('ссылка, уже стоящая в тексте, второй раз не пишется', () => {
    const params = new URLSearchParams({
      text: 'Посмотри https://example.com/v',
      url: 'https://example.com/v',
    })
    expect(sharedText(params)).toBe('Посмотри https://example.com/v')
  })

  it('заголовок, повторённый в тексте, уступает тексту', () => {
    const params = new URLSearchParams({ title: 'Видео', text: 'Видео https://example.com/v' })
    expect(sharedText(params)).toBe('Видео https://example.com/v')
  })

  it('пробелы по краям и пустые поля отбрасываются', () => {
    const params = new URLSearchParams({ title: '  ', text: '  купить фильтр  ', url: '' })
    expect(sharedText(params)).toBe('купить фильтр')
  })

  it('кириллица и переводы строк доезжают как есть', () => {
    const params = new URLSearchParams({ text: 'первая строка\nвторая — с «кавычками» & знаками' })
    expect(sharedText(params)).toBe('первая строка\nвторая — с «кавычками» & знаками')
  })
})

describe('адрес запуска → маршрут — Р-16', () => {
  it('поделились — входящие с текстом, и текст доезжает целиком', () => {
    const route = launchRoute('?title=Заметка&text=' + encodeURIComponent('мысль & ещё одна'))
    expect(route?.startsWith('/inbox?')).toBe(true)
    expect(sharedOf(route)).toBe('Заметка\nмысль & ещё одна')
  })

  it('поделились пустым — просто входящие, нажатие не пропадает', () => {
    expect(launchRoute('?text=')).toBe('/inbox')
    expect(launchRoute('?title=%20&text=&url=')).toBe('/inbox')
  })

  it('ярлыки ведут на свои экраны; «Записать» — с курсором в поле', () => {
    expect(launchRoute('?go=inbox')).toBe('/inbox?write=1')
    expect(launchRoute('?go=time')).toBe('/time')
  })

  it('незнакомый ярлык — главный экран, а не ошибка', () => {
    expect(launchRoute('?go=review')).toBe('/')
    // Имена из прототипа объекта ярлыками не считаются.
    expect(launchRoute('?go=toString')).toBe('/')
    expect(launchRoute('?go=')).toBe('/')
  })

  it('обычный запуск и чужие параметры адрес не трогают', () => {
    expect(launchRoute('')).toBeNull()
    expect(launchRoute('?utm_source=x')).toBeNull()
  })
})

describe('ярлыки в манифесте', () => {
  const base = '/DeluVremya/'

  it('адрес каждого ярлыка разбирается обратно в свой экран', () => {
    for (const shortcut of SHORTCUTS) {
      const url = new URL(shortcutUrl(base, shortcut.go), 'https://example.com')
      expect(url.pathname, shortcut.name).toBe(base)
      const expected = shortcut.go === null ? null : GO_ROUTES[shortcut.go]
      expect(launchRoute(url.search), shortcut.name).toBe(expected)
    }
  })

  it('три ярлыка из Р-09: «Записать», «План дня», «Учесть время»', () => {
    expect(SHORTCUTS.map((shortcut) => shortcut.name)).toEqual(['Записать', 'План дня', 'Учесть время'])
  })
})
