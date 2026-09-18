import { describe, expect, it } from 'vitest'
import { addDays, type DateStr } from '../../shared/core/dates.ts'
import type { Category, Dish, Intake, Norm } from '../../app/model.ts'
import { normCheckText, normHistoryText, normRuleText, touchText } from './labels.ts'
import {
  activeNorms,
  applyNorm,
  checkWeek,
  createNorm,
  indexDays,
  moveNorm,
  normHistory,
  normInput,
  NORM_MIN_WEEKS,
  readNorm,
  touchedNorms,
  verdictOf,
  type NormInput,
} from './norms.ts'

const at = '2026-09-17T10:00:00.000Z'
// Понедельник: неделя 2–8 февраля 2026.
const MON = '2026-02-02'

const dishes = new Map<string, Dish>(
  (
    [
      { id: 'dish:Торт', updatedAt: at, name: 'Торт', categoryId: 'cat:Сладости' },
      { id: 'dish:Лимонад', updatedAt: at, name: 'Лимонад', categoryId: 'cat:Сладкие напитки' },
      { id: 'dish:Гречка', updatedAt: at, name: 'Гречка', categoryId: 'cat:Каши' },
      { id: 'dish:Сырок', updatedAt: at, name: 'Сырок' },
    ] satisfies Dish[]
  ).map((dish) => [dish.id, dish]),
)

let next = 0
function eaten(date: DateStr, dish: string, fields: Partial<Intake> = {}): Intake {
  next += 1
  return { id: `i${String(next).padStart(4, '0')}`, updatedAt: at, date, meal: 'lunch', dishId: `dish:${dish}`, ...fields }
}

function norm(fields: Partial<Norm> = {}): Norm {
  return { id: 'n1', updatedAt: at, name: 'Сладкое', categoryIds: ['cat:Сладости', 'cat:Сладкие напитки'], order: 0, ...fields }
}

/** Неделя с понедельника `monday`: в каждый из `logged` дней — гречка, в первые `sweet` из них — ещё и сладкое. */
function week(monday: DateStr, logged: number, sweet: number): Intake[] {
  return Array.from({ length: logged }, (_, index) => {
    const day = addDays(monday, index)
    return index < sweet ? [eaten(day, 'Гречка'), eaten(day, index % 2 ? 'Лимонад' : 'Торт')] : [eaten(day, 'Гречка')]
  }).flat()
}

describe('итог недели — Р-24', () => {
  it('«не больше»: провалена, если уже больше; выполнена, если и с неизвестными не больше', () => {
    expect(verdictOf({ maxDays: 4 }, 5, 0)).toBe('failed')
    expect(verdictOf({ maxDays: 4 }, 5, 2)).toBe('failed')
    expect(verdictOf({ maxDays: 4 }, 3, 1)).toBe('met')
    expect(verdictOf({ maxDays: 4 }, 3, 2)).toBe('open')
    expect(verdictOf({ maxDays: 0 }, 0, 0)).toBe('met')
    expect(verdictOf({ maxDays: 0 }, 0, 7)).toBe('open')
  })

  it('«не меньше»: выполнена, если набрано; провалена, если не набрать и с неизвестными', () => {
    expect(verdictOf({ minDays: 5 }, 5, 2)).toBe('met')
    expect(verdictOf({ minDays: 5 }, 2, 2)).toBe('failed')
    expect(verdictOf({ minDays: 5 }, 3, 2)).toBe('open')
    expect(verdictOf({ minDays: 1 }, 0, 7)).toBe('open')
  })

  it('оба правила: одно провалено — провалена; оба выполнены — выполнена; иначе не ясна', () => {
    expect(verdictOf({ minDays: 3, maxDays: 5 }, 6, 0)).toBe('failed')
    expect(verdictOf({ minDays: 3, maxDays: 5 }, 1, 1)).toBe('failed')
    expect(verdictOf({ minDays: 3, maxDays: 5 }, 4, 1)).toBe('met')
    expect(verdictOf({ minDays: 3, maxDays: 5 }, 4, 2)).toBe('open')
    expect(verdictOf({}, 4, 0)).toBe('open')
  })

  it('«раз» — день: два сладких в один день — один; любая категория нормы; день без записей — неизвестен', () => {
    const intake = [
      eaten(MON, 'Торт'),
      eaten(MON, 'Лимонад'),
      eaten(addDays(MON, 1), 'Лимонад'),
      eaten(addDays(MON, 2), 'Сырок'),
      eaten(addDays(MON, 3), 'Торт', { deleted: true }),
      eaten('кривая', 'Торт'),
    ]
    const check = checkWeek(norm({ maxDays: 4 }), indexDays(intake, dishes), addDays(MON, 5))
    expect(check).toEqual({ week: { from: MON, to: addDays(MON, 6) }, days: 2, unknown: 4, verdict: 'open' })
  })

  it('категория блюда в архиве считается: записи настоящие (Р-25)', () => {
    const archived = new Map(dishes)
    archived.set('dish:Торт', { id: 'dish:Торт', updatedAt: at, name: 'Торт', categoryId: 'cat:Сладости', archived: true })
    expect(checkWeek(norm(), indexDays([eaten(MON, 'Торт')], archived), MON).days).toBe(1)
  })
})

