import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { db } from '../core/db.ts'
import { addDays, formatDate, formatDateLong, formatPeriod, nowIso, plural, weekPeriod, type DateStr } from '../core/dates.ts'
import { ulid } from '../core/id.ts'
import type { Category, Dish, Intake, Meal, Norm, Template } from '../core/model.ts'
import { activeDishes } from '../modules/food/catalog.ts'
import { dayMeals, tapDish, viewedDay } from '../modules/food/day.ts'
import { amountText, intakeInput, readIntake, stepPortions, type IntakeInput } from '../modules/food/forms.ts'
import { kcalText } from '../modules/food/kcal.ts'
import { FORMS, formatNumber, MEAL_NAMES, MEALS, normCheckText, portions, touchText } from '../modules/food/labels.ts'
import { currentMeal, DEFAULT_MEAL_HOURS, MEAL_HOURS_KEY, readMealHours, startedMeals, type MealHours } from '../modules/food/meals.ts'
import { normName } from '../modules/food/names.ts'
import { activeNorms, checkWeek, indexDays, touchedNorms } from '../modules/food/norms.ts'
import { frequentDishes, pickSections, searchSections, sectionsSize } from '../modules/food/picker.ts'
import { previousMeal, repeatItems } from '../modules/food/repeat.ts'
import { summarize, type CategoryLine } from '../modules/food/summary.ts'
import {
  applyTemplate,
  checkTemplateName,
  createTemplate,
  defaultTemplateName,
  intakeFrom,
  itemsFromRecords,
  NAME_PROBLEM_TEXT,
  replaceItems,
  templatesOf,
  type PlacedItem,
  type TemplateKind,
} from '../modules/food/templates.ts'
import { useFood, type Food } from '../modules/food/useFood.ts'
import {
  offerText,
  readSkipped,
  SKIPPED_KEY,
  skipKey,
  unansweredMeals,
  usualOffer,
  withSkipped,
  type Offer,
  type Unanswered,
} from '../modules/food/usual.ts'
import { weekRoute } from '../modules/food/week.ts'
import { Fold } from '../ui/Fold.tsx'
import { useNow } from '../ui/useNow.ts'
import { syncDot } from '../ui/syncDot.ts'
import { useSyncStatus } from '../ui/useSync.ts'
import { useToday } from '../ui/useToday.ts'

type Data = Food['data']

/** Сохранение с ошибкой на экране. true — прошло. */
type Save = (action: () => Promise<unknown>) => Promise<boolean>

/** Как часто сверять текущий приём с часами: границы — целые часы. */
const CLOCK_MS = 60_000

/** С какого числа блюд над списком встаёт поиск. */
const SEARCH_FROM = 12

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

/**
 * Главный экран «Сегодня»: четыре приёма дня и записанное в них (Р-11).
 *
 * Запись — один тап по блюду (CLAUDE.md, «Правила интерфейса»): у сегодняшнего
 * дня список блюд текущего приёма открыт сам, приём — по часам устройства.
 * Порции, граммы, время и заметка — правкой записи, по желанию (Р-14, Р-18).
 *
 * Прошлый день — тот же экран с `?day=ГГГГ-ММ-ДД`, как «Время» в «Делу Время»
 * (их Р-25, Р-27): день в адресе переживает перезагрузку, без параметра —
 * сегодня; это и адрес ярлыка «Записать».
 */
