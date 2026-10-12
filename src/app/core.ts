/**
 * Ядро «Трапезы» — собранное по её конфигу (Р-47).
 *
 * Код приложения берёт `db`, `sync`, `layout` и `importing` отсюда. К хранилищу
 * обращаются только через этот `db`: напрямую в IndexedDB не ходит никто,
 * кроме `shared/core/db.ts`. Общий интерфейс ядра получает те же объекты
 * контекстом — `<CoreProvider>` в `app.tsx` (Я-03 «FamilyCore»). В демо
 * `db` — база `trapeza-demo`, а `sync` нет.
 */

import { createDb } from '../shared/core/db.ts'
import { createImporting } from '../shared/core/importing.ts'
import { createLayout } from '../shared/core/layout.ts'
import { createSync } from '../shared/core/sync.ts'
import { config } from './config.ts'

export const db = createDb(config)
// В демо синхронизации нет (Я-44 «FamilyCore»): на демо-базе `createSync` падает.
export const sync = db.demo ? undefined : createSync(config, db)
export const layout = createLayout(config)
export const importing = createImporting(config)