describe('история нормы — Р-13, Р-24', () => {
  // Шесть полных недель учёта, как февраль–март таблицы, потом полгода пусто.
  const monday = (index: number) => addDays(MON, 7 * index)
  const intake = [
    eaten(addDays(MON, -1), 'Гречка'), // воскресенье до первой полной недели
    ...week(monday(0), 7, 2),
    ...week(monday(1), 7, 5),
    ...week(monday(2), 7, 3),
    ...week(monday(3), 7, 4),
    ...week(monday(4), 7, 1),
    ...week(monday(5), 7, 6),
    ...week(monday(6), 4, 2), // 16–19 марта: учёт в четырёх днях
  ]
  const index = indexDays(intake, dishes)
  const today = '2026-09-17'

  it('в счёт — закончившиеся недели с ясным исходом; пустые не называются; неясные — числом', () => {
    const history = normHistory(norm({ maxDays: 4 }), index, today, today)
    expect(history.weeks.map((each) => each.week.from)).toEqual([0, 1, 2, 3, 4, 5].map(monday))
    expect(history.weeks.map((each) => each.verdict)).toEqual(['met', 'failed', 'met', 'met', 'met', 'failed'])
    expect(history.kept).toBe(4)
    // 26 января — 1 февраля и 16–22 марта: записи есть, исход зависит от пробелов.
    expect(history.open).toBe(2)
    expect(history.enough).toBe(true)
    expect(history.since).toBeNull()
  })

  it('«не меньше»: пустые недели после марта не проваливают норму', () => {
    const history = normHistory(norm({ name: 'Каши', categoryIds: ['cat:Каши'], minDays: 5 }), index, today, today)
    expect(history.weeks).toHaveLength(6)
    expect(history.kept).toBe(6)
    expect(history.open).toBe(2)
  })

  it('до недели показанного дня включительно, и только закончившиеся', () => {
    // Показана неделя monday(2), сегодня — её воскресенье: она ещё идёт.
    const sunday = addDays(monday(2), 6)
    const history = normHistory(norm({ maxDays: 4 }), index, monday(2), sunday)
    expect(history.weeks.map((each) => each.week.from)).toEqual([monday(0), monday(1)])
    expect(history.enough).toBe(false)
    expect(normHistory(norm({ maxDays: 4 }), index, monday(2), addDays(sunday, 1)).weeks).toHaveLength(3)
  })

  it('`since` — с понедельника не раньше него; раньше первой записи — с первой недели', () => {
    const fromWednesday = normHistory(norm({ maxDays: 4, since: addDays(monday(1), 2) }), index, today, today)
    expect(fromWednesday.weeks[0]?.week.from).toBe(monday(2))
    expect(fromWednesday.open).toBe(1)
    const fromMonday = normHistory(norm({ maxDays: 4, since: monday(1) }), index, today, today)
    expect(fromMonday.weeks[0]?.week.from).toBe(monday(1))
    const early = normHistory(norm({ maxDays: 4, since: '2025-01-01' }), index, today, today)
    expect(early.weeks).toHaveLength(6)
    expect(early.open).toBe(2)
    expect(early.since).toBe('2025-01-01')
  })

  it('записей нет — истории нет', () => {
    expect(normHistory(norm({ maxDays: 4 }), indexDays([], dishes), today, today)).toEqual({
      since: null,
      weeks: [],
      kept: 0,
      open: 0,
      enough: false,
    })
  })
})

