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
 * Взято из «Делу Время» с d86f0aa; их номера помечены — «их Р-NN»,
 * голые — решения «Трапезы» (Р-53).
 */

import type { Snapshot } from './shared/core/db.ts'
import { formatDate, type DateStr, type Period } from './shared/core/dates.ts'
import type { FeedItem } from './shared/core/feed.ts'
import { mergeResults, type ImportContext, type ImportPlan, type ImportSpec } from './shared/core/importing.ts'
import { importing } from './app/core.ts'
import type { RecordKind, StoreRecord, SyncedStore } from './app/model.ts'
import {
  categoriesImportSpec,
  dishesImportSpec,
  importCategories,
  importDishes,
  importIntake,
  intakeImportSpec,
} from './modules/food/import.ts'
import { intakeFeed, intakeMarkdown } from './modules/food/feed.ts'

/**
 * Все синхронизируемые хранилища, вместе с надгробиями. Надгробия нужны
 * справочникам: по ним видно, какие id заняты. Сами записи без надгробий
 * отбирают модули.
 */
export type Data = Snapshot<StoreRecord>['data']

/** План импорта «Трапезы»: записи — её хранилищ. */
type Plan = ImportPlan<StoreRecord>

type ImportEntry = { spec: ImportSpec; run: (raw: unknown, data: Data, ctx: ImportContext) => Plan }

type KindEntry = {
  /** Подпись вида: чип ленты, заголовок раздела выгрузки. */
  label: string
  /** Строки ленты, без порядка: порядок — дело `shared/core/feed.ts`. */
  feed: (data: Data, day: DateStr) => FeedItem[]
  /**
   * Раздел выгрузки без заголовка: заголовок — подпись вида. `period` — вид
   * отбирает свои записи по своей дате; null — за всё время (Р-34).
   */
  markdown: (data: Data, day: DateStr, period: Period | null) => string
  /** Разделы импорта по порядку разбора. Пусто — вид не импортируется. */
  import: readonly ImportEntry[]
}

export const KINDS: { readonly [K in RecordKind]: KindEntry } = {
  intake: {
    label: 'Еда',
    feed: (data, day) => intakeFeed(data.intake, data.dishes, data.categories, day),
    markdown: (data, _day, period) => intakeMarkdown(data.intake, data.dishes, period),
    import: [
      { spec: categoriesImportSpec, run: importCategories },
      { spec: dishesImportSpec, run: importDishes },
      { spec: intakeImportSpec, run: importIntake },
    ],
  },
}

/** Порядок видов на экране, в промпте и в выгрузке — порядок строк таблицы. */
export const KIND_ORDER = Object.keys(KINDS) as RecordKind[]

/**
 * Подпись вида по строке ленты. Лента ядра держит `kind` строкой — вид любого
 * приложения семьи; незнакомый вид подписывается как есть.
 */
export function kindLabel(kind: string): string {
  const known = KIND_ORDER.find((each) => each === kind)
  return known ? KINDS[known].label : kind
}

/** Все строки ленты, без порядка: порядок — дело `shared/core/feed.ts`. */
export function feedItems(data: Data, day: DateStr): FeedItem[] {
  return KIND_ORDER.flatMap((kind) => KINDS[kind].feed(data, day))
}

/** Что выгружать: разделы и период с названием для шапки. Не задано — всё и за всё время (Р-34). */
export type MarkdownChoice = {
  kinds?: readonly RecordKind[]
  span?: { period: Period; label: string } | null
}

/**
 * Выгрузка в markdown одним файлом: раздел на вид записи, период — на выбор
 * (Р-34; их Р-63, Р-79).
 *
 * Читать глазами, а не переносить: обратно файл не загружается, для
 * переноса — копия в JSON из тех же «Настроек».
 */
export function markdownExport(data: Data, day: DateStr, choice: MarkdownChoice = {}): string {
  const kinds = KIND_ORDER.filter((kind) => (choice.kinds ?? KIND_ORDER).includes(kind))
  const span = choice.span ?? null
  const head = [
    '# Трапеза',
    '',
    `Выгрузка от ${formatDate(day)}. Для чтения: обратно в приложение этот файл не загружается,`,
    'для переноса данных есть копия в JSON — «Настройки» → «Экспорт и импорт».',
  ]
  // Что выгружено — в шапке: выборка не прячет записи молча (Р-01).
  if (kinds.length < KIND_ORDER.length) head.push('', `Разделы: ${kinds.map((kind) => KINDS[kind].label).join(', ')}.`)
  if (span) head.push('', `Период: ${span.label}. Записи с неразобранной датой — только в выгрузке за всё время.`)
  const sections = kinds.map(
    (kind) => `## ${KINDS[kind].label}\n\n${KINDS[kind].markdown(data, day, span?.period ?? null)}`,
  )
  return `${[head.join('\n'), ...sections].join('\n\n')}\n`
}

/** Разделы импорта в порядке таблицы. */
function importEntries(): ImportEntry[] {
  return KIND_ORDER.flatMap((kind) => KINDS[kind].import)
}

/**
 * База вместе с тем, что завёл раздел: запись с тем же id — ожившее
 * надгробие — заменяет прежнюю.
 */
function withWrites(data: Data, plan: Plan): Data {
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
export function planImport(text: string, data: Data, ctx: ImportContext): Plan {
  const sections = importing.readImportFile(text)
  const results: Plan[] = []

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
  return importing.buildPrompt(
    importEntries().map((entry) => entry.spec),
    day,
  )
}
