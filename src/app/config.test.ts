import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDb } from '../shared/core/db.ts'
import { createLayout } from '../shared/core/layout.ts'
import { LOCAL_STORES } from '../shared/core/model.ts'
import { buildSummary, checkSummary } from '../shared/core/summary.ts'
import { summary } from '../modules/food/digest.ts'
import { config } from './config.ts'
import { SCHEMA_VERSION, SYNCED_STORES, type Intake, type StoreRecord, type SyncedStore } from './model.ts'

/**
 * Конфиг «Трапезы» для ядра (Р-47, Р-52).
 *
 * Механику ядра проверяют его тесты на подставной «Полке», в CI ядра. Здесь —
 * своё: то, что до перевода проверялось тестами `core/*` на хранилищах
 * «Трапезы» и что лежит на устройствах и в `TrapezaData`, — имя базы,
 * хранилища, индексы, раскладка. И главное для перевода: база, заведённая
 * прежним кодом, открывается ядром с прежними записями (Р-49).
 */

const db = createDb(config)
const layout = createLayout(config)

beforeEach(async () => {
  await db.close().catch(() => {})
  globalThis.indexedDB = new IDBFactory()
})

afterEach(async () => {
  await db.close().catch(() => {})
})

function intake(id: string, date: string): Intake {
  return { id, updatedAt: '2026-09-09T10:00:00.000Z', date, meal: 'lunch', dishId: 'dish:борщ' }
}

function withIntake(records: Intake[]): { [S in SyncedStore]: StoreRecord[S][] } {
  return { categories: [], dishes: [], templates: [], norms: [], intake: records }
}

describe('данные не трогаются переводом', () => {
  it('база называется trapeza — на общем origin только имя разводит приложения семьи', () => {
    expect(config.dbName).toBe('trapeza')
  })

  it('версия схемы 1, миграций нет', () => {
    expect(config.schemaVersion).toBe(1)
    expect(SCHEMA_VERSION).toBe(1)
    expect(config.migrations).toEqual([])
  })

  it('пять хранилищ, все — в раскладке версии 1', () => {
    expect([...config.stores]).toEqual(['categories', 'dishes', 'templates', 'norms', 'intake'])
    expect([...config.v1Stores]).toEqual([...SYNCED_STORES])
  })

  it('формат импорта прежний', () => {
    expect(config.importFormat).toBe('trapeza-import')
  })
})

describe('схема базы', () => {
  it('заводит все хранилища; сверх updatedAt — индекс записей по дате еды', async () => {
    await db.ready()
    await db.close()
    const raw = await openRaw()
    try {
      expect(raw.version).toBe(1)
      for (const store of [...SYNCED_STORES, ...LOCAL_STORES]) expect(raw.objectStoreNames.contains(store)).toBe(true)
      const tx = raw.transaction([...SYNCED_STORES], 'readonly')
      expect([...tx.objectStore('intake').indexNames].sort()).toEqual(['date', 'updatedAt'])
      for (const store of ['categories', 'dishes', 'templates', 'norms'] as const) {
        expect([...tx.objectStore(store).indexNames]).toEqual(['updatedAt'])
      }
    } finally {
      raw.close()
    }
  })

  it('база, заведённая прежним кодом, открывается с прежними записями', async () => {
    // Ровно так её заводил `createStores` в `core/db.ts` до перевода:
    // на телефоне лежит именно она, и переустанавливать приложение нельзя.
    await legacyBase([intake('i1', '2026-09-17')])

    await db.ready()
    expect(await db.get('intake', 'i1')).toMatchObject({ date: '2026-09-17', dishId: 'dish:борщ' })
    expect(await db.count('intake')).toBe(1)
    expect(await db.settings.get('syncRepo')).toBe('me/TrapezaData')
  })
})

describe('раскладка репозитория данных', () => {
  it('справочники — одним файлом, записи — по месяцам дня еды', () => {
    const paths = layout
      .buildFiles(withIntake([intake('a', '2026-01-31'), intake('b', '2026-02-01')]))
      .map((file) => file.path)
    expect(paths).toEqual([
      'categories.json',
      'dishes.json',
      'intake/2026-01.json',
      'intake/2026-02.json',
      'meta.json',
      'norms.json',
      'templates.json',
    ])
  })

  it('запись с испорченной датой не пропадает — уезжает в undated', () => {
    const paths = layout.buildFiles(withIntake([intake('a', '2026-02-30')])).map((file) => file.path)
    expect(paths).toContain('intake/undated.json')
  })

  it('README называет каждый файл раскладки', () => {
    const text = layout.readmeFile().content
    for (const path of ['categories.json', 'dishes.json', 'templates.json', 'norms.json', 'intake/ГГГГ-ММ.json']) {
      expect(text).toContain(`\`${path}\``)
    }
  })
})

describe('срез итогов — summary.json (Р-55)', () => {
  it('конфиг отдаёт ядру функцию среза «Трапезы»', () => {
    expect(config.summary).toBe(summary)
  })

  it('срез на своих данных проходит проверку формы ядра', () => {
    const data = withIntake([intake('a', '2026-09-07'), intake('b', '2026-09-08'), intake('c', '2026-02-30')])
    const day = '2026-09-09'
    const checked = checkSummary(buildSummary(summary(data, day), data, day))
    expect(checked.computedOn).toBe(day)
    expect(checked.periods).toHaveLength(4)
  })
})

function openRaw(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('trapeza')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function legacyBase(records: Intake[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('trapeza', 1)
    request.onupgradeneeded = () => {
      const database = request.result
      for (const store of ['categories', 'dishes', 'templates', 'norms', 'intake']) {
        const created = database.createObjectStore(store, { keyPath: 'id' })
        created.createIndex('updatedAt', 'updatedAt')
        if (store === 'intake') created.createIndex('date', 'date')
      }
      database.createObjectStore('meta', { keyPath: 'key' })
      database.createObjectStore('settings', { keyPath: 'key' })
      database.createObjectStore('dirty', { keyPath: ['store', 'id'] })
    }
    request.onsuccess = () => {
      const database = request.result
      const tx = database.transaction(['intake', 'meta', 'settings'], 'readwrite')
      for (const record of records) tx.objectStore('intake').put(record)
      tx.objectStore('meta').put({ key: 'schemaVersion', value: 1 })
      tx.objectStore('settings').put({ key: 'syncRepo', value: 'me/TrapezaData' })
      tx.oncomplete = () => {
        database.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
    request.onerror = () => reject(request.error)
  })
}
