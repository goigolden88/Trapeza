/**
 * Реестр видов записей (02-Архитектура, «Реестр видов записей»).
 *
 * Таблица, а не механизм: на каждый вид записи — подпись, строки ленты,
 * раздел выгрузки в markdown и, где есть, раздел импорта. Сами функции живут
 * в модулях, здесь они только сведены. Тип `{ [K in RecordKind]: … }`
 * проверяется компилятором на полноту — новый вид в модели не соберётся,
 * пока здесь нет его строки.
 *
 * Растёт по этапам, как у «Делу Время» (их Р-23): с Этапа 1 — подпись
 * и импорт, с Этапа 5 — лента и markdown. Вид записи пока один — `intake`.
 *
 * Своё «Трапезы»: у вида не один раздел импорта, а список. Справочники еды
 * приходят тем же файлом, что и записи, и разделы разбираются по порядку —
 * каждый видит то, что завели предыдущие (02-Архитектура, «Импорт записей»).
 *
 * Чего здесь нет намеренно: маршрутов, вкладок и блоков «Сегодня» —
 * это продуктовые решения, из списка они не выводятся.
 *
 * Одно из немногих мест, которые знают все модули разом, — вместе
 * с `app.tsx`, `notify.ts` и `screens/`. Модули друг про друга не знают.
 *
 * Взято из «Делу Время» с d86f0aa; номера Р-NN в скопированных
 * комментариях — их.
 */

import type { Snapshot } from './core/db.ts'
import type { DateStr } from './core/dates.ts'
import {
  buildPrompt,
  mergeResults,
  readImportFile,
  type ImportContext,
  type ImportPlan,
  type ImportSpec,
} from './core/importing.ts'
import type { RecordKind, SyncedStore } from './core/model.ts'
import {
  categoriesImportSpec,
  dishesImportSpec,
  importCategories,
  importDishes,
  importIntake,
  intakeImportSpec,
} from './modules/food/import.ts'

/**
 * Все синхронизируемые хранилища, вместе с надгробиями. Надгробия нужны
 * справочникам: по ним видно, какие id заняты. Сами записи без надгробий
 * отбирают модули.
 */
export type Data = Snapshot['data']

type ImportEntry = { spec: ImportSpec; run: (raw: unknown, data: Data, ctx: ImportContext) => ImportPlan }

type KindEntry = {
  /** Подпись вида: чип ленты, заголовок раздела выгрузки. */
  label: string
  /** Разделы импорта по порядку разбора. Пусто — вид не импортируется. */
  import: readonly ImportEntry[]
}

export const KINDS: { readonly [K in RecordKind]: KindEntry } = {
  intake: {
    label: 'Еда',
    import: [
      { spec: categoriesImportSpec, run: importCategories },
      { spec: dishesImportSpec, run: importDishes },
      { spec: intakeImportSpec, run: importIntake },
    ],
  },
}

/** Порядок видов на экране, в промпте и в выгрузке — порядок строк таблицы. */
export const KIND_ORDER = Object.keys(KINDS) as RecordKind[]

/** Разделы импорта в порядке таблицы. */
function importEntries(): ImportEntry[] {
  return KIND_ORDER.flatMap((kind) => KINDS[kind].import)
}

/**
 * База вместе с тем, что завёл раздел: запись с тем же id — ожившее
 * надгробие — заменяет прежнюю.
 */
function withWrites(data: Data, plan: ImportPlan): Data {
  const next = { ...data } as Record<SyncedStore, { id: string }[]>
  for (const [store, records] of Object.entries(plan.writes) as [SyncedStore, { id: string }[] | undefined][]) {
    if (!records || records.length === 0) continue
    const ids = new Set(records.map((record) => record.id))
    next[store] = [...next[store].filter((record) => !ids.has(record.id)), ...records]
  }
  return next as unknown as Data
}

/**
 * План импорта записей: что добавится, что уже есть, что не разобрано.
 * В базу не пишет — сначала сводка, запись только по кнопке.
 * Кидает, если файл не тот вовсе.
 *
 * Разделы разбираются в порядке таблицы, а не файла, и каждый видит
 * заведённое предыдущими.
 */
export function planImport(text: string, data: Data, ctx: ImportContext): ImportPlan {
  const sections = readImportFile(text)
  const results: ImportPlan[] = []

  let current = data
  for (const entry of importEntries()) {
    if (!(entry.spec.section in sections)) continue
    const result = entry.run(sections[entry.spec.section], current, ctx)
    results.push(result)
    current = withWrites(current, result)
  }

  const known = new Set(importEntries().map((entry) => entry.spec.section))
  for (const section of Object.keys(sections)) {
    if (known.has(section)) continue
    results.push({
      writes: {},
      added: [],
      skipped: 0,
      issues: [{ section, title: `раздел «${section}»`, reason: 'такого раздела нет — пропущен целиком' }],
    })
  }
  return mergeResults(results)
}

/** Промпт для ИИ — из описаний всех разделов, в порядке таблицы. */
export function importPrompt(day: DateStr): string {
  return buildPrompt(
    importEntries().map((entry) => entry.spec),
    day,
  )
}
