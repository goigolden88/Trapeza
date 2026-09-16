import { useEffect, useState } from 'react'
import { db } from '../../core/db.ts'
import type { SyncedStore } from '../../core/model.ts'
import { reconcilePlan, type CatalogData, type CatalogPlan } from './catalog.ts'

/** Хранилища еды — все синхронизируемые. */
const STORES = ['categories', 'dishes', 'templates', 'norms', 'intake'] as const satisfies readonly SyncedStore[]

export type Food = {
  status: 'loading' | 'ready' | 'failed'
  error: string
  /** Всё с надгробиями: по ним видно, какие id заняты и куда перенесено. */
  data: { [K in keyof CatalogData]: CatalogData[K][number][] }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

async function readAll(): Promise<Food['data']> {
  const [categories, dishes, templates, norms, intake] = await Promise.all(
    STORES.map((store) => db.getAll(store, { includeDeleted: true })),
  )
  // Порядок `STORES` и деструктуризации один; типы по позиции TypeScript не проследит.
  return { categories, dishes, templates, norms, intake } as Food['data']
}

/**
 * Справочник и записи еды из базы. Перечитывается на любую запись в них —
 * своей рукой, импортом или из копии.
 *
 * Записей за всю историю немного — шесть–восемь в день, — и частота (Р-08)
 * всё равно смотрит на всю историю до дня, поэтому читается всё сразу.
 */
export function useFood(): Food {
  const [state, setState] = useState<Food>({
    status: 'loading',
    error: '',
    data: { categories: [], dishes: [], templates: [], norms: [], intake: [] },
  })

  useEffect(() => {
    let alive = true

    async function load() {
      try {
        const data = await readAll()
        if (alive) setState({ status: 'ready', error: '', data })
      } catch (failure) {
        if (alive) setState((previous) => ({ ...previous, status: 'failed', error: describe(failure) }))
      }
    }

    void load()
    const off = db.onChange((event) => {
      if ((STORES as readonly string[]).includes(event.store)) void load()
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  return state
}

/**
 * Записать план справочника. Сначала то, что ссылается, надгробия и
 * справочники последними: оборвись запись посередине — записи уже у
 * оставшегося блюда, а слияние доделает следующий запуск.
 */
export async function writePlan(plan: CatalogPlan): Promise<void> {
  await db.putMany('intake', plan.intake)
  await db.putMany('templates', plan.templates)
  await db.putMany('norms', plan.norms)
  await db.putMany('dishes', plan.dishes)
  await db.putMany('categories', plan.categories)
}

/**
 * Сколько ждать тишины после прихода данных. Восстановление из копии
 * вливает хранилища по очереди, а считать слияние надо по всем сразу.
 */
const MERGE_DELAY_MS = 1000

/**
 * Слияние одноимённых и перенос от надгробий (Р-12) — после прихода данных
 * не своей рукой: из файла-копии, с Этапа 2 — с сервера. Своя правка дубля
 * не заведёт: занятое название форма не пропускает, импорт находит его.
 *
 * Один на приложение, запускается из `app.tsx`, а не из экранов: иначе
 * каждый открытый экран писал бы то же самое. Возвращает отписку.
 * Механика — `watchCategoryMerges` «Делу Время».
 */
export function watchMerges(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> | null = null

  async function run(): Promise<void> {
    await writePlan(reconcilePlan(await readAll()))
  }

  function schedule(): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (running) {
        schedule()
        return
      }
      // Ошибку сообщить некому: запуск фоновый. Следующий приход данных
      // попробует снова.
      running = run()
        .catch(() => undefined)
        .finally(() => {
          running = null
        })
    }, MERGE_DELAY_MS)
  }

  const off = db.onChange((event) => {
    // Своя запись — в том числе запись самого слияния — повода не даёт.
    if (event.origin === 'local') return
    if ((STORES as readonly string[]).includes(event.store)) schedule()
  })

  // Приехавшее до прошлого закрытия приложения.
  schedule()

  return () => {
    off()
    if (timer) clearTimeout(timer)
    timer = null
  }
}
