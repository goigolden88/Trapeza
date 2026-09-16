import { describe, expect, it } from 'vitest'
import { blobSha } from './github.ts'
import { buildFiles, canonical, parseFile, parseMeta, README_PATH, readmeFile, storeOf } from './layout.ts'
import { SCHEMA_VERSION, SYNCED_STORES } from './model.ts'
import type { Intake, StoreRecord, SyncedStore } from './model.ts'

/** Пустая база: все хранилища есть, записей нет. */
function empty(): { [S in SyncedStore]: StoreRecord[S][] } {
  const data = {} as { [S in SyncedStore]: StoreRecord[S][] }
  for (const store of SYNCED_STORES) Object.assign(data, { [store]: [] })
  return data
}

function withData(over: Partial<{ [S in SyncedStore]: StoreRecord[S][] }>) {
  return { ...empty(), ...over }
}

function intake(id: string, date: string, over: Partial<Intake> = {}): Intake {
  return { id, updatedAt: '2026-09-09T10:00:00.000Z', date, meal: 'lunch', dishId: 'dish:борщ', ...over }
}

function pathsOf(files: { path: string }[]): string[] {
  return files.map((file) => file.path)
}

describe('раскладка', () => {
  it('пустая база даёт справочники одним файлом и meta', () => {
    expect(pathsOf(buildFiles(empty()))).toEqual([
      'categories.json',
      'dishes.json',
      'meta.json',
      'norms.json',
      'templates.json',
    ])
  })

  it('записи еды режутся по месяцам', () => {
    const files = buildFiles(
      withData({
        intake: [
          intake('a', '2025-12-31'),
          intake('b', '2026-01-31'),
          intake('c', '2026-02-01'),
          intake('d', '2026-02-28'),
        ],
      }),
    )
    expect(pathsOf(files).filter((path) => path.startsWith('intake/'))).toEqual([
      'intake/2025-12.json',
      'intake/2026-01.json',
      'intake/2026-02.json',
    ])

    const february = files.find((file) => file.path === 'intake/2026-02.json')
    expect(JSON.parse(february?.content ?? '[]')).toHaveLength(2)
  })

  it('запись ложится в месяц дня еды, а не дня ввода', () => {
    // Ужин 31 января, записанный 2 февраля, — январский.
    const files = buildFiles(
      withData({ intake: [intake('a', '2026-01-31', { updatedAt: '2026-02-02T08:00:00.000Z' })] }),
    )
    expect(pathsOf(files)).toContain('intake/2026-01.json')
    expect(pathsOf(files)).not.toContain('intake/2026-02.json')
  })

  it('запись с испорченной датой не пропадает — уезжает в undated', () => {
    const files = buildFiles(withData({ intake: [intake('a', '2026-02-30'), intake('b', '2026-03-01')] }))
    expect(pathsOf(files)).toContain('intake/undated.json')
    expect(JSON.parse(files.find((f) => f.path === 'intake/undated.json')?.content ?? '[]'))
      .toHaveLength(1)
  })

  it('запись с датой не того вида тоже не пропадает', () => {
    const files = buildFiles(withData({ intake: [intake('a', '31.02.2026')] }))
    expect(pathsOf(files)).toContain('intake/undated.json')
  })

  it('надгробия уезжают вместе с живыми записями', () => {
    // Без них второе устройство воскресит удалённое.
    const files = buildFiles(withData({ intake: [intake('a', '2026-01-01', { deleted: true })] }))
    const content = files.find((file) => file.path === 'intake/2026-01.json')?.content ?? ''
    expect(JSON.parse(content)[0].deleted).toBe(true)
  })

  it('meta.json несёт версию схемы', () => {
    const meta = buildFiles(empty()).find((file) => file.path === 'meta.json')
    expect(parseMeta(meta?.content ?? '')).toBe(SCHEMA_VERSION)
  })
})

describe('опустевший месяц', () => {
  const before = withData({ intake: [intake('a', '2026-01-31')] })
  const after = withData({ intake: [intake('a', '2026-02-01')] })

  it('перезаписывается пустым, если файл читали на этом же проходе', () => {
    // Иначе на сервере навсегда осталась бы копия записи в старом месяце.
    const files = buildFiles(after, { merged: pathsOf(buildFiles(before)) })
    const old = files.find((file) => file.path === 'intake/2026-01.json')
    expect(JSON.parse(old?.content ?? 'null')).toEqual([])
  })

  it('нечитанные пути не трогаются', () => {
    const files = buildFiles(after)
    expect(pathsOf(files)).not.toContain('intake/2026-01.json')
  })

  it('чужие файлы в репозитории не затираются', () => {
    const files = buildFiles(after, { merged: ['README.md', '.gitignore'] })
    expect(pathsOf(files)).not.toContain('README.md')
    expect(pathsOf(files)).not.toContain('.gitignore')
  })
})

