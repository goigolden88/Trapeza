import { describe, expect, it } from 'vitest'
import type { Dish, Intake, Template } from '../../core/model.ts'
import {
  applyTemplate,
  checkTemplateName,
  createTemplate,
  defaultTemplateName,
  intakeFrom,
  itemsForMeal,
  itemsFromRecords,
  MAX_TEMPLATE_NAME,
  moveTemplate,
  placedItems,
  templatesOf,
  templateText,
} from './templates.ts'

const at = '2026-09-16T10:00:00.000Z'

let next = 0
function eaten(meal: Intake['meal'], name: string, fields: Partial<Intake> = {}): Intake {
  next += 1
  return { id: `i${String(next).padStart(3, '0')}`, updatedAt: at, date: '2026-09-18', meal, dishId: `dish:${name}`, ...fields }
}

function template(name: string, fields: Partial<Template> = {}): Template {
  return { id: `t:${name}`, updatedAt: at, name, items: [], order: 0, ...fields }
}

const dishes = new Map<string, Dish>(
  ['каша', 'компот', 'суп', 'мясное', 'чай'].map((name) => [`dish:${name}`, { id: `dish:${name}`, updatedAt: at, name }]),
)

describe('шаблон из записанного — Р-28', () => {
  it('приёма: блюда с порциями и граммами, без времени и заметки; дубль двух устройств — один', () => {
    const records = [
      eaten('breakfast', 'каша', { portions: 1.5, at: '09:00', note: 'вкусно' }),
      eaten('breakfast', 'компот', { grams: 250 }),
      eaten('breakfast', 'каша'),
      eaten('breakfast', 'чай', { deleted: true }),
    ]
    expect(itemsFromRecords(records, false)).toEqual([
      { dishId: 'dish:каша', portions: 1.5 },
      { dishId: 'dish:компот', grams: 250 },
    ])
  })

  it('дня: приём у каждого блюда, приёмы в порядке дня; одно блюдо в двух приёмах — дважды', () => {
    const records = [eaten('dinner', 'компот'), eaten('snack', 'чай'), eaten('breakfast', 'компот'), eaten('breakfast', 'каша')]
    expect(itemsFromRecords(records, true)).toEqual([
      { meal: 'breakfast', dishId: 'dish:компот' },
      { meal: 'breakfast', dishId: 'dish:каша' },
      { meal: 'dinner', dishId: 'dish:компот' },
      { meal: 'snack', dishId: 'dish:чай' },
    ])
  })

  it('название по умолчанию', () => {
    expect(defaultTemplateName('breakfast')).toBe('Обычный завтрак')
    expect(defaultTemplateName('day')).toBe('Обычный день')
  })
})

describe('название шаблона — Р-28', () => {
  const templates = [template('Обычный завтрак', { meal: 'breakfast' }), template('Будни'), template('Старый', { deleted: true })]

  it('пустое и длинное — нельзя', () => {
    expect(checkTemplateName(templates, '  ', 'day')).toEqual({ ok: false, problem: 'empty' })
    expect(checkTemplateName(templates, 'я'.repeat(MAX_TEMPLATE_NAME + 1), 'day')).toEqual({ ok: false, problem: 'long' })
    expect(checkTemplateName(templates, 'я'.repeat(MAX_TEMPLATE_NAME), 'day')).toEqual({ ok: true })
  })

  it('занято тем же видом — можно заменить состав; другим видом — нельзя; регистр и «ё» не в счёт', () => {
    const same = checkTemplateName(templates, ' обычный  ЗАВТРАК ', 'breakfast')
    expect(same).toEqual({ ok: false, problem: 'same-kind', existing: templates[0] })
    expect(checkTemplateName(templates, 'обычный завтрак', 'lunch')).toEqual({ ok: false, problem: 'other-kind' })
    expect(checkTemplateName(templates, 'будни', 'day')).toMatchObject({ problem: 'same-kind' })
  })

  it('своё название при переименовании не занято; удалённый не занимает', () => {
    expect(checkTemplateName(templates, 'Будни', 'day', 't:Будни')).toEqual({ ok: true })
    expect(checkTemplateName(templates, 'Старый', 'day')).toEqual({ ok: true })
  })
})

