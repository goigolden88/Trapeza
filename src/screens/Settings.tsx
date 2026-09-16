import { useCallback, useEffect, useRef, useState } from 'react'
import { CHANGES } from '../changes.ts'
import { db } from '../core/db.ts'
import { today } from '../core/dates.ts'
import { SCHEMA_VERSION, SYNCED_STORES } from '../core/model.ts'
import type { SyncedStore } from '../core/model.ts'
import { backupNote, backupSummary } from '../ui/backup.ts'
import { Fold } from '../ui/Fold.tsx'
import { InstallNote } from '../ui/Install.tsx'
import { ReportBug } from '../ui/Report.tsx'
import { useSyncStatus } from '../ui/useSync.ts'
import { isEmptyBase } from './firstRun.ts'
import { ImportRecords } from './ImportRecords.tsx'
import { ChangeList } from './WhatsNew.tsx'

const LABELS: Record<SyncedStore, string> = {
  categories: 'Категории',
  dishes: 'Блюда',
  templates: 'Шаблоны приёмов',
  norms: 'Нормы недели',
  intake: 'Записи еды',
}

type Row = { store: SyncedStore; live: number; total: number }

type State =
  | { status: 'loading' }
  | { status: 'ready'; rows: Row[] }
  | { status: 'failed'; message: string }

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

/**
 * Настройки разделами, как в «Дневниках». Разделы свёрнуты, пока их
 * не открыли: в настройки заходят за чем-то одним, и экран читается как
 * оглавление. Итог у заголовка говорит, стоит ли разворачивать, — отсутствие
 * копии видно и у свёрнутого.
 *
 * Разделов два: «Экспорт и импорт» — копия файлом и импорт записей — и «О
 * приложении». Синхронизация встаёт первой в Этапе 2, markdown — в Этапе 5 (Р-16).
 */