export function Today() {
  const today = useToday()
  const [params, setParams] = useSearchParams()
  const day = viewedDay(params.get('day'), today)
  const isToday = day === today
  const food = useFood()
  const [hours, setHours] = useState<MealHours>(DEFAULT_MEAL_HOURS)
  const mark = syncDot(useSyncStatus())

  useEffect(() => {
    void db.settings.get(MEAL_HOURS_KEY).then((stored) => setHours(readMealHours(stored)))
  }, [])

  // Сегодняшний — без параметра: ровно тот адрес, что открывает ярлык.
  const show = (next: DateStr) => setParams(next === today ? {} : { day: next })

  return (
    <>
      <header className="screen-head">
        <div className="screen-head__row">
          <h1>{isToday ? 'Сегодня' : 'День'}</h1>
          <div className="screen-head__tools">
            {/* Лента — не вкладка: её открывают найти день, а не каждый день (Р-33). */}
            <Link className="gear" to="/feed" aria-label="Лента и поиск">
              <span aria-hidden="true">⌕</span>
            </Link>
            {/* Справка нужна, когда что-то непонятно, — а это случается здесь. */}
            <Link className="gear" to="/help" aria-label="Справка">
              <span aria-hidden="true">?</span>
            </Link>
            <Link className="gear" to="/settings" aria-label="Настройки">
              <span aria-hidden="true">⚙</span>
              {/* Синхронизация живёт в фоне: точка зовёт в «Настройки». */}
              {mark && <span className={mark} aria-hidden="true" />}
            </Link>
          </div>
        </div>
        <div className="day-nav">
          <button type="button" className="icon-btn" aria-label="Предыдущий день" onClick={() => show(addDays(day, -1))}>
            ‹
          </button>
          {/* Календарь — поле даты браузера: к дню месяцы назад одним выбором. */}
          <input
            type="date"
            name="day"
            className="day-nav__date"
            aria-label="Выбрать день"
            max={today}
            value={day}
            onChange={(event) => {
              // Пустое — поле очистили крестиком: переходить некуда.
              if (event.target.value) show(viewedDay(event.target.value, today))
            }}
          />
          <button
            type="button"
            className="icon-btn"
            aria-label="Следующий день"
            disabled={isToday}
            onClick={() => show(addDays(day, 1))}
          >
            ›
          </button>
        </div>
        <p className="muted">
          {formatDateLong(day)}
          {isToday && ' · сегодня'}
        </p>
        {!isToday && (
          <button type="button" className="link-btn" onClick={() => show(today)}>
            К сегодняшнему дню
          </button>
        )}
      </header>

      {food.status === 'failed' && <p className="error">Записи не прочитались: {food.error}</p>}
      {/* Ключ — день: открытый приём и правка записи — про свой день. */}
      {food.status === 'ready' && <Day key={day} day={day} today={today} data={food.data} hours={hours} />}
    </>
  )
}

function Day({ day, today, data, hours }: { day: DateStr; today: DateStr; data: Data; hours: MealHours }) {
  const isToday = day === today
  const now = useNow(CLOCK_MS, isToday)
  // undefined — приём не выбирали: у сегодняшнего дня открыт текущий.
  const [chosen, setChosen] = useState<Meal | null | undefined>(undefined)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const current = isToday ? currentMeal(now, hours) : null
  const open = chosen === undefined ? current : chosen

  const save: Save = async (action) => {
    setError('')
    try {
      await action()
      return true
    } catch (failure) {
      setError(describe(failure))
      return false
    }
  }

  const dishes = new Map(data.dishes.map((dish) => [dish.id, dish]))
  const meals = dayMeals(data.intake, day)
  const dayRecords = Object.values(meals).flat()
  const live = activeDishes(data.dishes)

  if (live.length === 0 && Object.values(meals).every((records) => records.length === 0)) {
    return (
      <section className="stub block">
        <p>Записывать пока нечего: блюд нет.</p>
        <p className="muted">
          Заведите их на вкладке <Link to="/dishes">«Блюда»</Link> или загрузите списком —{' '}
          <Link to="/settings">«Настройки»</Link> → «Экспорт и импорт» → «Импорт записей».
        </p>
      </section>
    )
  }

  return (
    <>
      {error && <p className="error">{error}</p>}
      {note && (
        <p className="muted" role="status">
          {note}
        </p>
      )}
      {current !== null && (
        <Usual today={today} current={current} data={data} dishes={dishes} save={save} onNote={setNote} />
      )}
      <DayTemplates
        day={day}
        records={dayRecords}
        templates={data.templates}
        dishes={dishes}
        allowed={startedMeals(current)}
        save={save}
        onNote={setNote}
      />
      {MEALS.map((meal) => (
        <MealBlock
          key={meal}
          meal={meal}
          day={day}
          current={meal === current}
          open={meal === open}
          onToggle={() => setChosen(meal === open ? null : meal)}
          records={meals[meal]}
          dayRecords={dayRecords}
          dishes={dishes}
          live={live}
          categories={data.categories}
          templates={data.templates}
          intake={data.intake}
          norms={data.norms}
          save={save}
          onNote={setNote}
        />
      ))}
      {dayRecords.length > 0 && (
        <SaveTemplate kind="day" records={dayRecords} templates={data.templates} dishes={dishes} save={save} onNote={setNote} />
      )}
      <NormsBlock day={day} today={today} data={data} dishes={dishes} />
      <DaySummaryBlock records={dayRecords} dishes={dishes} data={data} />
    </>
  )
}