describe('канонический вид', () => {
  it('порядок ключей в записи не меняет файл', async () => {
    // Запись из формы и запись с сервера собираются по-разному. Разойдись
    // тут байты — каждая синхронизация переписывала бы весь репозиторий.
    const one = canonical([{ id: 'a', updatedAt: '2026-01-01T00:00:00.000Z', deleted: false } as never])
    const two = canonical([{ deleted: false, updatedAt: '2026-01-01T00:00:00.000Z', id: 'a' } as never])
    expect(one).toBe(two)
    expect(await blobSha(one)).toBe(await blobSha(two))
  })

  it('порядок записей на входе не меняет файл', () => {
    const a = intake('a', '2026-01-01')
    const b = intake('b', '2026-02-01')
    expect(canonical([a, b])).toBe(canonical([b, a]))
  })

  it('вложенные объекты тоже упорядочиваются', () => {
    const one = { id: 'a', updatedAt: 'x', items: [{ title: 't', estMin: 30 }] } as never
    const two = { id: 'a', updatedAt: 'x', items: [{ estMin: 30, title: 't' }] } as never
    expect(canonical([one])).toBe(canonical([two]))
  })

  it('порядок в массивах сохраняется — это данные', () => {
    const one = { id: 'a', updatedAt: 'x', refs: ['b', 'a'] } as never
    const two = { id: 'a', updatedAt: 'x', refs: ['a', 'b'] } as never
    expect(canonical([one])).not.toBe(canonical([two]))
  })

  it('файл заканчивается переводом строки', () => {
    expect(canonical([])).toBe('[]\n')
  })
})

describe('storeOf', () => {
  it('узнаёт свои файлы', () => {
    expect(storeOf('categories.json')).toBe('categories')
    expect(storeOf('dishes.json')).toBe('dishes')
    expect(storeOf('templates.json')).toBe('templates')
    expect(storeOf('norms.json')).toBe('norms')
    expect(storeOf('intake/2026-02.json')).toBe('intake')
    expect(storeOf('intake/2026-12.json')).toBe('intake')
    expect(storeOf('intake/undated.json')).toBe('intake')
  })

  it('чужие файлы не признаёт своими', () => {
    expect(storeOf('README.md')).toBeNull()
    expect(storeOf('meta.json')).toBeNull()
    expect(storeOf('intake/2026-02.txt')).toBeNull()
    expect(storeOf('intake/двадцать.json')).toBeNull()
    expect(storeOf('other/2026-02.json')).toBeNull()
    // Годовой файл раскладки «Дневников» здесь чужой (Р-28 «Делу Время»).
    expect(storeOf('intake/2026.json')).toBeNull()
    expect(storeOf('intake/2026-13.json')).toBeNull()
    expect(storeOf('intake/2026-2.json')).toBeNull()
    // Хранилища «Делу Время» здесь чужие: репозитории данных разные.
    expect(storeOf('time/2026-02.json')).toBeNull()
    expect(storeOf('notes/undated.json')).toBeNull()
  })

  it('каждый построенный файл, кроме meta, опознаётся обратно', () => {
    const files = buildFiles(withData({ intake: [intake('a', '2026-01-01'), intake('b', 'нет даты')] }))
    for (const file of files) {
      if (file.path === 'meta.json') continue
      expect(storeOf(file.path), file.path).not.toBeNull()
    }
  })
})

describe('разбор файлов с сервера', () => {
  it('читает список записей', () => {
    const records = parseFile('categories.json', '[{"id":"a","updatedAt":"2026-01-01T00:00:00.000Z"}]')
    expect(records).toHaveLength(1)
  })

  it('отвергает не JSON и не список', () => {
    expect(() => parseFile('categories.json', 'мусор')).toThrow('не JSON')
    expect(() => parseFile('categories.json', '{}')).toThrow('не список')
  })

  it('отвергает записи без id или updatedAt — на них держится слияние', () => {
    expect(() => parseFile('categories.json', '[{"id":"a"}]')).toThrow('без id или updatedAt')
    expect(() => parseFile('categories.json', '[null]')).toThrow('без id или updatedAt')
  })

  it('meta.json без версии — не наш репозиторий', () => {
    expect(parseMeta('{"schemaVersion":1}')).toBe(1)
    expect(() => parseMeta('{}')).toThrow('не репозиторий «Трапезы»')
    expect(() => parseMeta('{"schemaVersion":"1"}')).toThrow('не репозиторий «Трапезы»')
    expect(() => parseMeta('нет')).toThrow('не JSON')
  })

  it('свой же файл читается обратно', () => {
    const files = buildFiles(withData({ intake: [intake('a', '2026-01-01')] }))
    const file = files.find((each) => each.path === 'intake/2026-01.json')
    expect(parseFile(file?.path ?? '', file?.content ?? '')[0]?.id).toBe('a')
  })
})

describe('README репозитория данных (Р-69)', () => {
  it('называет каждый файл раскладки — таблица собрана из неё', () => {
    const text = readmeFile().content
    const produced = buildFiles(
      withData({
        intake: [intake('i1', '2026-03-12'), intake('i2', 'нет даты')],
      }),
    ).map((file) => file.path.replace(/\d{4}-\d{2}/, 'ГГГГ-ММ'))
    for (const path of produced) expect(text).toContain(`\`${path}\``)
  })

  it('своим файлом для разбора не считается', () => {
    expect(readmeFile().path).toBe(README_PATH)
    expect(storeOf(README_PATH)).toBeNull()
  })
})
