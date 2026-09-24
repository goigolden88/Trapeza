/**
 * Конфиг «Трапезы» для ядра `FamilyCore` (Р-47).
 *
 * Всё, чем «Трапеза» отличается для ядра, — одним объектом. Значения
 * перенесены буквально из прежних `core/db.ts`, `core/layout.ts`
 * и `core/importing.ts`: имя базы, хранилища, `V1_STORES`, индексы,
 * раскладка и формат импорта лежат на устройствах и в `TrapezaData`,
 * и перевод на ядро их не меняет (Р-49). Проверка — `config.test.ts`.
 */

import type { AppConfig } from '../shared/core/model.ts'
import { summary } from '../modules/food/digest.ts'
import { migrations, SCHEMA_VERSION, SYNCED_STORES, type StoreRecord } from './model.ts'

export const config: AppConfig<StoreRecord> = {
  name: 'Трапеза',

  // Имя обязано отличаться от `dnevniki` и `deluvremya`: все приложения семьи
  // живут на одном origin, а IndexedDB различается только именем.
  dbName: 'trapeza',

  schemaVersion: SCHEMA_VERSION,
  migrations,
  stores: SYNCED_STORES,

  // Раскладка версии 1 — заморожена. Все пять хранилищ в ней с первого дня:
  // шаблоны и нормы были известны сразу, заводить их миграцией незачем.
  v1Stores: ['categories', 'dishes', 'templates', 'norms', 'intake'],

  // Сверх `updatedAt`: выборки дня, недели и возврата идут по дате еды.
  indexes: {
    categories: [],
    dishes: [],
    templates: [],
    norms: [],
    intake: ['date'],
  },

  // 02-Архитектура, «Раскладка данных в репозитории».
  places: {
    categories: { split: 'none', path: 'categories.json' },
    dishes: { split: 'none', path: 'dishes.json' },
    templates: { split: 'none', path: 'templates.json' },
    norms: { split: 'none', path: 'norms.json' },
    // Месяц — по дню еды, а не по дню ввода. Дата у записи обязательна,
    // в undated попадает только испорченная.
    intake: { split: 'month', dir: 'intake', dateOf: (intake) => intake.date },
  },

  storeNotes: {
    categories: 'категории еды и напитков',
    dishes: 'блюда и продукты',
    templates: 'шаблоны приёмов пищи',
    norms: 'нормы недели',
    intake: 'что съедено — по месяцу, когда ели',
  },

  importFormat: 'trapeza-import',

  // Свои правила промпта — 1–3; общие ядро допишет следом. Правила про поля
  // живут в описаниях разделов `modules/food/import.ts`, а не здесь.
  promptRules: [
    'Записей не выдумывай: чего нет в моих данных — не пиши. Необязательное поле, которого нет ' +
      'в данных, опусти; оценкой его можно заполнить, только если в описании поля так и сказано. Запись ' +
      'без обязательного поля не пиши вовсе, а назови в списке после JSON.',
    'Даты — ГГГГ-ММ-ДД. Любой вид (24.01.26, 20-02-2026, «3 марта») приводи к нему. Запись, у которой ' +
      'неизвестен день, не пиши, а назови в списке после JSON.',
    'Строки и столбцы итогов, проценты и суммы за месяц не переноси: приложение посчитает их само.',
  ],

  // Срез итогов для метаприложения — `summary.json` в репозитории данных
  // (Р-55; Я-16 «FamilyCore»). Пишет проход синхронизации, приложение не читает.
  summary,

  about: {
    data: 'учёт еды: что съедено, в каком приёме, блюда и нормы недели',
    privacy: 'внутри то, что и когда вы ели, и заметки к этому',
    sources: 'таблицы учёта еды, списки блюд или скриншоты из других сервисов',
  },
}
