import { describe, expect, it } from 'vitest'
import { IMPORT_VERSION, planTotal, type ImportPlan } from './shared/core/importing.ts'
import { importing } from './app/core.ts'

const IMPORT_FORMAT = importing.format
import { monthPeriod } from './shared/core/dates.ts'
import { SYNCED_STORES } from './app/model.ts'
import { feedItems, importPrompt, KIND_ORDER, KINDS, markdownExport, planImport, type Data } from './registry.ts'

// По образцу теста реестра «Делу Время» с d86f0aa, у них — «Дневников»:
// пример из промпта обязан проходить собственную проверку — описание
// и разбор не могут разойтись.

const at = '2026-09-16T10:00:00.000Z'

function empty(): Data {
  return Object.fromEntries(SYNCED_STORES.map((store) => [store, []])) as unknown as Data
}

describe('импорт записей', () => {
  let counter = 0
  const ctx = () => ({ newId: () => `n${++counter}`, now: at })

  /** Файл из примеров всех разделов — ровно то, что стоит в промпте. */
  function example(): Record<string, unknown> {
    const file: Record<string, unknown> = { format: IMPORT_FORMAT, version: IMPORT_VERSION }
    for (const kind of KIND_ORDER) {
      for (const entry of KINDS[kind].import) file[entry.spec.section] = entry.spec.example
    }
    return file
  }

  /** База после записи плана. */
  function applied(data: Data, plan: ImportPlan): Data {
    const next = { ...data } as Record<string, unknown[]>
    for (const [store, records] of Object.entries(plan.writes)) {
      next[store] = [...(next[store] ?? []), ...(records ?? [])]
    }
    return next as unknown as Data
  }

  it('формат — свой, не «Дневников» и не «Делу Время»: базы на одном origin, файлы не должны путаться', () => {
    expect(IMPORT_FORMAT).toBe('trapeza-import')
  })

  it('промпт называет разделы, формат, сегодняшнюю дату и приложение — и не говорит про минуты', () => {
    const prompt = importPrompt('2026-09-16')
    for (const section of ['"categories"', '"dishes"', '"intake"']) expect(prompt).toContain(section)
    expect(prompt).toContain('"format": "trapeza-import"')
    expect(prompt).toContain('16.09.2026')
    expect(prompt).toContain('«Трапеза»')
    expect(prompt).not.toMatch(/Дневники|Делу Время|минут/)
  })

  it('разделы в промпте — в порядке разбора: категории, блюда, записи', () => {
    const prompt = importPrompt('2026-09-16')
    const places = ['"categories" —', '"dishes" —', '"intake" —'].map((head) => prompt.indexOf(head))
    expect(places.every((place) => place > 0)).toBe(true)
    expect(places).toEqual([...places].sort((a, b) => a - b))
  })

  it('пример из промпта проходит собственную проверку без единого замечания', () => {
    const plan = planImport(JSON.stringify(example()), empty(), ctx())
    expect(plan.issues).toEqual([])
    expect(plan.writes.categories?.length ?? 0).toBeGreaterThan(0)
    expect(plan.writes.dishes?.length ?? 0).toBeGreaterThan(0)
    expect(plan.writes.intake?.length ?? 0).toBeGreaterThan(0)
  })

  it('блюдо и запись видят категорию и блюдо из того же файла — второй раз не заводятся', () => {
    const text = JSON.stringify({
      format: IMPORT_FORMAT,
      version: 1,
      // Порядок в файле обратный — разбор всё равно идёт по таблице.
      intake: [{ date: '2026-02-03', meal: 'lunch', dish: 'Борщ' }],
      dishes: [{ name: 'борщ', category: 'Супы' }],
      categories: [{ name: 'Супы', group: 'Первое' }],
    })
    const plan = planImport(text, empty(), ctx())
    expect(plan.issues).toEqual([])
    expect(plan.writes.categories).toHaveLength(1)
    expect(plan.writes.categories?.[0]).toMatchObject({ id: 'cat:супы', group: 'Первое' })
    expect(plan.writes.dishes).toHaveLength(1)
    expect(plan.writes.dishes?.[0]).toMatchObject({ id: 'dish:борщ', categoryId: 'cat:супы' })
    expect(plan.writes.intake?.[0]).toMatchObject({ dishId: 'dish:борщ' })
  })

  it('повторная загрузка того же файла ничего не удваивает', () => {
    const text = JSON.stringify(example())
    const first = planImport(text, empty(), ctx())
    const again = planImport(text, applied(empty(), first), ctx())
    expect(planTotal(again)).toBe(0)
    expect(again.skipped).toBeGreaterThan(0)
    expect(again.issues).toEqual([])
  })

  it('JSON в блоке ```json с текстом вокруг — как его отдаёт ИИ', () => {
    const text = `Вот файл:\n\`\`\`json\n${JSON.stringify(example())}\n\`\`\`\nНе разобрал: ничего.`
    expect(planImport(text, empty(), ctx()).issues).toEqual([])
  })

  it('незнакомый раздел — в отчёт, остальные разбираются', () => {
    const text = JSON.stringify({
      format: IMPORT_FORMAT,
      version: 1,
      time: [],
      intake: [{ date: '2026-02-03', meal: 'lunch', dish: 'Борщ' }],
    })
    const plan = planImport(text, empty(), ctx())
    expect(plan.issues.map((issue) => issue.section)).toEqual(['time'])
    expect(plan.writes.intake).toHaveLength(1)
  })

  it('копию приложения отправляет к «Восстановить из копии»', () => {
    expect(() => planImport(JSON.stringify({ schemaVersion: 1, data: {} }), empty(), ctx())).toThrow(
      'Восстановить из копии',
    )
  })

  it('не JSON и чужой JSON, в том числе файл «Делу Время», — внятный отказ', () => {
    expect(() => planImport('привет', empty(), ctx())).toThrow('не JSON')
    expect(() => planImport('{"intake": []}', empty(), ctx())).toThrow('trapeza-import')
    expect(() => planImport('{"format": "deluvremya-import", "time": []}', empty(), ctx())).toThrow('trapeza-import')
  })
})