export function Settings() {
  const [state, setState] = useState<State>({ status: 'loading' })

  const load = useCallback(async () => {
    try {
      await db.ready()
      const rows: Row[] = []
      for (const store of SYNCED_STORES) {
        rows.push({
          store,
          live: await db.count(store),
          total: await db.count(store, { includeDeleted: true }),
        })
      }
      setState({ status: 'ready', rows })
    } catch (error) {
      setState({ status: 'failed', message: describe(error) })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <>
      <header className="screen-head">
        <h1>Настройки</h1>
      </header>

      <DataTransfer onChanged={load} />

      <About state={state} />
    </>
  )
}

/**
 * Версия, сборка и что лежит в базе. Сюда смотрят, когда что-то не так,
 * и когда проверяют, доехало ли обновление.
 */
function About({ state }: { state: State }) {
  const [persistent, setPersistent] = useState<boolean | null | undefined>(undefined)

  useEffect(() => {
    void db.persisted().then(setPersistent)
  }, [])

  // Дата сборки — в итоге у заголовка: по ней проверяют, доехало ли
  // обновление, и разворачивать ради этого раздел незачем.
  const built = new Date(__BUILD_TIME__)
  const short = built.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <Fold id="settings:about" title="О приложении" summary={`сборка ${short}`} folded>
      <dl className="facts">
        <dt>Версия схемы</dt>
        <dd>{SCHEMA_VERSION}</dd>
        <dt>Сборка</dt>
        <dd>{built.toLocaleString('ru-RU')}</dd>
        {persistent !== undefined && (
          <>
            {/* Не копия: данные те же и там же. Вопрос один — вправе ли
                браузер стереть их сам, никого не спросив. */}
            <dt>Очистка браузером</dt>
            <dd>
              {persistent === true
                ? 'не грозит — стереть данные можно только самому'
                : persistent === false
                  ? 'возможна при нехватке места'
                  : 'браузер не сообщает'}
            </dd>
          </>
        )}
      </dl>

      {/* Сюда за установкой возвращаются, когда приветствие закрыто. */}
      <h3 className="unit__name">Установка</h3>
      <InstallNote
        empty={
          state.status !== 'ready' ||
          isEmptyBase(Object.fromEntries(state.rows.map((row) => [row.store, row.live])))
        }
      />

      {/* Весь список изменений (Р-65): блок на главном экране закрыли, а спросить
          «что тогда поменялось» можно и потом. */}
      <Fold id="settings:about:changes" title="Что нового" sub folded>
        <ChangeList changes={CHANGES} />
      </Fold>

      {/* Отзыв доходит до кода, а не теряется в переписке (Р-66). */}
      <Fold id="settings:about:report" title="Сообщить об ошибке" sub folded>
        <ReportBug />
      </Fold>

      {state.status === 'loading' && <p className="muted">Открываю базу…</p>}

      {state.status === 'failed' && <p className="error">База не открылась: {state.message}</p>}

      {state.status === 'ready' && (
        <table className="stats">
          <tbody>
            {state.rows.map((row) => (
              <tr key={row.store}>
                <td>{LABELS[row.store]}</td>
                <td className="num">{row.live}</td>
                <td className="num muted">
                  {row.total > row.live ? `+${row.total - row.live} удал.` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Fold>
  )
}

/**
 * Ручной перенос файлом. Запасной путь на случай отвалившейся синхронизации,
 * единственный — у того, кто её не заводил, и способ забрать всё с собой
 * при отказе от приложения.
 */
function DataTransfer({ onChanged }: { onChanged: () => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null)
  const sync = useSyncStatus()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [lastSaved, setLastSaved] = useState<string | null | undefined>(undefined)
  const [sharable] = useState(canShareFiles)

  // Дата последней выгрузки лежит в настройках: они не синхронизируются,
  // и это правильно — «когда я забирал копию» у каждого устройства своё.
  useEffect(() => {
    void db.settings.get<string>(LAST_EXPORT).then((value) => setLastSaved(value ?? null))
  }, [])

  async function save(via: Via) {
    setBusy(true)
    setNote('')
    setError('')
    try {
      const snapshot = await db.exportAll()
      const sent = await deliver(via, `trapeza-${today()}.json`, JSON.stringify(snapshot, null, 2), 'application/json')
      if (!sent) return
      // Браузер не сообщает, дошёл ли файл до диска: диалог мог быть отменён.
      // Отметка означает «выгрузку запускали», а не «копия точно есть».
      const at = new Date().toISOString()
      await db.settings.set(LAST_EXPORT, at)
      setLastSaved(at)
      setNote(via === 'share' ? 'Копия отправлена' : 'Файл сохранён')
    } catch (failure) {
      setError(describe(failure))
    } finally {
      setBusy(false)
    }
  }

  async function open(file: File) {
    setBusy(true)
    setNote('')
    setError('')
    try {
      const snapshot = db.parseSnapshot(await file.text())
      const applied = await db.importAll(snapshot)
      await onChanged()
      setNote(
        applied === 0
          ? 'Ничего не изменилось: в файле нет записей новее здешних'
          : `Загружено записей: ${applied}`,
      )
    } catch (failure) {
      setError(describe(failure))
    } finally {
      setBusy(false)
      // Одинаковый файл должен открываться повторно — без сброса
      // второй выбор того же файла не даёт события.
      if (input.current) input.current.value = ''
    }
  }

  const summary = lastSaved === undefined ? undefined : backupSummary(lastSaved, sync, today())

  return (
    <Fold
      id="settings:transfer"
      title="Экспорт и импорт"
      summary={
        summary && (summary.tone === 'error' ? <span className="error">{summary.text}</span> : summary.text)
      }
      folded
    >
      <Fold id="settings:transfer:copy" title="Копия всех данных" sub>
        <div className="row row--wrap">
          <button type="button" className="btn" onClick={() => void save('file')} disabled={busy}>
            Сохранить в файл
          </button>
          {/* На телефоне файл уходит сразу в мессенджер или на диск, а не
              ищется потом в «Загрузках». Не умеет браузер — кнопки нет. */}
          {sharable && (
            <button type="button" className="btn" onClick={() => void save('share')} disabled={busy}>
              Поделиться
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => input.current?.click()}
            disabled={busy}
          >
            Восстановить из копии
          </button>
        </div>

        <LastExport at={lastSaved} />

        <p className="muted">
          Восстановление не стирает то, что уже есть: записи сливаются по времени правки,
          побеждает более поздняя.
        </p>
      </Fold>

      <Fold id="settings:transfer:import" title="Импорт записей" sub folded>
        <ImportRecords onChanged={onChanged} />
      </Fold>

      {/* .txt — копия, отправленная через «Поделиться» (см. deliver). */}
      <input
        ref={input}
        type="file"
        accept="application/json,.json,text/plain,.txt"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void open(file)
        }}
      />

      {note && <p className="muted">{note}</p>}
      {error && <p className="error">{error}</p>}
    </Fold>
  )
}

const LAST_EXPORT = 'lastExportAt'

/** Куда отдать файл: скачать или в меню «Поделиться». */
type Via = 'file' | 'share'

/** Умеет ли браузер делиться файлами — на телефоне это меню «Поделиться». */
function canShareFiles(): boolean {
  try {
    return (
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [new File([''], 'x.txt', { type: 'text/plain' })] })
    )
  } catch {
    return false
  }
}

/**
 * Отдать текст файлом. false — человек закрыл меню «Поделиться»: это не
 * ошибка, и отметку о выгрузке ставить незачем.
 */
async function deliver(via: Via, name: string, text: string, type: string): Promise<boolean> {
  if (via === 'file') {
    download(name, text, type)
    return true
  }
  // Chrome на Android делится только файлами из своего списка — картинки,
  // видео, PDF, .txt; .json в нём нет, и отказ приходит словами
  // «Permission denied». Поэтому делимся .txt: содержимое то же, и
  // «Восстановить из копии» принимает его как есть.
  const shared = new File([text], name.replace(/\.(json|md)$/, '.txt'), { type: 'text/plain' })
  try {
    await navigator.share({ files: [shared], title: shared.name })
    return true
  } catch (failure) {
    if (failure instanceof DOMException && failure.name === 'AbortError') return false
    throw failure
  }
}

/** Отдать текст файлом через ссылку со скачиванием. */
function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  // Ссылка держит содержимое в памяти, пока её не отпустить.
  URL.revokeObjectURL(url)
}

/**
 * Где лежит копия данных и стоит ли об этом беспокоиться.
 *
 * Само правило — в `ui/backup.ts`: оно неочевидное и зависит от того,
 * проходила ли синхронизация хоть раз, а такое должно проверяться
 * тестами, а не глазами.
 */
function LastExport({ at }: { at: string | null | undefined }) {
  const sync = useSyncStatus()

  // undefined — настройки ещё читаются. Мигать тревогой на полсекунды
  // при каждом открытии экрана незачем.
  if (at === undefined) return null

  const note = backupNote(at, sync, today())
  return <p className={note.tone}>{note.text}</p>
}
