import { describe, expect, it } from 'vitest'
import { IMPORT_FORMAT, IMPORT_VERSION, planTotal, type ImportPlan } from './core/importing.ts'
import { SYNCED_STORES } from './core/model.ts'
import { feedItems, importPrompt, KIND_ORDER, KINDS, markdownExport, planImport, type Data } from './registry.ts'

// По образцу теста реестра «Дневников» с a913dcb: пример из промпта обязан
// проходить собственную проверку — описание и разбор не могут разойтись.

const at = '2026-09-13T10:00:00.000Z'

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
      const entry = KINDS[kind].import
      if (entry) file[entry.spec.section] = entry.spec.example
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

  it('формат — свой, не «Дневников»: базы на одном origin, файлы не должны путаться', () => {
    expect(IMPORT_FORMAT).toBe('deluvremya-import')
  })

  it('промпт называет разделы, формат, сегодняшнюю дату и приложение', () => {
    const prompt = importPrompt('2026-09-13')
    expect(prompt).toContain('"notes"')
    expect(prompt).toContain('"time"')
    expect(prompt).toContain('"format": "deluvremya-import"')
    expect(prompt).toContain('13.09.2026')
    expect(prompt).toContain('«Делу Время»')
    expect(prompt).not.toContain('Дневники')
  })

  it('пример из промпта проходит собственную проверку без единого замечания', () => {
    const plan = planImport(JSON.stringify(example()), empty(), ctx())
    expect(plan.issues).toEqual([])
    expect(plan.writes.notes?.length ?? 0).toBeGreaterThan(0)
    expect(plan.writes.time?.length ?? 0).toBeGreaterThan(0)
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
      food: [],
      time: [{ date: '2026-02-03', category: 'Чтение', minutes: 30 }],
    })
    const plan = planImport(text, empty(), ctx())
    expect(plan.issues.map((issue) => issue.section)).toEqual(['food'])
    expect(plan.writes.time).toHaveLength(1)
  })

  it('копию приложения отправляет к «Восстановить из копии»', () => {
    expect(() => planImport(JSON.stringify({ schemaVersion: 1, data: {} }), empty(), ctx())).toThrow(
      'Восстановить из копии',
    )
  })

  it('не JSON и чужой JSON, в том числе файл «Дневников», — внятный отказ', () => {
    expect(() => planImport('привет', empty(), ctx())).toThrow('не JSON')
    expect(() => planImport('{"time": []}', empty(), ctx())).toThrow('deluvremya-import')
    expect(() => planImport('{"format": "dnevniki-import", "items": []}', empty(), ctx())).toThrow(
      'deluvremya-import',
    )
  })
})

describe('реестр видов записей', () => {
  it('все три вида записи на месте, в порядке модели', () => {
    expect(KIND_ORDER).toEqual(['note', 'time', 'review'])
  })

  it('подписи видов не пустые', () => {
    for (const kind of KIND_ORDER) expect(KINDS[kind].label).not.toBe('')
  })
})

describe('лента и выгрузка — Р-58…Р-60, Р-63', () => {
  function filled(): Data {
    return {
      ...empty(),
      categories: [{ id: 'cat:чтение', updatedAt: at, name: 'Чтение', order: 1, kind: 'useful' }],
      notes: [
        {
          id: 'n1',
          updatedAt: at,
          text: 'Купить фильтр',
          kind: 'task',
          capturedOn: '2026-09-10',
          plannedFor: null,
          status: 'open',
        },
      ],
      time: [{ id: 't1', updatedAt: at, date: '2026-09-10', categoryId: 'cat:чтение', minutes: 30 }],
      reviews: [{ id: 'review:2026-09-07', updatedAt: at, weekStart: '2026-09-07', doneAt: at }],
    }
  }

  it('строки ленты — от каждого вида', () => {
    const kinds = new Set(feedItems(filled(), '2026-09-14').map((item) => item.kind))
    expect([...kinds].sort()).toEqual([...KIND_ORDER].sort())
  })

  it('markdown — шапка с датой и раздел на вид в порядке реестра', () => {
    const text = markdownExport(filled(), '2026-09-14')
    expect(text.startsWith('# Делу Время\n')).toBe(true)
    expect(text).toContain('Выгрузка от 14.09.2026')
    const places = KIND_ORDER.map((kind) => text.indexOf(`\n## ${KINDS[kind].label}\n`))
    expect(places.every((place) => place > 0)).toBe(true)
    expect(places).toEqual([...places].sort((a, b) => a - b))
    expect(text).toContain('Купить фильтр')
    expect(text.endsWith('\n')).toBe(true)
  })

  it('пустая база — разделы на месте, и в каждом сказано, что записей нет', () => {
    const text = markdownExport(empty(), '2026-09-14')
    expect(text.split('Записей нет.').length - 1).toBe(KIND_ORDER.length)
  })
})

describe('markdown на выбор — Р-79', () => {
  it('без выбора — все разделы и без строк о выборке', () => {
    const md = markdownExport(empty(), '2026-09-14')
    for (const kind of KIND_ORDER) expect(md).toContain(`## ${KINDS[kind].label}`)
    expect(md).not.toContain('Разделы:')
    expect(md).not.toContain('Период:')
  })

  it('разделы и период — в шапке; не выбранный раздел не выгружается', () => {
    const md = markdownExport(empty(), '2026-09-14', {
      kinds: ['note'],
      span: { period: { from: '2026-02-01', to: '2026-02-28' }, label: 'февраль 2026' },
    })
    expect(md).toContain(`## ${KINDS.note.label}`)
    expect(md).not.toContain(`## ${KINDS.time.label}`)
    expect(md).toContain(`Разделы: ${KINDS.note.label}.`)
    expect(md).toContain('Период: февраль 2026. Записи без даты — только в выгрузке за всё время.')
  })
})