describe('отклик после записи — Р-25', () => {
  const norms = [
    norm({ maxDays: 4 }),
    norm({ id: 'n2', name: 'Каши', categoryIds: ['cat:Каши'], minDays: 5, order: 1 }),
    norm({ id: 'n3', name: 'Старая', deleted: true }),
  ]

  it('задетые — нормы с категорией блюда; день уже в счёте — сказано', () => {
    const before = [eaten(MON, 'Торт'), eaten(addDays(MON, 1), 'Гречка')]
    const first = touchedNorms(norms, before, dishes, eaten(addDays(MON, 1), 'Лимонад'))
    expect(first.map((each) => [each.norm.id, each.check.days, each.already])).toEqual([['n1', 2, false]])
    const again = touchedNorms(norms, before, dishes, eaten(MON, 'Лимонад'))
    expect(again.map((each) => [each.norm.id, each.check.days, each.already])).toEqual([['n1', 1, true]])
    expect(touchedNorms(norms, before, dishes, eaten(MON, 'Сырок'))).toEqual([])
  })

  it('прибавка порции к той же записи — тот же id, день уже в счёте', () => {
    const cake = eaten(MON, 'Торт')
    const touch = touchedNorms(norms, [cake], dishes, { ...cake, portions: 2 })
    expect(touch.map((each) => [each.check.days, each.already])).toEqual([[1, true]])
  })

  it('строка — без оценки', () => {
    const [touch] = touchedNorms(norms, [eaten(MON, 'Торт')], dishes, eaten(MON, 'Лимонад'))
    expect(touch && touchText(touch)).toBe('Сладкое: 1 день при пределе 4 — день уже в счёте')
  })
})

describe('тексты норм — Р-23', () => {
  it('правило', () => {
    expect(normRuleText({ minDays: 5 })).toBe('не меньше 5 дней')
    expect(normRuleText({ minDays: 1 })).toBe('не меньше 1 дня')
    expect(normRuleText({ maxDays: 0 })).toBe('не больше 0 дней')
    expect(normRuleText({ minDays: 3, maxDays: 6 })).toBe('от 3 до 6 дней')
  })

  it('итог недели: ✓ только у ясно выполненной; превышение — числом', () => {
    expect(normCheckText({ minDays: 5 }, { days: 3, verdict: 'open' })).toBe('3 из 5 дней')
    expect(normCheckText({ minDays: 5 }, { days: 5, verdict: 'met' })).toBe('5 из 5 дней ✓')
    expect(normCheckText({ maxDays: 4 }, { days: 5, verdict: 'failed' })).toBe('5 дней при пределе 4')
    expect(normCheckText({ maxDays: 4 }, { days: 1, verdict: 'met' })).toBe('1 день при пределе 4 ✓')
    expect(normCheckText({ minDays: 3, maxDays: 6 }, { days: 4, verdict: 'open' })).toBe('4 дня при норме от 3 до 6 дней')
  })

  it('история: мало недель — сколько набралось; хватает — «выполнена в N из M»', () => {
    const check = { week: { from: MON, to: addDays(MON, 6) }, days: 1, unknown: 0, verdict: 'met' as const }
    expect(normHistoryText({ since: null, weeks: [check], kept: 1, open: 0, enough: false })).toBe(
      `история — с ${NORM_MIN_WEEKS} недель в счёт, пока 1`,
    )
    expect(
      normHistoryText({ since: '2026-02-02', weeks: [check, check, check], kept: 2, open: 1, enough: true }),
    ).toBe('с 2 февраля 2026 · выполнена в 2 из 3 недель · 1 неделя не ясна')
  })
})

