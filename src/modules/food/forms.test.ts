import { describe, expect, it } from 'vitest'
import type { Category, Dish, Intake } from '../../app/model.ts'
import {
  amountText,
  applyDish,
  dishFacts,
  dishInput,
  intakeInput,
  readDish,
  readIntake,
  stepPortions,
} from './forms.ts'
import { RECIPE_TEMPLATE } from './recipe.ts'

const at = '2026-09-16T10:00:00.000Z'
const soups: Category = { id: 'cat:супы', updatedAt: at, name: 'Супы', order: 0 }
const gone: Category = { id: 'cat:первое', updatedAt: at, name: 'Первое', order: 1, deleted: true }
const borsch: Dish = { id: 'dish:борщ', updatedAt: at, name: 'Борщ', categoryId: soups.id, portionGrams: 300, kcal100: 49.5 }
const kissel: Dish = { id: 'dish:кисель', updatedAt: at, name: 'Кисель', archived: true }

describe('форма блюда', () => {
  it('поля блюда строками, дробные — с запятой; нового — пустые', () => {
    expect(dishInput(borsch)).toEqual({
      name: 'Борщ',
      categoryId: 'cat:супы',
      portionGrams: '300',
      kcal100: '49,5',
      kcalPortion: '',
      recipe: '',
    })
    expect(dishInput().name).toBe('')
  })

  it('разбор: запятая, пробелы, пустое поле снимает свойство', () => {
    const read = readDish(
      { name: '  Щи  ', categoryId: 'cat:супы', portionGrams: ' 350 ', kcal100: '32,5', kcalPortion: '', recipe: '' },
      [borsch],
      [soups],
    )
    expect(read).toEqual({
      changes: {
        name: 'Щи',
        categoryId: 'cat:супы',
        portionGrams: 350,
        kcal100: 32.5,
        kcalPortion: undefined,
        recipe: undefined,
      },
    })
  })

  it('название: пустое, занятое, в архиве; своё прежнее не мешает', () => {
    const input = { ...dishInput(), name: 'борщ' }
    expect(readDish({ ...input, name: ' ' }, [borsch], [])).toEqual({ problem: 'Нужно название' })
    expect(readDish(input, [borsch], [])).toEqual({ problem: 'Блюдо с таким названием уже есть' })
    expect(readDish({ ...input, name: 'Кисель' }, [kissel], [])).toMatchObject({
      problem: expect.stringContaining('в архиве'),
    })
    expect(readDish(input, [borsch], [], borsch.id)).toHaveProperty('changes')
  })

  it('кривые числа и удалённая категория — отказ с причиной', () => {
    const input = { ...dishInput(), name: 'Щи' }
    expect(readDish({ ...input, portionGrams: '0' }, [], [])).toEqual({ problem: 'Порция — число больше нуля' })
    expect(readDish({ ...input, kcal100: 'много' }, [], [])).toEqual({ problem: 'Ккал на 100 г — число не меньше нуля' })
    expect(readDish({ ...input, kcalPortion: '-1' }, [], [])).toEqual({
      problem: 'Ккал на порцию — число не меньше нуля',
    })
    expect(readDish({ ...input, categoryId: gone.id }, [], [gone])).toHaveProperty('problem')
  })

  it('правка снимает поля, а не оставляет undefined', () => {
    const next = applyDish(borsch, {
      name: 'Борщ красный',
      categoryId: undefined,
      portionGrams: 250,
      kcal100: undefined,
      kcalPortion: 60,
      recipe: undefined,
    })
    expect(next).toEqual({ id: 'dish:борщ', updatedAt: at, name: 'Борщ красный', portionGrams: 250, kcalPortion: 60 })
    expect(Object.keys(next)).not.toContain('categoryId')
  })

  it('рецепт: написанное сохраняется, пустая заготовка — нет — Р-39', () => {
    const input = { ...dishInput(), name: 'Борщ' }
    const written = readDish({ ...input, recipe: `${RECIPE_TEMPLATE.replace('Порций:', 'Порций: 6')}` }, [], [])
    expect(written).toHaveProperty('changes.recipe', expect.stringContaining('Порций: 6'))
    expect(readDish({ ...input, recipe: RECIPE_TEMPLATE }, [], [])).toHaveProperty('changes.recipe', undefined)
    const cleared = applyDish(
      { ...borsch, recipe: 'Порций: 6' },
      { name: 'Борщ', categoryId: undefined, portionGrams: undefined, kcal100: undefined, kcalPortion: undefined, recipe: undefined },
    )
    expect(Object.keys(cleared)).not.toContain('recipe')
  })

  it('строка свойств', () => {
    expect(dishFacts(borsch)).toBe('порция 300 г · 49,5 ккал/100 г')
    expect(dishFacts(kissel)).toBe('')
  })
})

describe('правка записи — Р-18', () => {
  const record: Intake = { id: 'i1', updatedAt: at, date: '2026-02-03', meal: 'lunch', dishId: 'dish:борщ' }

  it('поля строками: порций без поля — одна', () => {
    expect(intakeInput({ ...record, portions: 1.5, at: '14:00' })).toEqual({
      meal: 'lunch',
      portions: '1,5',
      grams: '',
      at: '14:00',
      note: '',
    })
    expect(intakeInput(record).portions).toBe('1')
  })

  it('шаг ½ вверх и вниз, не меньше половины; кривое — от одной', () => {
    expect(stepPortions('1', 1)).toBe('1,5')
    expect(stepPortions('1,5', -1)).toBe('1')
    expect(stepPortions('0,5', -1)).toBe('0,5')
    expect(stepPortions('0,3', 1)).toBe('0,8')
    expect(stepPortions('много', 1)).toBe('1,5')
  })

  it('одна порция и пустые поля снимаются; время приводится; заметка без пробелов', () => {
    const read = readIntake(
      { meal: 'dinner', portions: '1', grams: '', at: '9:05', note: '  в кафе ' },
      { ...record, portions: 2, grams: 300, note: 'старое' },
      [],
    )
    expect(read).toEqual({ record: { ...record, meal: 'dinner', at: '09:05', note: 'в кафе' } })
  })

  it('кривые поля и то же блюдо в приёме, куда переезжает запись, — отказ', () => {
    const input = intakeInput(record)
    expect(readIntake({ ...input, portions: '0' }, record, [])).toEqual({ problem: 'Порции — число больше нуля' })
    expect(readIntake({ ...input, grams: '-5' }, record, [])).toEqual({ problem: 'Граммы — число больше нуля' })
    expect(readIntake({ ...input, at: '25:00' }, record, [])).toEqual({ problem: 'Время — ЧЧ:ММ' })
    const twin = { ...record, id: 'i2', meal: 'dinner' as const }
    expect(readIntake({ ...input, meal: 'dinner' }, record, [record, twin])).toHaveProperty('problem')
    expect(readIntake({ ...input, meal: 'dinner' }, record, [record, { ...twin, deleted: true }])).toHaveProperty('record')
  })

  it('порция словами', () => {
    expect(amountText(record)).toBe('')
    expect(amountText({ ...record, portions: 2 })).toBe('2 порции')
    expect(amountText({ ...record, portions: 0.5 })).toBe('0,5 порции')
    expect(amountText({ ...record, portions: 5, grams: 250 })).toBe('250 г')
  })
})
