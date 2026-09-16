import { describe, expect, it } from 'vitest'
import type { Category, Dish, Intake } from '../../core/model.ts'
import { importCategories, importDishes, importIntake, mealOf, timeOf, type FoodData } from './import.ts'

const now = '2026-09-16T10:00:00.000Z'
const at = '2026-09-01T10:00:00.000Z'

function context() {
  let next = 0
  return { newId: () => `n${++next}`, now }
}

function base(fields: Partial<FoodData> = {}): FoodData {
  return { categories: [], dishes: [], intake: [], ...fields }
}

const soups: Category = { id: 'cat:супы', updatedAt: at, name: 'Супы', order: 0 }
const borsch: Dish = { id: 'dish:борщ', updatedAt: at, name: 'Борщ', categoryId: soups.id }

describe('раздел categories', () => {
  it('заводит по порядку файла с группой; уже имеющиеся и повтор в файле — пропуск', () => {
    const plan = importCategories(
      [{ name: 'Каши', group: 'Крупы' }, { name: 'супы' }, { name: ' Салаты ' }, { name: 'КАШИ' }],
      base({ categories: [soups] }),
      context(),
    )
    expect(plan.writes.categories).toEqual([
      { id: 'cat:каши', updatedAt: now, name: 'Каши', order: 1, group: 'Крупы' },
      { id: 'cat:салаты', updatedAt: now, name: 'Салаты', order: 2 },
    ])
    expect(plan.skipped).toBe(2)
    expect(plan.issues).toEqual([])
    expect(plan.added).toEqual([{ count: 2, forms: ['категория', 'категории', 'категорий'] }])
  })

  it('без названия и кривая группа — в отчёт', () => {
    const plan = importCategories([{ group: 'Крупы' }, { name: 'Каши', group: 5 }, 'Супы'], base(), context())
    expect(plan.issues.map((issue) => issue.reason)).toEqual([
      'не объект с полями',
      'нет названия ("name")',
      'группа «5» — не текст',
    ])
    expect(plan.writes.categories).toEqual([])
  })

  it('надгробие с тем же названием оживает с тем же id', () => {
    const plan = importCategories([{ name: 'Супы' }], base({ categories: [{ ...soups, deleted: true }] }), context())
    expect(plan.writes.categories?.[0]?.id).toBe('cat:супы')
  })
})

describe('раздел dishes', () => {
  it('блюдо с числами и категорией; недостающая категория заводится один раз', () => {
    const plan = importDishes(
      [
        { name: 'Щи', category: 'Супы', portionGrams: '300', kcal100: '45,5' },
        { name: 'Сырок', category: 'Сладости', kcalPortion: 150 },
        { name: 'Пастила', category: 'сладости' },
        { name: 'борщ', kcal100: 60 },
      ],
      base({ categories: [soups], dishes: [borsch] }),
      context(),
    )
    expect(plan.issues).toEqual([])
    expect(plan.skipped).toBe(1)
    expect(plan.writes.categories?.map((each) => each.id)).toEqual(['cat:сладости'])
    expect(plan.writes.dishes).toEqual([
      { id: 'dish:щи', updatedAt: now, name: 'Щи', categoryId: 'cat:супы', portionGrams: 300, kcal100: 45.5 },
      { id: 'dish:сырок', updatedAt: now, name: 'Сырок', categoryId: 'cat:сладости', kcalPortion: 150 },
      { id: 'dish:пастила', updatedAt: now, name: 'Пастила', categoryId: 'cat:сладости' },
    ])
  })

  it('кривые числа — в отчёт, и категория ради кривого блюда не заводится', () => {
    const plan = importDishes(
      [
        { name: 'Щи', category: 'Первое', portionGrams: 0 },
        { name: 'Каша', kcal100: -5 },
        { name: 'Чай', kcalPortion: 'много' },
        { category: 'Супы' },
      ],
      base(),
      context(),
    )
    expect(plan.issues.map((issue) => `${issue.title}: ${issue.reason}`)).toEqual([
      'Щи: порция «0» — не граммы больше нуля',
      'Каша: ккал на 100 г «-5» — не число',
      'Чай: ккал на порцию «много» — не число',
      'блюдо 4: нет названия ("name")',
    ])
    expect(plan.writes.categories).toEqual([])
    expect(plan.writes.dishes).toEqual([])
  })
})