describe('форма нормы', () => {
  const categories: Category[] = [
    { id: 'cat:Сладкие напитки', updatedAt: at, name: 'Сладкие напитки', order: 5 },
    { id: 'cat:Сладости', updatedAt: at, name: 'Сладости', order: 2 },
    { id: 'cat:Старое', updatedAt: at, name: 'Старое', order: 1, deleted: true },
  ]
  const input = (fields: Partial<NormInput>): NormInput => ({
    name: ' Сладкое ',
    categoryIds: ['cat:Сладкие напитки', 'cat:Сладости'],
    minDays: '',
    maxDays: '4',
    since: '',
    ...fields,
  })
  const today = '2026-09-17'

  it('пустое снимает правило; категории — в порядке справочника', () => {
    expect(readNorm(input({}), categories, today)).toEqual({
      changes: {
        name: 'Сладкое',
        categoryIds: ['cat:Сладости', 'cat:Сладкие напитки'],
        minDays: undefined,
        maxDays: 4,
        since: undefined,
      },
    })
  })

  it('кривое — причина', () => {
    const problem = (fields: Partial<NormInput>) => {
      const read = readNorm(input(fields), categories, today)
      return 'problem' in read ? read.problem : null
    }
    expect(problem({ name: '  ' })).toBe('Нужно название')
    expect(problem({ categoryIds: [] })).toBe('Отметьте хотя бы одну категорию')
    expect(problem({ categoryIds: ['cat:Старое'] })).toBe('Одной из отмеченных категорий больше нет — снимите её')
    expect(problem({ maxDays: '' })).toBe('Нужно правило: «не меньше» или «не больше»')
    expect(problem({ maxDays: '7' })).toMatch(/^«Не больше» — целое число дней/)
    expect(problem({ maxDays: '2,5' })).toMatch(/^«Не больше» — целое число дней/)
    expect(problem({ minDays: '0' })).toMatch(/^«Не меньше» — целое число дней/)
    expect(problem({ minDays: '8' })).toMatch(/^«Не меньше» — целое число дней/)
    expect(problem({ minDays: '5' })).toBe('«Не меньше» больше, чем «не больше»')
    expect(problem({ maxDays: '0' })).toBeNull()
    expect(problem({ since: '2026-09-18' })).toBe('«С какого дня» — прошедший день или пусто')
    expect(problem({ since: '17.09.2026' })).toBe('«С какого дня» — прошедший день или пусто')
    expect(problem({ since: today })).toBeNull()
  })

  it('правка снимает поля и не трогает незнакомые; новая — последней', () => {
    const old = { ...norm({ minDays: 1, maxDays: 4, since: MON }), extra: 'поле новой версии' } as Norm
    const changes = { name: 'Сладкое', categoryIds: ['cat:Сладости'], minDays: undefined, maxDays: 3, since: undefined }
    expect(applyNorm(old, changes, 'later')).toEqual({
      id: 'n1',
      updatedAt: 'later',
      name: 'Сладкое',
      categoryIds: ['cat:Сладости'],
      maxDays: 3,
      order: 0,
      extra: 'поле новой версии',
    })
    expect(normInput(old)).toEqual({
      name: 'Сладкое',
      categoryIds: ['cat:Сладости', 'cat:Сладкие напитки'],
      minDays: '1',
      maxDays: '4',
      since: MON,
    })
    const made = createNorm([old, norm({ id: 'n9', order: 7, deleted: true })], changes, 'n2', 'now')
    expect(made).toEqual({ id: 'n2', updatedAt: 'now', name: 'Сладкое', categoryIds: ['cat:Сладости'], maxDays: 3, order: 1 })
    expect(activeNorms([made, old, norm({ id: 'n9', deleted: true })]).map((each) => each.id)).toEqual(['n1', 'n2'])
  })
})

describe('ручной порядок норм — Р-27', () => {
  const norms = [
    norm({ id: 'a', name: 'А', order: 4 }),
    norm({ id: 'b', name: 'Б', order: 4 }),
    norm({ id: 'x', name: 'Удалена', order: 5, deleted: true }),
    norm({ id: 'c', name: 'В', order: 9 }),
  ]

  it('сдвиг меняет соседей, порядок живых подряд с нуля, меняются только сдвинутые', () => {
    expect(moveNorm(norms, 'c', -1).map((each) => [each.id, each.order])).toEqual([
      ['a', 0],
      ['c', 1],
      ['b', 2],
    ])
    const once = norms.map((each) => ({ ...each, order: ['a', 'b', 'x', 'c'].indexOf(each.id) - (each.id === 'c' ? 1 : 0) }))
    expect(moveNorm(once, 'a', 1).map((each) => [each.id, each.order])).toEqual([
      ['b', 0],
      ['a', 1],
    ])
  })

  it('за край, удалённая и неизвестная — пусто', () => {
    expect(moveNorm(norms, 'a', -1)).toEqual([])
    expect(moveNorm(norms, 'c', 1)).toEqual([])
    expect(moveNorm(norms, 'x', 1)).toEqual([])
    expect(moveNorm(norms, 'нет', 1)).toEqual([])
  })
})
