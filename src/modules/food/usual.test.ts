import { describe, expect, it } from 'vitest'
import type { Dish, Intake, Template } from '../../core/model.ts'
import {
  MAIN_MEALS,
  offerText,
  readSkipped,
  skipKey,
  unansweredMeals,
  USUAL_MEALS,
  USUAL_SHARE,
  usualDishes,
  usualFoldId,
  usualOffer,
  waitingText,
  withSkipped,
} from './usual.ts'

const at = '2026-09-16T10:00:00.000Z'

let next = 0
function eaten(date: string, meal: Intake['meal'], name: string, fields: Partial<Intake> = {}): Intake {
  next += 1
  return { id: `i${String(next).padStart(4, '0')}`, updatedAt: at, date, meal, dishId: `dish:${name}`, ...fields }
}

/** День по счёту от 1 февраля 2026. */
function dayN(n: number): string {
  const date = new Date(2026, 1, 1 + n)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const dishes = new Map<string, Dish>(
  ['каша', 'компот', 'суп', 'яйца', 'мясное', 'чай'].map((name) => [`dish:${name}`, { id: `dish:${name}`, updatedAt: at, name }]),
)

describe('константы — Р-29', () => {
  it('двадцать последних приёмов, половина; основные приёмы — без перекуса', () => {
    expect(USUAL_MEALS).toBe(20)
    expect(USUAL_SHARE).toBe(0.5)
    expect(MAIN_MEALS).toEqual(['breakfast', 'lunch', 'dinner'])
  })
})

describe('обычные блюда приёма — Р-29', () => {
  it('бывшие хотя бы в половине приёмов; чаще — первым; порция — частая', () => {
    const intake: Intake[] = []
    for (let n = 0; n < 10; n++) {
      intake.push(eaten(dayN(n), 'breakfast', 'каша', n < 7 ? { portions: 2 } : {}))
      if (n < 9) intake.push(eaten(dayN(n), 'breakfast', 'компот'))
      if (n < 5) intake.push(eaten(dayN(n), 'breakfast', 'яйца'))
      if (n < 4) intake.push(eaten(dayN(n), 'breakfast', 'чай'))
      intake.push(eaten(dayN(n), 'lunch', 'суп'))
    }
    expect(usualDishes(intake, 'breakfast', dayN(20))).toEqual({
      items: [{ dishId: 'dish:каша', portions: 2 }, { dishId: 'dish:компот' }, { dishId: 'dish:яйца' }],
      meals: 10,
    })
  })

  it('только последние двадцать записанных приёмов до дня, сам день и позже — не в счёт; перерыв не обнуляет', () => {
    const intake: Intake[] = []
    for (let n = 0; n < 30; n++) intake.push(eaten(dayN(n), 'dinner', n < 10 ? 'чай' : 'мясное'))
    intake.push(eaten(dayN(200), 'dinner', 'чай'))
    intake.push(eaten(dayN(201), 'dinner', 'чай'))
    const usual = usualDishes(intake, 'dinner', dayN(200))
    expect(usual).toEqual({ items: [{ dishId: 'dish:мясное' }], meals: 20 })
  })

  it('дубль двух устройств в одном дне — один день; порция при равенстве — поздняя', () => {
    const intake = [
      eaten(dayN(0), 'lunch', 'суп', { portions: 2 }),
      eaten(dayN(0), 'lunch', 'суп', { portions: 3 }),
      eaten(dayN(1), 'lunch', 'суп', { grams: 300 }),
    ]
    expect(usualDishes(intake, 'lunch', dayN(5))).toEqual({ items: [{ dishId: 'dish:суп', grams: 300 }], meals: 2 })
  })

  it('разнобой ниже половины и пустая история — null; удалённые и кривые даты не в счёт', () => {
    const intake = [
      eaten(dayN(0), 'snack', 'чай'),
      eaten(dayN(1), 'snack', 'компот'),
      eaten(dayN(2), 'snack', 'каша'),
      eaten(dayN(3), 'snack', 'яйца', { deleted: true }),
      eaten('кривая', 'snack', 'яйца'),
    ]
    expect(usualDishes(intake, 'snack', dayN(5))).toBeNull()
    expect(usualDishes([], 'breakfast', dayN(5))).toBeNull()
  })
})

describe('что предложить — Р-29', () => {
  const history = [eaten(dayN(0), 'breakfast', 'каша'), eaten(dayN(1), 'breakfast', 'каша')]
  const mealTemplate: Template = {
    id: 't1',
    updatedAt: at,
    name: 'Обычный завтрак',
    meal: 'breakfast',
    items: [{ dishId: 'dish:яйца', portions: 2 }],
    order: 0,
  }
  const dayTemplate: Template = {
    id: 't2',
    updatedAt: at,
    name: 'Обычный день',
    items: [
      { meal: 'breakfast', dishId: 'dish:чай' },
      { meal: 'lunch', dishId: 'dish:суп' },
    ],
    order: 0,
  }

  it('шаблон приёма — первым', () => {
    expect(usualOffer('breakfast', dayN(5), [dayTemplate, mealTemplate], history, dishes)).toEqual({
      items: [{ dishId: 'dish:яйца', portions: 2 }],
      source: { kind: 'template', name: 'Обычный завтрак' },
    })
  })

  it('нет шаблона приёма — приём из шаблона дня; в шаблоне дня приёма нет — обычные блюда', () => {
    expect(usualOffer('breakfast', dayN(5), [dayTemplate], history, dishes)).toEqual({
      items: [{ dishId: 'dish:чай' }],
      source: { kind: 'day', name: 'Обычный день' },
    })
    expect(usualOffer('dinner', dayN(5), [dayTemplate], [eaten(dayN(0), 'dinner', 'мясное')], dishes)).toEqual({
      items: [{ dishId: 'dish:мясное' }],
      source: { kind: 'usual', meals: 1 },
    })
  })

  it('шаблон из пропавших блюд — дальше по порядку; нечего — null', () => {
    const gone: Template = { ...mealTemplate, items: [{ dishId: 'dish:нет' }] }
    expect(usualOffer('breakfast', dayN(5), [gone], history, dishes)?.source).toEqual({ kind: 'usual', meals: 2 })
    expect(usualOffer('lunch', dayN(5), [], history, dishes)).toBeNull()
  })
})

describe('о каких приёмах спросить — Р-29', () => {
  const today = '2026-09-18'
  const yesterday = '2026-09-17'

  it('вчера — три основных без записей; сегодня — до текущего; перекус никогда', () => {
    const intake = [eaten(yesterday, 'lunch', 'суп'), eaten(yesterday, 'snack', 'чай'), eaten(today, 'lunch', 'суп')]
    expect(unansweredMeals(intake, today, 'dinner', [])).toEqual([
      { date: yesterday, meal: 'breakfast' },
      { date: yesterday, meal: 'dinner' },
      { date: today, meal: 'breakfast' },
    ])
    expect(unansweredMeals(intake, today, 'breakfast', [])).toEqual([
      { date: yesterday, meal: 'breakfast' },
      { date: yesterday, meal: 'dinner' },
    ])
  })

  it('«Не было» — не спрашивается; удалённая запись — не запись', () => {
    const intake = [eaten(yesterday, 'breakfast', 'каша', { deleted: true })]
    const skipped = [skipKey(yesterday, 'lunch'), skipKey(yesterday, 'dinner'), skipKey(today, 'breakfast')]
    expect(unansweredMeals(intake, today, 'lunch', skipped)).toEqual([{ date: yesterday, meal: 'breakfast' }])
  })
})

describe('отметки «Не было» — Р-29', () => {
  const today = '2026-09-18'

  it('только за сегодня и вчера, без повторов и мусора', () => {
    const stored = ['2026-09-18:lunch', '2026-09-16:lunch', '2026-09-17:dinner', '2026-09-17:dinner', 5, '2026-09-18:полдник']
    expect(readSkipped(stored, today)).toEqual(['2026-09-18:lunch', '2026-09-17:dinner'])
    expect(readSkipped('мусор', today)).toEqual([])
  })

  it('новая отметка дописывается, старое отбрасывается', () => {
    expect(withSkipped(['2026-09-16:lunch', '2026-09-17:lunch'], today, today, 'breakfast')).toEqual([
      '2026-09-17:lunch',
      '2026-09-18:breakfast',
    ])
    expect(withSkipped(undefined, today, today, 'breakfast')).toEqual(['2026-09-18:breakfast'])
  })
})

describe('кнопка предложения — Р-29', () => {
  it('обычные блюда — с основанием и склонением; шаблон — названием; порции названы', () => {
    const usual = { items: [{ dishId: 'dish:каша', portions: 2 }, { dishId: 'dish:компот' }], source: { kind: 'usual', meals: 20 } } as const
    expect(offerText({ ...usual, items: [...usual.items] }, 'breakfast', dishes)).toBe('Как обычно: каша 2 порции, компот — по 20 завтракам')
    expect(offerText({ items: [{ dishId: 'dish:суп' }], source: { kind: 'usual', meals: 21 } }, 'lunch', dishes)).toBe('Как обычно: суп — по 21 обеду')
    expect(offerText({ items: [{ dishId: 'dish:мясное', grams: 200 }], source: { kind: 'day', name: 'Будни' } }, 'dinner', dishes)).toBe('«Будни»: мясное 200 г')
  })
})

describe('сворачивание «Как обычно?» — Р-31, Р-32', () => {
  it('ключ — с датой: свёрнутое сегодня не прячет завтрашние вопросы', () => {
    expect(usualFoldId('2026-09-18')).toBe('today:usual:2026-09-18')
    expect(usualFoldId('2026-09-19')).not.toBe(usualFoldId('2026-09-18'))
  })

  it('у заголовка — сколько приёмов ждут ответа, со склонением', () => {
    expect(waitingText(1)).toBe('1 приём')
    expect(waitingText(3)).toBe('3 приёма')
    expect(waitingText(5)).toBe('5 приёмов')
  })
})
