import { useCallback, useEffect, useRef, useState } from 'react'
import { CHANGES } from '../changes.ts'
import { db } from '../core/db.ts'
import { today } from '../core/dates.ts'
import { SCHEMA_VERSION, SYNCED_STORES } from '../core/model.ts'
import type { RecordKind, SyncedStore } from '../core/model.ts'
import { KIND_ORDER, KINDS, markdownExport } from '../registry.ts'
import {
  checkReminder,
  disableReminders,
  enableReminders,
  readWakes,
  readWindow,
  reminderStatus,
  saveWindow,
  type ReminderStatus,
  type ReminderWindow,
  type RemindResult,
  type Wake,
} from '../notify.ts'
import { backupNote, backupSummary } from '../ui/backup.ts'
import { Fold } from '../ui/Fold.tsx'
import { InstallNote } from '../ui/Install.tsx'
import { ReportBug } from '../ui/Report.tsx'
import { SyncSettings } from '../ui/SyncSettings.tsx'
import { useSyncStatus } from '../ui/useSync.ts'
import { isEmptyBase } from './firstRun.ts'
import { ImportRecords } from './ImportRecords.tsx'
import { exportSpan, monthChoices, monthTitle, yearChoices } from './period.ts'
import { useRecordDates } from './useRecordDates.ts'
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
 * Разделы: «Синхронизация» — первой, «Экспорт и импорт» — копия файлом
 * импорт записей и markdown за период (Р-34), «Напоминания» (Р-30) и «О приложении».
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

      <SyncSettings onChanged={load} />

      <DataTransfer onChanged={load} />

      <Reminders />

      <About state={state} />
    </>
  )
}


// ─── Напоминания (Р-30) — раздел «Делу Время» с d86f0aa, у них — из «Дневников» ─

const REMINDER_TEXT: Record<ReminderStatus, string> = {
  unsupported:
    'Этот браузер не умеет напоминать, когда приложение закрыто. Напоминания работают ' +
    'в Chrome на Android у установленного приложения.',
  denied: 'Уведомления для этого сайта запрещены в настройках браузера. Разрешить их можно только там.',
  off:
    'Примерно раз в сутки приложение напомнит, если сегодня ничего не записано или вчера не записан ' +
    'завтрак, обед или ужин. Приём, отмеченный «Не было», пропуском не считается. Даже закрытое.',
  'not-installed':
    'Уведомления разрешены, но фоновую проверку браузер не дал. Так бывает, когда приложение ' +
    'открыто во вкладке, а не установлено иконкой.',
  on: 'Включено. Браузер проверяет примерно раз в сутки, точное время выбирает сам.',
}

/** Итог у свёрнутого раздела: включены ли. */
const REMINDER_SUMMARY: Record<ReminderStatus, string> = {
  unsupported: 'браузер не умеет',
  denied: 'запрещены',
  off: 'выключены',
  'not-installed': 'выключены',
  on: 'включены',
}

const CHECK_TEXT: Record<RemindResult | 'denied' | 'unsupported', string> = {
  shown: 'Уведомление показано.',
  quiet: 'Уведомление показано без звука.',
  nothing:
    'Напоминать не о чем — вчерашние приёмы и сегодняшний день записаны. Пришло пустое уведомление, ' +
    'чтобы было видно, что они доходят.',
  already: 'Сегодня уже напоминало.',
  failed: 'Показать уведомление не вышло.',
  denied: 'Уведомления запрещены — показать нечего.',
  unsupported: REMINDER_TEXT.unsupported,
}

/** Чем кончилось фоновое пробуждение — строка журнала. */
const WAKE_TEXT: Record<RemindResult, string> = {
  shown: 'показано со звуком',
  quiet: 'показано без звука — вне окна',
  nothing: 'напоминать было не о чем',
  already: 'сегодня уже напоминало',
  failed: 'показать не вышло',
}

/**
 * Напоминание о незаполненном дне.
 *
 * Включается кнопкой, а не само: разрешение на уведомления браузер
 * спрашивает только по действию человека. «Проверить сейчас» — чтобы
 * не ждать сутки, прежде чем узнать, работает ли.
 */
function Reminders() {
  const [status, setStatus] = useState<ReminderStatus | null>(null)
  const [hours, setHours] = useState<ReminderWindow | null>(null)
  const [wakes, setWakes] = useState<Wake[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    void reminderStatus()
      .then(setStatus)
      .catch(() => setStatus('unsupported'))
    void readWindow().then(setHours)
    void readWakes()
      .then(setWakes)
      .catch(() => setWakes([]))
  }, [])

  async function pickHours(next: ReminderWindow) {
    setHours(next)
    await saveWindow(next)
  }

  async function act(action: () => Promise<void>) {
    setBusy(true)
    setNote('')
    try {
      await action()
    } catch (failure) {
      setNote(describe(failure))
    } finally {
      setBusy(false)
    }
  }

  const summary =
    status === null
      ? undefined
      : status === 'on' && hours
        ? `включены, ${hours.from}–${hours.to}`
        : REMINDER_SUMMARY[status]
  const usable = status !== null && status !== 'unsupported' && status !== 'denied'

  // Пока состояние читается, раздел без итога и без содержимого: мигать
  // «не поддерживается» на полсекунды незачем.
  return (
    <Fold id="settings:reminders" title="Напоминания" summary={summary} folded>
      {status !== null && (
        <>
          <p className="muted">{REMINDER_TEXT[status]}</p>

          <div className="row row--wrap">
            {(status === 'off' || status === 'not-installed') && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void act(async () => setStatus(await enableReminders()))}
              >
                Включить напоминания
              </button>
            )}
            {status === 'on' && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await disableReminders()
                    setStatus('off')
                  })
                }
              >
                Выключить
              </button>
            )}
            {usable && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void act(async () => setNote(CHECK_TEXT[await checkReminder()]))}
              >
                Проверить сейчас
              </button>
            )}
          </div>

          {note && <p className="muted">{note}</p>}

          {usable && hours && (
            <>
              <div className="row row--wrap">
                <HourField
                  label="Со звуком с"
                  value={hours.from}
                  onPick={(from) => void pickHours({ ...hours, from })}
                />
                <HourField label="до" value={hours.to} onPick={(to) => void pickHours({ ...hours, to })} />
              </div>
              <p className="muted">
                Вне этих часов уведомление приходит без звука и ждёт в шторке. Если в тот же день
                браузер проверит ещё раз уже в эти часы — повторит со звуком. Часы — по времени
                этого устройства.
              </p>
            </>
          )}

          {usable && <WakeLog wakes={wakes} />}
        </>
      )}
    </Fold>
  )
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