describe('раздел intake', () => {
  it('запись со всеми полями; недостающее блюдо заводится без категории', () => {
    const plan = importIntake(
      [
        { date: '2026-02-03', meal: 'lunch', dish: 'борщ', portions: 2, grams: '350', at: '9:05', note: ' в кафе ' },
        { date: '2026-02-03', meal: 'Перекус', dish: 'Яблоко' },
      ],
      base({ dishes: [borsch] }),
      context(),
    )
    expect(plan.issues).toEqual([])
    expect(plan.writes.intake).toEqual([
      {
        id: 'n1',
        updatedAt: now,
        date: '2026-02-03',
        meal: 'lunch',
        dishId: 'dish:борщ',
        portions: 2,
        grams: 350,
        at: '09:05',
        note: 'в кафе',
      },
      { id: 'n3', updatedAt: now, date: '2026-02-03', meal: 'snack', dishId: 'dish:яблоко' },
    ])
    expect(plan.writes.dishes).toEqual([{ id: 'dish:яблоко', updatedAt: now, name: 'Яблоко' }])
  })

  it('уже есть по дате, приёму и блюду — пропуск; повтор внутри файла — в отчёт, а не молча', () => {
    const existing: Intake = { id: 'i1', updatedAt: at, date: '2026-02-03', meal: 'lunch', dishId: borsch.id }
    const plan = importIntake(
      [
        { date: '2026-02-03', meal: 'lunch', dish: 'Борщ' },
        { date: '2026-02-03', meal: 'dinner', dish: 'Борщ' },
        { date: '2026-02-03', meal: 'dinner', dish: 'борщ', portions: 2 },
      ],
      base({ dishes: [borsch], intake: [existing, { ...existing, id: 'i0', meal: 'dinner', deleted: true }] }),
      context(),
    )
    expect(plan.skipped).toBe(1)
    expect(plan.writes.intake?.map((each) => each.meal)).toEqual(['dinner'])
    expect(plan.issues.map((issue) => issue.title)).toEqual(['борщ, 2026-02-03, ужин'])
    expect(plan.issues[0]?.reason).toContain('"portions"')
  })

  it('кривые поля — в отчёт с причиной, блюдо ради кривой записи не заводится', () => {
    const plan = importIntake(
      [
        { meal: 'lunch', dish: 'Щи' },
        { date: '03.02.2026', meal: 'lunch', dish: 'Щи' },
        { date: '2026-09-17', meal: 'lunch', dish: 'Щи' },
        { date: '2026-02-03', meal: 'полдник', dish: 'Щи' },
        { date: '2026-02-03', meal: 'lunch' },
        { date: '2026-02-03', meal: 'lunch', dish: 'Щи', portions: 0 },
        { date: '2026-02-03', meal: 'lunch', dish: 'Щи', at: '25:00' },
      ],
      base(),
      context(),
    )
    expect(plan.issues.map((issue) => issue.reason)).toEqual([
      'нет дня ("date")',
      'день «03.02.2026» — не ГГГГ-ММ-ДД',
      'день 2026-09-17 ещё не наступил — учёт про то, что было',
      'приём «полдник» — не из breakfast, lunch, dinner, snack',
      'нет блюда ("dish")',
      'порции «0» — не число больше нуля',
      'время «25:00» — не ЧЧ:ММ',
    ])
    expect(plan.writes.dishes).toEqual([])
    expect(plan.writes.intake).toEqual([])
  })
})

describe('поля', () => {
  it('приём — код или название по-русски', () => {
    expect(mealOf('dinner')).toBe('dinner')
    expect(mealOf(' Завтрак ')).toBe('breakfast')
    expect(mealOf('полдник')).toBeNull()
    expect(mealOf(3)).toBeNull()
  })

  it('время — ЧЧ:ММ с ведущим нулём', () => {
    expect(timeOf('8:30')).toBe('08:30')
    expect(timeOf('23:59')).toBe('23:59')
    expect(timeOf('24:00')).toBeNull()
    expect(timeOf('8.30')).toBeNull()
  })
})
