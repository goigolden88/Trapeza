import { describe, expect, it } from 'vitest'
import { cleanRecipe, RECIPE_PARTS, RECIPE_TEMPLATE, recipePrompt } from './recipe.ts'

describe('заготовка рецепта', () => {
  it('в ней все разделы, по строке на каждый', () => {
    const lines = RECIPE_TEMPLATE.split('\n')
    for (const part of RECIPE_PARTS) expect(lines).toContain(part)
  })

  it('пустая заготовка — ещё не рецепт', () => {
    expect(cleanRecipe(RECIPE_TEMPLATE)).toBeUndefined()
  })
})

describe('текст поля → рецепт', () => {
  it('пустое поле и пробелы — рецепта нет', () => {
    expect(cleanRecipe('')).toBeUndefined()
    expect(cleanRecipe('   \n\n  ')).toBeUndefined()
  })

  it('заготовка с одним ответом — уже рецепт', () => {
    const written = RECIPE_TEMPLATE.replace('Порций:', 'Порций: 6')
    expect(cleanRecipe(written)).toContain('Порций: 6')
  })

  it('пустые строки по краям снимаются, внутри остаются', () => {
    expect(cleanRecipe('\n\nИнгредиенты\n\n- Свёкла\n\n')).toBe('Ингредиенты\n\n- Свёкла')
  })

  it('перевод строки из другой системы приводится к своему', () => {
    expect(cleanRecipe('Ингредиенты\r\n- Свёкла\r\n')).toBe('Ингредиенты\n- Свёкла')
  })

  it('хвостовые пробелы строк снимаются', () => {
    expect(cleanRecipe('- Свёкла   \n- Лук  ')).toBe('- Свёкла\n- Лук')
  })
})

describe('промпт рецепта', () => {
  it('называет блюдо и просит ответ в виде заготовки', () => {
    const prompt = recipePrompt('Борщ')
    expect(prompt).toContain('«Борщ»')
    expect(prompt).toContain(RECIPE_TEMPLATE.trimEnd())
  })

  it('просит оценку калорийности — её переносят в блюдо', () => {
    expect(recipePrompt('Борщ')).toContain('≈ N ккал на 100 г')
  })

  it('без названия — просто «блюдо»: форма ещё пустая', () => {
    expect(recipePrompt('  ')).toContain('«блюдо»')
  })
})