describe('реестр видов записей', () => {
  it('вид записи один — intake, как в модели', () => {
    expect(KIND_ORDER).toEqual(['intake'])
  })

  it('подписи видов не пустые', () => {
    for (const kind of KIND_ORDER) expect(KINDS[kind].label).not.toBe('')
  })
})

describe('лента и markdown — Этап 5', () => {
  function withMarch(): Data {
    const data = empty()
    data.dishes.push({ id: 'dish:каша', updatedAt: at, name: 'Каша' })
    data.intake.push(
      { id: 'a', updatedAt: at, date: '2026-03-02', meal: 'breakfast', dishId: 'dish:каша' },
      { id: 'b', updatedAt: at, date: '2026-02-10', meal: 'lunch', dishId: 'dish:каша' },
    )
    return data
  }

  it('строки ленты — от всех видов, строка на день', () => {
    expect(feedItems(withMarch(), '2026-09-17').map((item) => `${item.kind}:${item.id}`).sort()).toEqual([
      'intake:day:2026-02-10',
      'intake:day:2026-03-02',
    ])
  })

  it('markdown: шапка «Трапезы», раздел на вид; период назван в шапке и отбирает дни', () => {
    const all = markdownExport(withMarch(), '2026-09-17')
    expect(all.startsWith('# Трапеза\n\nВыгрузка от 17.09.2026.')).toBe(true)
    expect(all).toContain('## Еда\n\n### Февраль 2026')
    expect(all).toContain('### Март 2026')
    expect(all).not.toContain('Период:')
    expect(all).not.toContain('Разделы:')
    expect(all.endsWith('\n')).toBe(true)

    const march = markdownExport(withMarch(), '2026-09-17', {
      span: { period: monthPeriod('2026-03'), label: 'март 2026' },
    })
    expect(march).toContain('Период: март 2026.')
    expect(march).toContain('### Март 2026')
    expect(march).not.toContain('Февраль')
  })
})
