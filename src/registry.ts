/**
 * Реестр видов записей (02-Архитектура, «Реестр видов записей»).
 *
 * Таблица, а не механизм: на каждый вид записи — подпись, строки ленты,
 * раздел выгрузки в markdown и, где есть, раздел импорта. Сами функции живут
 * в модулях, здесь они только сведены. Тип `{ [K in RecordKind]: … }`
 * проверяется компилятором на полноту — новый вид в модели не соберётся,
 * пока здесь нет его строки.
 *
 * Рос по этапам (Р-23): с Этапа 1 — подпись и импорт, с Этапа 6 — лента
 * и markdown (Р-63). Импортируются заметки и учёт времени; обзор недели —
 * нет. Строки обзора — из `screens/reviewFeed.ts`: обзор не модуль (Р-60).
 *
 * Чего здесь нет намеренно: маршрутов, вкладок и блоков «Сегодня» —
 * это продуктовые решения, из списка они не выводятся.
 *
 * Одно из немногих мест, которые знают все модули разом, — вместе
 * с `app.tsx`, `notify.ts` и `screens/`. Модули друг про друга не знают.
 */

import type { Snapshot } from './core/db.ts'
import { formatDate, type DateStr, type Period } from './core/dates.ts'
import type { FeedItem } from './core/feed.ts'
import {
  buildPrompt,
  mergeResults,
  readImportFile,
  type ImportContext,
  type ImportPlan,
  type ImportSpec,
} from './core/importing.ts'
import type { RecordKind } from './core/model.ts'
import { noteFeed, noteMarkdown } from './modules/notes/feed.ts'
import { importNotes, notesImportSpec } from './modules/notes/import.ts'
import { timeFeed, timeMarkdown } from './modules/time/feed.ts'
import { importTime, timeImportSpec } from './modules/time/import.ts'
import { reviewFeed, reviewMarkdown } from './screens/reviewFeed.ts'

/**
 * Все синхронизируемые хранилища, вместе с надгробиями. Надгробия нужны
 * справочникам: по ним видно, какие id заняты, и у блока удалённой
 * категории остаётся имя. Сами записи без надгробий отбирают модули.
 */
export type Data = Snapshot['data']

type ImportEntry = { spec: ImportSpec; run: (raw: unknown, data: Data, ctx: ImportContext) => ImportPlan }

type KindEntry = {
  /** Подпись вида: чип ленты, заголовок раздела выгрузки. */
  label: string
  /** Строки ленты, без порядка: порядок — дело `core/feed.ts`. */
  feed: (data: Data, day: DateStr) => FeedItem[]
  /**
   * Раздел выгрузки без заголовка: заголовок — подпись вида. `period` — вид
   * отбирает свои записи по своей дате; null — за всё время (Р-79).
   */
  markdown: (data: Data, day: DateStr, period: Period | null) => string
  /** Раздел импорта записей. Нет — вид не импортируется. */
  import?: ImportEntry
}

export const KINDS: { readonly [K in RecordKind]: KindEntry } = {
  note: {
    label: 'Заметки и план',
    feed: (data) => noteFeed(data.notes),
    markdown: (data, _day, period) => noteMarkdown(data.notes, period),
    import: { spec: notesImportSpec, run: importNotes },
  },
  time: {
    label: 'Учёт времени',
    feed: (data) => timeFeed(data.time, data.categories),
    markdown: (data, day, period) => timeMarkdown(data.time, data.categories, day, period),
    import: { spec: timeImportSpec, run: importTime },
  },
  review: {
    label: 'Обзоры недели',
    feed: (data) => reviewFeed(data.reviews, data.notes),
    markdown: (data, _day, period) => reviewMarkdown(data.reviews, data.notes, period),
  },
}

/** Порядок видов на экране, в промпте и в выгрузке — порядок строк таблицы. */
export const KIND_ORDER = Object.keys(KINDS) as RecordKind[]

/** Все строки ленты, без порядка: порядок — дело `core/feed.ts`. */
export function feedItems(data: Data, day: DateStr): FeedItem[] {
  return KIND_ORDER.flatMap((kind) => KINDS[kind].feed(data, day))
}

/** Что выгружать (Р-79): разделы и период с названием для шапки. Не задано — всё и за всё время. */
export type MarkdownChoice = {
  kinds?: readonly RecordKind[]
  span?: { period: Period; label: string } | null
}

/**
 * Выгрузка в markdown одним файлом: раздел на вид записи (Р-63), разделы
 * и период — на выбор (Р-79).
 *
 * Читать глазами, а не переносить: обратно файл не загружается, для
 * переноса — копия в JSON из тех же «Настроек».
 */
export function markdownExport(data: Data, day: DateStr, choice: MarkdownChoice = {}): string {
  const kinds = KIND_ORDER.filter((kind) => (choice.kinds ?? KIND_ORDER).includes(kind))
  const span = choice.span ?? null
  const head = [
    '# Делу Время',
    '',
    `Выгрузка от ${formatDate(day)}. Для чтения: обратно в приложение этот файл не загружается,`,
    'для переноса данных есть копия в JSON — «Настройки» → «Экспорт и импорт».',
  ]
  // Что выгружено — в шапке: выборка не прячет записи молча (Р-79).
  if (kinds.length < KIND_ORDER.length) head.push('', `Разделы: ${kinds.map((kind) => KINDS[kind].label).join(', ')}.`)
  if (span) head.push('', `Период: ${span.label}. Записи без даты — только в выгрузке за всё время.`)
  const sections = kinds.map(
    (kind) => `## ${KINDS[kind].label}\n\n${KINDS[kind].markdown(data, day, span?.period ?? null)}`,
  )
  return `${[head.join('\n'), ...sections].join('\n\n')}\n`
}

/** Разделы импорта в порядке таблицы. */
function importEntries(): ImportEntry[] {
  return KIND_ORDER.flatMap((kind) => {
    const entry = KINDS[kind].import
    return entry ? [entry] : []
  })
}

/**
 * План импорта записей: что добавится, что уже есть, что не разобрано.
 * В базу не пишет — сначала сводка, запись только по кнопке.
 * Кидает, если файл не тот вовсе.
 */
export function planImport(text: string, data: Data, ctx: ImportContext): ImportPlan {
  const sections = readImportFile(text)
  const bySection = new Map(importEntries().map((entry) => [entry.spec.section, entry]))

  const results = Object.entries(sections).map(([section, raw]): ImportPlan => {
    const entry = bySection.get(section)
    if (entry) return entry.run(raw, data, ctx)
    return {
      writes: {},
      added: [],
      skipped: 0,
      issues: [{ section, title: `раздел «${section}»`, reason: 'такого раздела нет — пропущен целиком' }],
    }
  })
  return mergeResults(results)
}

/** Промпт для ИИ — из описаний всех разделов, в порядке таблицы. */
export function importPrompt(day: DateStr): string {
  return buildPrompt(
    importEntries().map((entry) => entry.spec),
    day,
  )
}