function MealBlock({
  meal,
  day,
  current,
  open,
  onToggle,
  records,
  dayRecords,
  dishes,
  live,
  categories,
  templates,
  intake,
  norms,
  save,
  onNote,
}: {
  meal: Meal
  day: DateStr
  current: boolean
  open: boolean
  onToggle: () => void
  records: Intake[]
  dayRecords: Intake[]
  dishes: ReadonlyMap<string, Dish>
  live: Dish[]
  categories: Category[]
  templates: Template[]
  intake: Intake[]
  norms: Norm[]
  save: Save
  onNote: (text: string) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const summary =
    records.length === 0 ? 'не записан' : `${records.length} ${plural(records.length, FORMS.dish)}`

  return (
    <section className="block meal">
      <h2 className="fold__head">
        <button type="button" className="fold__btn" aria-expanded={open} onClick={onToggle}>
          {MEAL_NAMES[meal]}
        </button>
        <span className="fold__summary">
          · {summary}
          {current && ' · сейчас'}
        </span>
      </h2>

      {records.length > 0 && (
        <ul className="plain meal__records">
          {records.map((record) =>
            editing === record.id ? (
              <RecordEditor
                key={record.id}
                record={record}
                dish={dishes.get(record.dishId)}
                dayRecords={dayRecords}
                save={save}
                onDone={() => setEditing(null)}
              />
            ) : (
              <RecordRow
                key={record.id}
                record={record}
                dish={dishes.get(record.dishId)}
                onEdit={() => setEditing(record.id)}
              />
            ),
          )}
        </ul>
      )}

      <MealTemplates meal={meal} day={day} records={records} templates={templates} dishes={dishes} save={save} onNote={onNote} />
      <Repeat meal={meal} day={day} records={records} intake={intake} dishes={dishes} save={save} onNote={onNote} />
      {records.length > 0 && (
        <SaveTemplate kind={meal} records={records} templates={templates} dishes={dishes} save={save} onNote={onNote} />
      )}

      {open && (
        <DishPicker
          meal={meal}
          day={day}
          records={records}
          live={live}
          categories={categories}
          intake={intake}
          dishes={dishes}
          norms={norms}
          save={save}
          onNote={onNote}
        />
      )}
    </section>
  )
}

function RecordRow({ record, dish, onEdit }: { record: Intake; dish: Dish | undefined; onEdit: () => void }) {
  const amount = amountText(record)
  return (
    <li className="tblock">
      <button type="button" className="plain-btn tblock__main" aria-label={`Поправить: ${dish?.name ?? 'блюдо'}`} onClick={onEdit}>
        {dish?.name ?? 'Блюдо удалено'}
        {amount && <span className="muted"> · {amount}</span>}
        {record.at && <span className="muted"> · {record.at}</span>}
        {record.note && <span className="tblock__note muted"> {record.note}</span>}
      </button>
    </li>
  )
}

/** Правка записи: приём, порции шагом ½ или граммы, время и заметка — всё по желанию (Р-14, Р-18). */
function RecordEditor({
  record,
  dish,
  dayRecords,
  save,
  onDone,
}: {
  record: Intake
  dish: Dish | undefined
  dayRecords: Intake[]
  save: Save
  onDone: () => void
}) {
  const [input, setInput] = useState<IntakeInput>(() => intakeInput(record))
  const [problem, setProblem] = useState('')

  async function submit() {
    const read = readIntake(input, record, dayRecords)
    if ('problem' in read) {
      setProblem(read.problem)
      return
    }
    if (await save(() => db.put('intake', read.record))) onDone()
  }

  return (
    <li>
      <form
        className="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <p className="lead">{dish?.name ?? 'Блюдо удалено'}</p>
        <label className="field">
          <span>Приём</span>
          <select
            name="intake-meal"
            value={input.meal}
            onChange={(event) => setInput({ ...input, meal: event.target.value as Meal })}
          >
            {MEALS.map((meal) => (
              <option key={meal} value={meal}>
                {MEAL_NAMES[meal]}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>Порции</span>
          <div className="row">
            <button
              type="button"
              className="icon-btn"
              aria-label="Меньше на половину"
              onClick={() => setInput({ ...input, portions: stepPortions(input.portions, -1) })}
            >
              −
            </button>
            <input
              name="intake-portions"
              inputMode="decimal"
              aria-label="Порции"
              value={input.portions}
              onChange={(event) => setInput({ ...input, portions: event.target.value })}
            />
            <button
              type="button"
              className="icon-btn"
              aria-label="Больше на половину"
              onClick={() => setInput({ ...input, portions: stepPortions(input.portions, 1) })}
            >
              +
            </button>
          </div>
        </div>
        <label className="field">
          <span>Граммы — если взвешено; главнее порций</span>
          <input
            name="intake-grams"
            inputMode="decimal"
            value={input.grams}
            onChange={(event) => setInput({ ...input, grams: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Время — по желанию</span>
          <input
            name="intake-at"
            type="time"
            value={input.at}
            onChange={(event) => setInput({ ...input, at: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Заметка</span>
          <input
            name="intake-note"
            value={input.note}
            placeholder="в кафе, изжога"
            onChange={(event) => setInput({ ...input, note: event.target.value })}
          />
        </label>
        {problem && <p className="error">{problem}</p>}
        <div className="form__actions">
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => void save(() => db.remove('intake', record.id)).then((done) => done && onDone())}
          >
            Удалить
          </button>
          <button type="button" className="btn" onClick={onDone}>
            Отмена
          </button>
          <button type="submit" className="btn btn--primary">
            Сохранить
          </button>
        </div>
      </form>
    </li>
  )
}

/**
 * «Как вчера» (Р-08): копия последнего такого же приёма до этого дня, без
 * дублей — одним тапом. Было не вчера — на кнопке дата. Повторять нечего —
 * кнопки нет.
 */
function Repeat({
  meal,
  day,
  records,
  intake,
  dishes,
  save,
  onNote,
}: {
  meal: Meal
  day: DateStr
  records: Intake[]
  intake: Intake[]
  dishes: ReadonlyMap<string, Dish>
  save: Save
  onNote: (text: string) => void
}) {
  const previous = previousMeal(intake, meal, day)
  const items = previous ? repeatItems(previous.records, records) : []
  if (!previous || items.length === 0) return null

  const when = previous.date === addDays(day, -1) ? 'вчера' : formatDate(previous.date)
  const names = items.map((item) => dishes.get(item.dishId)?.name ?? 'блюдо').join(', ')

  async function apply() {
    const made = items.map((item): Intake => ({ id: ulid(), updatedAt: nowIso(), date: day, meal, ...item }))
    if (await save(() => db.putMany('intake', made))) onNote(`${MEAL_NAMES[meal]} — как ${when}: ${names}`)
  }

  return (
    <button type="button" className="link-btn meal__repeat" onClick={() => void apply()}>
      Как {when}: {names}
    </button>
  )
}

/**
 * «Как обычно?» (Р-29) — наверху сегодняшнего дня: вчерашние завтрак, обед
 * и ужин без записей и сегодняшние до текущего приёма. Одним тапом — шаблон
 * или обычные блюда приёма; «Не было» — приём больше не спрашивается. Не
 * складывается: это вопрос, и он уходит, когда на него ответили.
 */
function Usual({
  today,
  current,
  data,
  dishes,
  save,
  onNote,
}: {
  today: DateStr
  current: Meal
  data: Data
  dishes: ReadonlyMap<string, Dish>
  save: Save
  onNote: (text: string) => void
}) {
  // null — отметки «Не было» ещё не прочитаны: без них вопрос мелькнул бы зря.
  const [skipped, setSkipped] = useState<string[] | null>(null)

  useEffect(() => {
    let alive = true
    db.settings
      .get<unknown>(SKIPPED_KEY)
      .then((stored) => alive && setSkipped(readSkipped(stored, today)))
      .catch(() => alive && setSkipped([]))
    return () => {
      alive = false
    }
  }, [today])

  if (skipped === null) return null
  const rows = unansweredMeals(data.intake, today, current, skipped).flatMap((row) => {
    const offer = usualOffer(row.meal, row.date, data.templates, data.intake, dishes)
    return offer ? [{ ...row, offer }] : []
  })
  if (rows.length === 0) return null

  const when = (row: Unanswered) => `${row.date === today ? 'Сегодня' : 'Вчера'}, ${MEAL_NAMES[row.meal].toLowerCase()}`

  async function accept(row: Unanswered & { offer: Offer }) {
    const made = intakeFrom(
      row.offer.items.map((item) => ({ ...item, meal: row.meal })),
      row.date,
    )
    if (await save(() => db.putMany('intake', made))) onNote(`${when(row)} — ${offerText(row.offer, row.meal, dishes)}`)
  }

  async function skip(row: Unanswered) {
    const done = await save(async () => {
      const next = withSkipped(await db.settings.get<unknown>(SKIPPED_KEY), today, row.date, row.meal)
      await db.settings.set(SKIPPED_KEY, next)
      setSkipped(next)
    })
    if (done) onNote(`${when(row)} — не было`)
  }

  return (
    <section className="block usual">
      <h2>Как обычно?</h2>
      <ul className="plain">
        {rows.map((row) => (
          <li key={skipKey(row.date, row.meal)} className="usual__row">
            <p className="usual__what">{when(row)} — не записан</p>
            <div className="row row--wrap">
              <button type="button" className="btn btn--primary usual__yes" onClick={() => void accept(row)}>
                {offerText(row.offer, row.meal, dishes)}
              </button>
              <button type="button" className="btn" onClick={() => void skip(row)}>
                Не было
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Названия блюд через запятую — для кнопок и строки после записи. */
function dishNames(items: readonly { dishId: string }[], dishes: ReadonlyMap<string, Dish>): string {
  return items.map((item) => dishes.get(item.dishId)?.name ?? 'блюдо').join(', ')
}

/**
 * Шаблоны этого приёма (Р-08, Р-28): кнопка — что поставит, без дублей.
 * Ставить нечего — кнопки нет, как у «как вчера».
 */
function MealTemplates({
  meal,
  day,
  records,
  templates,
  dishes,
  save,
  onNote,
}: {
  meal: Meal
  day: DateStr
  records: Intake[]
  templates: Template[]
  dishes: ReadonlyMap<string, Dish>
  save: Save
  onNote: (text: string) => void
}) {
  const offers = templatesOf(templates, meal).flatMap((template) => {
    const { add } = applyTemplate(template, records, [meal], dishes)
    return add.length > 0 ? [{ template, add }] : []
  })

  async function apply(template: Template, add: PlacedItem[]) {
    if (await save(() => db.putMany('intake', intakeFrom(add, day)))) {
      onNote(`${MEAL_NAMES[meal]} — «${template.name}»: ${dishNames(add, dishes)}`)
    }
  }

  return offers.map(({ template, add }) => (
    <button key={template.id} type="button" className="link-btn meal__repeat" onClick={() => void apply(template, add)}>
      «{template.name}»: {dishNames(add, dishes)}
    </button>
  ))
}

/**
 * Шаблоны дня (Р-28) — над приёмами. На сегодня пишут только начавшиеся
 * приёмы: утром шаблон не записывает несъеденный ужин; остальное — позже.
 * На прошлый день — целиком.
 */
function DayTemplates({
  day,
  records,
  templates,
  dishes,
  allowed,
  save,
  onNote,
}: {
  day: DateStr
  records: Intake[]
  templates: Template[]
  dishes: ReadonlyMap<string, Dish>
  allowed: Meal[]
  save: Save
  onNote: (text: string) => void
}) {
  const offers = templatesOf(templates, 'day').flatMap((template) => {
    const applied = applyTemplate(template, records, allowed, dishes)
    return applied.add.length > 0 ? [{ template, ...applied }] : []
  })
  if (offers.length === 0) return null

  const mealList = (meals: readonly Meal[]) => meals.map((meal) => MEAL_NAMES[meal].toLowerCase()).join(', ')
  const mealsOf = (add: readonly PlacedItem[]) => MEALS.filter((meal) => add.some((item) => item.meal === meal))

  async function apply(template: Template, add: PlacedItem[], later: Meal[]) {
    if (await save(() => db.putMany('intake', intakeFrom(add, day)))) {
      const written = `«${template.name}»: ${add.length} ${plural(add.length, FORMS.dish)} — ${mealList(mealsOf(add))}`
      onNote(later.length > 0 ? `${written} · на потом: ${mealList(later)}` : written)
    }
  }

  return (
    <div className="day-templates">
      {offers.map(({ template, add, later }) => (
        <button
          key={template.id}
          type="button"
          className="link-btn meal__repeat"
          onClick={() => void apply(template, add, later)}
        >
          День по шаблону «{template.name}»: {mealList(mealsOf(add))}
        </button>
      ))}
    </div>
  )
}

/**
 * «Сохранить как шаблон» (Р-28): из записанного приёма или всего дня.
 * Название того же вида уже занято — сохранение заменяет состав того шаблона.
 */
function SaveTemplate({
  kind,
  records,
  templates,
  dishes,
  save,
  onNote,
}: {
  kind: TemplateKind
  records: Intake[]
  templates: Template[]
  dishes: ReadonlyMap<string, Dish>
  save: Save
  onNote: (text: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(() => defaultTemplateName(kind))
  const label = kind === 'day' ? 'Сохранить день как шаблон' : 'Сохранить как шаблон'

  if (!open) {
    return (
      <button type="button" className="link-btn meal__save" onClick={() => setOpen(true)}>
        {label}
      </button>
    )
  }

  const check = checkTemplateName(templates, name, kind)
  const items = itemsFromRecords(records, kind === 'day')

  async function submit() {
    if (!check.ok && check.problem !== 'same-kind') return
    const record = check.ok ? createTemplate(templates, name, kind, items) : replaceItems(check.existing, items)
    if (await save(() => db.put('templates', record))) {
      const what = kind === 'day' ? `${items.length} ${plural(items.length, FORMS.dish)}` : dishNames(items, dishes)
      onNote(`${check.ok ? 'Шаблон сохранён' : 'Состав шаблона заменён'} — «${record.name}»: ${what}`)
      setOpen(false)
    }
  }

  const replacing = !check.ok && check.problem === 'same-kind'

  return (
    <form
      className="form template-save"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <label className="field">
        <span>{label} — название</span>
        <input name="template-name" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      {!check.ok && (
        <p className={replacing ? 'muted' : 'error'}>
          {NAME_PROBLEM_TEXT[check.problem]}
          {replacing && ' — его состав заменится записанным'}
        </p>
      )}
      <div className="form__actions">
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          Отмена
        </button>
        <button type="submit" className="btn btn--primary" disabled={!check.ok && !replacing}>
          {replacing ? 'Заменить состав' : 'Сохранить'}
        </button>
      </div>
    </form>
  )
}

/**
 * Выбор блюда в приёме (Р-26): «Частые» сверху, дальше все блюда по
 * категориям, свёрнутыми; тап — запись. Много блюд — поиск над списком,
 * найденное под названиями категорий, и видно, сколько найдено из скольких.
 */
function DishPicker({
  meal,
  day,
  records,
  live,
  categories,
  intake,
  dishes,
  norms,
  save,
  onNote,
}: {
  meal: Meal
  day: DateStr
  records: Intake[]
  live: Dish[]
  categories: Category[]
  intake: Intake[]
  dishes: ReadonlyMap<string, Dish>
  norms: Norm[]
  save: Save
  onNote: (text: string) => void
}) {
  const [query, setQuery] = useState('')
  const present = new Set(records.map((record) => record.dishId))
  const key = normName(query)
  const sections = pickSections(live, categories, intake, meal, day)
  const frequent = frequentDishes(live, intake, meal, day)
  const found = searchSections(sections, query)

  const chips = (list: readonly Dish[]) => (
    <div className="chips">
      {list.map((dish) => (
        <button
          key={dish.id}
          type="button"
          className={present.has(dish.id) ? 'chip chip--on' : 'chip'}
          onClick={() => void tap(dish)}
        >
          {dish.name}
        </button>
      ))}
    </div>
  )

  async function tap(dish: Dish) {
    const result = tapDish(records, dish.id, () => ({ id: ulid(), updatedAt: nowIso(), date: day, meal }))
    if ('blocked' in result) {
      onNote(`«${dish.name}» здесь уже записано в граммах — поправьте ту запись`)
      return
    }
    if (await save(() => db.put('intake', result.record))) {
      const amount = amountText(result.record)
      // Задетые нормы — по записям до тапа: запись в базу уже ушла, а экран
      // перечитает её чуть позже.
      const touches = touchedNorms(norms, intake, dishes, result.record).map(touchText)
      onNote([`${MEAL_NAMES[meal]}: ${dish.name}${amount ? ` — ${amount}` : ''}`, ...touches].join(' · '))
    }
  }

  return (
    <div className="meal__pick">
      {live.length >= SEARCH_FROM && (
        <input
          className="search"
          type="search"
          name={`pick-${meal}`}
          placeholder="Найти блюдо"
          aria-label={`Найти блюдо для приёма «${MEAL_NAMES[meal]}»`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      {key ? (
        <>
          <p className="muted">
            Найдено {sectionsSize(found)} из {live.length}
          </p>
          {found.map((section) => (
            <div key={section.id ?? 'loose'} className="pick__found">
              <h3 className="pick__label">{section.name}</h3>
              {chips(section.dishes)}
            </div>
          ))}
        </>
      ) : (
        <>
          {frequent.length > 0 && (
            <div className="pick__frequent">
              <h3 className="pick__label">Частые</h3>
              {chips(frequent)}
            </div>
          )}
          {/* Что свёрнуто — одно на все приёмы: категория та же. */}
          {sections.map((section) => (
            <Fold
              key={section.id ?? 'loose'}
              id={`pick:${section.id ?? 'loose'}`}
              title={section.name}
              summary={section.dishes.length}
              sub
              folded
            >
              {chips(section.dishes)}
            </Fold>
          ))}
        </>
      )}
    </div>
  )
}

/**
 * Нормы недели просматриваемого дня (Р-25): вся неделя, а не дни до него —
 * запись задним числом отвечает на вопрос недели целиком. Без цвета (Р-23).
 * Норм нет — блока нет.
 */
function NormsBlock({ day, today, data, dishes }: { day: DateStr; today: DateStr; data: Data; dishes: ReadonlyMap<string, Dish> }) {
  const norms = activeNorms(data.norms)
  if (norms.length === 0) return null
  const index = indexDays(data.intake, dishes)

  return (
    <Fold id="today:norms" title="Нормы недели" summary={`${norms.length} ${plural(norms.length, FORMS.norm)}`} folded>
      <p className="muted">{formatPeriod(weekPeriod(day))}</p>
      <table className="stats norms-today">
        <tbody>
          {norms.map((norm) => (
            <tr key={norm.id}>
              <td>{norm.name}</td>
              <td className="num">{normCheckText(norm, checkWeek(norm, index, day))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Link to={weekRoute(day, today)}>Неделя целиком</Link>
    </Fold>
  )
}

/**
 * Итог дня (Р-01, Р-18): порции по группам и категориям, калории с основанием.
 * Группа из одной одноимённой категории — одной строкой. Блюда без категории
 * названы отдельно: итог не прячет записи молча.
 */
function DaySummaryBlock({ records, dishes, data }: { records: Intake[]; dishes: ReadonlyMap<string, Dish>; data: Data }) {
  const summary = summarize(records, dishes, data.categories)
  if (summary.records === 0) return null
  const kcal = kcalText(summary.kcal)

  return (
    <Fold id="today:summary" title="Итог дня" summary={portions(summary.portions)}>
      <div className="day-sum">
        <p className="lead">
          {portions(summary.portions)} в {summary.records} {plural(summary.records, ['записи', 'записях', 'записях'])}
        </p>
        {kcal && <p className="muted">{kcal}</p>}
        <table className="stats">
          <tbody>
            {summary.groups.flatMap((group) => {
              const single = group.categories.length === 1 && (group.name === null || group.name === group.categories[0]?.name)
              if (single) {
                const only = group.categories[0] as CategoryLine
                return [
                  <tr key={only.id}>
                    <td>{only.name}</td>
                    <td className="num">{formatNumber(only.portions)}</td>
                  </tr>,
                ]
              }
              return [
                <tr key={`group:${group.name}`} className="stats__group">
                  <td>{group.name}</td>
                  <td className="num">{formatNumber(group.portions)}</td>
                </tr>,
                ...group.categories.map((line) => (
                  <tr key={line.id}>
                    <td className="stats__sub">{line.name}</td>
                    <td className="num muted">{formatNumber(line.portions)}</td>
                  </tr>
                )),
              ]
            })}
            {summary.looseRecords > 0 && (
              <tr>
                <td>Без категории</td>
                <td className="num">{formatNumber(summary.loose)}</td>
              </tr>
            )}
          </tbody>
        </table>
        {summary.assumed > 0 && (
          <p className="muted">
            В граммах без веса порции — посчитано по одной порции: {summary.assumed}{' '}
            {plural(summary.assumed, FORMS.record)}.
          </p>
        )}
      </div>
    </Fold>
  )
}
