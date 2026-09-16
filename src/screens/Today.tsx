import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { db } from '../core/db.ts'
import { addDays, formatDateLong, nowIso, plural, type DateStr } from '../core/dates.ts'
import { ulid } from '../core/id.ts'
import type { Dish, Intake, Meal } from '../core/model.ts'
import { activeDishes } from '../modules/food/catalog.ts'
import { dayMeals, tapDish, viewedDay } from '../modules/food/day.ts'
import { amountText, intakeInput, readIntake, stepPortions, type IntakeInput } from '../modules/food/forms.ts'
import { FORMS, MEAL_NAMES, MEALS } from '../modules/food/labels.ts'
import { currentMeal, DEFAULT_MEAL_HOURS, MEAL_HOURS_KEY, readMealHours, type MealHours } from '../modules/food/meals.ts'
import { normName } from '../modules/food/names.ts'
import { useFood, type Food } from '../modules/food/useFood.ts'
import { useNow } from '../ui/useNow.ts'
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
            <Link className="gear" to="/settings" aria-label="Настройки">
              <span aria-hidden="true">⚙</span>
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
      {food.status === 'ready' && <Day key={day} day={day} isToday={isToday} data={food.data} hours={hours} />}
    </>
  )
}

function Day({ day, isToday, data, hours }: { day: DateStr; isToday: boolean; data: Data; hours: MealHours }) {
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
      {MEALS.map((meal) => (
        <MealBlock
          key={meal}
          meal={meal}
          day={day}
          current={meal === current}
          open={meal === open}
          onToggle={() => setChosen(meal === open ? null : meal)}
          records={meals[meal]}
          dayRecords={Object.values(meals).flat()}
          dishes={dishes}
          live={live}
          save={save}
          onNote={setNote}
        />
      ))}
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

      {open && (
        <DishPicker meal={meal} day={day} records={records} live={live} save={save} onNote={onNote} />
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

/** Блюда приёма: тап — запись. Много блюд — поиск над списком, и видно, сколько найдено из скольких. */
function DishPicker({
  meal,
  day,
  records,
  live,
  save,
  onNote,
}: {
  meal: Meal
  day: DateStr
  records: Intake[]
  live: Dish[]
  save: Save
  onNote: (text: string) => void
}) {
  const [query, setQuery] = useState('')
  const present = new Set(records.map((record) => record.dishId))
  const key = normName(query)
  const shown = key ? live.filter((dish) => normName(dish.name).includes(key)) : live

  async function tap(dish: Dish) {
    const result = tapDish(records, dish.id, () => ({ id: ulid(), updatedAt: nowIso(), date: day, meal }))
    if ('blocked' in result) {
      onNote(`«${dish.name}» здесь уже записано в граммах — поправьте ту запись`)
      return
    }
    if (await save(() => db.put('intake', result.record))) {
      const amount = amountText(result.record)
      onNote(`${MEAL_NAMES[meal]}: ${dish.name}${amount ? ` — ${amount}` : ''}`)
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
      {key && (
        <p className="muted">
          Найдено {shown.length} из {live.length}
        </p>
      )}
      <div className="chips">
        {shown.map((dish) => (
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
    </div>
  )
}