describe('порядок и вид — Р-28', () => {
  const templates = [
    template('Б', { meal: 'breakfast', order: 3 }),
    template('А', { meal: 'breakfast', order: 3 }),
    template('В', { meal: 'breakfast', order: 7 }),
    template('День', { order: 0 }),
    template('Обед', { meal: 'lunch', order: 0 }),
    template('Удалён', { meal: 'breakfast', order: 1, deleted: true }),
  ]

  it('шаблоны вида — живые, по порядку, при равенстве по названию', () => {
    expect(templatesOf(templates, 'breakfast').map((each) => each.name)).toEqual(['А', 'Б', 'В'])
    expect(templatesOf(templates, 'day').map((each) => each.name)).toEqual(['День'])
  })

  it('новый — последним в своём виде; у шаблона дня нет приёма', () => {
    expect(createTemplate(templates, ' Ещё ', 'breakfast', []).order).toBe(8)
    const day = createTemplate(templates, 'Выходной', 'day', [])
    expect(day.order).toBe(1)
    expect('meal' in day).toBe(false)
    expect(createTemplate([], 'Первый', 'dinner', []).order).toBe(0)
  })

  it('сдвиг — внутри вида, порядок подряд с нуля, меняются только сдвинутые; за край — пусто', () => {
    const moved = moveTemplate(templates, 't:В', -1)
    expect(moved.map((each) => [each.name, each.order])).toEqual([
      ['А', 0],
      ['В', 1],
      ['Б', 2],
    ])
    expect(moveTemplate(templates, 't:А', -1)).toEqual([])
    expect(moveTemplate(templates, 't:День', 1)).toEqual([])
    expect(moveTemplate(templates, 't:нет', 1)).toEqual([])
  })
})

describe('применение без дублей — Р-08, Р-28', () => {
  const day = template('Обычный день', {
    items: [
      { meal: 'breakfast', dishId: 'dish:каша', portions: 2 },
      { meal: 'breakfast', dishId: 'dish:компот' },
      { meal: 'lunch', dishId: 'dish:суп' },
      { meal: 'dinner', dishId: 'dish:мясное', grams: 200 },
      { meal: 'snack', dishId: 'dish:чай' },
      { dishId: 'dish:компот' },
      { meal: 'dinner', dishId: 'dish:пропало' },
    ],
  })

  it('у шаблона дня блюдо без приёма пропускается; у шаблона приёма приём — от шаблона', () => {
    expect(placedItems(day)).toHaveLength(6)
    const breakfast = template('Завтрак', { meal: 'breakfast', items: [{ dishId: 'dish:каша', meal: 'dinner' }] })
    expect(placedItems(breakfast)).toEqual([{ meal: 'breakfast', dishId: 'dish:каша' }])
    expect(itemsForMeal(day, 'breakfast').map((each) => each.dishId)).toEqual(['dish:каша', 'dish:компот'])
  })

  it('на прошлый день — все приёмы; стоящее в приёме и пропавшее блюдо — не ставятся', () => {
    const records = [eaten('breakfast', 'компот'), eaten('lunch', 'каша'), eaten('dinner', 'мясное', { deleted: true })]
    const applied = applyTemplate(day, records, ['breakfast', 'lunch', 'dinner', 'snack'], dishes)
    expect(applied.later).toEqual([])
    expect(applied.add).toEqual([
      { meal: 'breakfast', dishId: 'dish:каша', portions: 2 },
      { meal: 'lunch', dishId: 'dish:суп' },
      { meal: 'dinner', dishId: 'dish:мясное', grams: 200 },
      { meal: 'snack', dishId: 'dish:чай' },
    ])
  })

  it('на сегодня — только разрешённые приёмы, остальные названы «на потом»', () => {
    const applied = applyTemplate(day, [], ['breakfast', 'lunch'], dishes)
    expect(applied.add.map((each) => each.meal)).toEqual(['breakfast', 'breakfast', 'lunch'])
    expect(applied.later).toEqual(['dinner', 'snack'])
  })

  it('всё уже стоит — ставить нечего, и «на потом» не зовёт то, что уже записано', () => {
    const records = [eaten('breakfast', 'каша'), eaten('breakfast', 'компот'), eaten('lunch', 'суп'), eaten('dinner', 'мясное'), eaten('snack', 'чай')]
    expect(applyTemplate(day, records, ['breakfast'], dishes)).toEqual({ add: [], later: [] })
  })

  it('записи — на день, с растущими id в порядке шаблона', () => {
    const made = intakeFrom(applyTemplate(day, [], ['breakfast', 'lunch'], dishes).add, '2026-09-18')
    expect(made.map((each) => [each.date, each.meal, each.dishId])).toEqual([
      ['2026-09-18', 'breakfast', 'dish:каша'],
      ['2026-09-18', 'breakfast', 'dish:компот'],
      ['2026-09-18', 'lunch', 'dish:суп'],
    ])
    expect([...made].sort((a, b) => a.id.localeCompare(b.id))).toEqual(made)
  })
})

describe('состав словами — Р-28', () => {
  it('приёма — блюда с порциями; дня — по приёмам в порядке дня; пропавшее блюдо названо', () => {
    const meal = template('Завтрак', { meal: 'breakfast', items: [{ dishId: 'dish:каша', portions: 2 }, { dishId: 'dish:компот' }] })
    expect(templateText(meal, dishes)).toBe('каша 2 порции, компот')
    const day = template('День', {
      items: [
        { meal: 'dinner', dishId: 'dish:мясное', grams: 200 },
        { meal: 'breakfast', dishId: 'dish:нет' },
      ],
    })
    expect(templateText(day, dishes)).toBe('Завтрак: блюдо удалено · Ужин: мясное 200 г')
  })
})
