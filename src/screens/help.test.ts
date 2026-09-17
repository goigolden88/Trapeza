import { describe, expect, it } from 'vitest'
import { hourText, monthsText, shareText } from '../modules/food/labels.ts'
import help from './Help.tsx?raw'
import welcome from './Welcome.tsx?raw'

/**
 * Строки исходника, где число вписано цифрой. Импорты, комментарии и имена
 * тегов не в счёт: в комментариях — номера решений, в `<h1>` — разметка,
 * а не текст для человека.
 *
 * Сторож взят из «Делу Время» с d86f0aa, у них — из «Дневников»: справка
 * и приветствие собирают числа из констант кода (CLAUDE.md, «Правила
 * интерфейса»).
 */
function typedNumbers(source: string): string[] {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(import\b|\/\/)/.test(line))
    .filter((line) => /\d/.test(line.replace(/<\/?[A-Za-z][A-Za-z0-9]*/g, '')))
    .map((line) => line.trim())
}

describe('справка и приветствие — числа только из констант', () => {
  it.each([
    ['Help.tsx', help],
    ['Welcome.tsx', welcome],
  ])('в %s ни одна цифра не вписана руками', (_name, source) => {
    expect(typedNumbers(source)).toEqual([])
  })

  it('сторож ловит вписанное число и не трогает комментарии и импорты', () => {
    const sample = [
      "import { A1 } from './x.ts'",
      '/* Р-13 */',
      '// Р-16',
      '<h2>Справка</h2>',
      '<p>через 5 секунд</p>',
      '<p>через {timeSpan(QUIET_MS)}</p>',
    ].join('\n')
    expect(typedNumbers(sample)).toEqual(['<p>через 5 секунд</p>'])
  })
})

describe('тексты констант для справки', () => {
  it('час, доля и месяцы — словами по-русски', () => {
    expect(hourText(13)).toBe('13:00')
    expect(hourText(9)).toBe('09:00')
    expect(shareText(0.5)).toBe('половине')
    expect(shareText(0.4)).toBe('40 %')
    expect(monthsText(1)).toBe('месяц')
    expect(monthsText(2)).toBe('2 месяца')
    expect(monthsText(5)).toBe('5 месяцев')
  })
})
