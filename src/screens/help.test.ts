import { describe, expect, it } from 'vitest'
import help from './Help.tsx?raw'
import welcome from './Welcome.tsx?raw'

/**
 * Строки исходника, где число вписано цифрой. Импорты, комментарии и имена
 * тегов не в счёт: в комментариях — номера решений, в `<h1>` — разметка,
 * а не текст для человека.
 *
 * Сторож взят из «Дневников»: справка и приветствие собирают числа
 * из констант кода (Р-64, правило в CLAUDE.md).
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