function HourField({ label, value, onPick }: { label: string; value: number; onPick: (hour: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onPick(Number(event.target.value))}>
        {HOURS.map((hour) => (
          <option key={hour} value={hour}>{`${hour}:00`}</option>
        ))}
      </select>
    </label>
  )
}

function wakeTime(at: string): string {
  return new Date(at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/**
 * Журнал фоновых проверок: будит ли их браузер вообще и чем они кончаются.
 * Без него «ни разу не пришло само» — три неразличимых случая: не будил;
 * будил, но напоминать было не о чем; будил, но сегодня уже было.
 */
function WakeLog({ wakes }: { wakes: Wake[] | null }) {
  if (wakes === null) return null

  const last = wakes[0]
  if (!last) {
    return <p className="muted">Фоновая проверка на этом устройстве ещё ни разу не просыпалась.</p>
  }

  return (
    <>
      <p className="muted">
        Фоновая проверка последний раз: {wakeTime(last.at)} — {WAKE_TEXT[last.result]}.
      </p>
      {wakes.length > 1 && (
        <Fold id="settings:reminders:wakes" title="Все пробуждения" summary={wakes.length} sub folded>
          <table className="stats">
            <tbody>
              {wakes.map((wake) => (
                <tr key={wake.at}>
                  <td>{wakeTime(wake.at)}</td>
                  <td className="muted">{WAKE_TEXT[wake.result]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Fold>
      )}
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
  /** Что выгружать в markdown: разделы — все, период — всё время (Р-34; их Р-79). */
  const [kinds, setKinds] = useState<RecordKind[]>([...KIND_ORDER])
  const [span, setSpan] = useState('')
  const months = monthChoices(useRecordDates(), today())

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

  /**
   * Markdown — для чтения глазами и на случай отказа от приложения (их Р-63):
   * записи остаются текстом, который открывается где угодно. Отметку
   * о выгрузке не ставит — из markdown не восстановиться.
   */
  async function saveMarkdown(via: Via) {
    setBusy(true)
    setNote('')
    setError('')
    try {
      const snapshot = await db.exportAll()
      const text = markdownExport(snapshot.data, today(), { kinds, span: exportSpan(span) })
      if (!(await deliver(via, `trapeza-${today()}.md`, text, 'text/markdown'))) return
      setNote(
        `Markdown ${via === 'share' ? 'отправлен' : 'сохранён'}. Он для чтения: обратно в приложение загружается только копия.`,
      )
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

      {/* Читать без приложения (их Р-63): в одну сторону, не копия. */}
      <Fold id="settings:transfer:markdown" title="Markdown для чтения" sub folded>
        <p className="muted">
          Записи еды одним файлом: месяцы, дни и приёмы с блюдами, порциями, временем и заметками. Период —
          ниже, по умолчанию всё время. Открывается где угодно; обратно в приложение не загружается — для
          этого копия.
        </p>
        {/* Разделы на выбор — только когда видов записей больше одного (Р-34). */}
        {KIND_ORDER.length > 1 && (
          <div className="chips" role="group" aria-label="Разделы markdown">
            {KIND_ORDER.map((kind) => (
              <button
                key={kind}
                type="button"
                className={kinds.includes(kind) ? 'chip chip--on' : 'chip'}
                aria-pressed={kinds.includes(kind)}
                onClick={() => setKinds(kinds.includes(kind) ? kinds.filter((each) => each !== kind) : [...kinds, kind])}
              >
                {KINDS[kind].label}
              </button>
            ))}
          </div>
        )}
        <label className="field">
          <span>Период</span>
          <select name="md-period" value={span} onChange={(event) => setSpan(event.target.value)}>
            <option value="">За всё время</option>
            {yearChoices(months).map((year) => (
              <option key={`y:${year}`} value={`y:${year}`}>
                {year} год
              </option>
            ))}
            {months.map((month) => (
              <option key={`m:${month}`} value={`m:${month}`}>
                {monthTitle(month)}
              </option>
            ))}
          </select>
        </label>
        <div className="row row--wrap">
          <button
            type="button"
            className="btn"
            onClick={() => void saveMarkdown('file')}
            disabled={busy || kinds.length === 0}
          >
            Сохранить markdown
          </button>
          {sharable && (
            <button
              type="button"
              className="btn"
              onClick={() => void saveMarkdown('share')}
              disabled={busy || kinds.length === 0}
            >
              Поделиться markdown
            </button>
          )}
        </div>
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
