import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { db } from '../app/core.ts'
import { addDays, days as daysText, formatDateLong, formatPeriod, nowIso, plural, weekStart, type DateStr } from '../shared/core/dates.ts'
import { ulid } from '../shared/core/id.ts'
import type { Category, Norm } from '../app/model.ts'
import { activeCategories, sortCategories } from '../modules/food/catalog.ts'
import {
  FORMS,
  formatNumber,
  MEAL_NAMES,
  MEALS,
  normCheckText,
  normHistoryText,
  normRuleText,
  portions,
  WEEKDAYS_SHORT,
} from '../modules/food/labels.ts'
import {
  activeNorms,
  applyNorm,
  checkWeek,
  createNorm,
  indexDays,
  moveNorm,
  MAX_LIMIT_DAYS,
  MIN_LIMIT_DAYS,
  MIN_NORM_DAYS,
  NORM_BARS_WEEKS,
  normHistory,
  normInput,
  readNorm,
  WEEK_DAYS,
  type DayIndex,
  type NormInput,
} from '../modules/food/norms.ts'
import { useFood, type Food } from '../modules/food/useFood.ts'
import { dayHref, loggedText, viewedWeek, weekKcalText, weekSummary, type WeekSummary } from '../modules/food/week.ts'
import { BarChart, MiniBars } from '../shared/ui/BarChart.tsx'
import { Fold } from '../shared/ui/Fold.tsx'
import { useToday } from '../shared/ui/useToday.ts'

type Data = Food['data']

/** Сохранение с ошибкой на экране. true — прошло. */
type Save = (action: () => Promise<unknown>) => Promise<boolean>

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

/**
 * «Неделя» (Р-25): отвечает ли неделя нормам (Р-01, Р-13) — и из чего она
 * была. Нормы здесь же и заводятся.
 *
 * Любая неделя — `?w=` с любым её днём; без параметра — текущая, в будущее
 * не листается. Отклик без цвета (Р-23), неделя в счёт истории — по ясному
 * исходу (Р-24).
 */
export function Week() {
  const today = useToday()
  const [params, setParams] = useSearchParams()
  const monday = viewedWeek(params.get('w'), today)
  const current = weekStart(today)
  const isCurrent = monday === current
  const food = useFood()

  // Текущая — без параметра, как сегодняшний день на «Сегодня».
  const show = (day: DateStr) => {
    const next = viewedWeek(day, today)
    setParams(next === current ? {} : { w: next })
  }

  return (
    <>
      <header className="screen-head">
        <h1>Неделя</h1>
        <div className="day-nav">
          <button type="button" className="icon-btn" aria-label="Предыдущая неделя" onClick={() => show(addDays(monday, -7))}>
            ‹
          </button>
          {/* Календарь — любой день недели ведёт к ней. */}
          <input
            type="date"
            name="week"
            className="day-nav__date"
            aria-label="Выбрать неделю"
            max={today}
            value={monday}
            onChange={(event) => {
              if (event.target.value) show(event.target.value)
            }}
          />
          <button
            type="button"
            className="icon-btn"
            aria-label="Следующая неделя"
            disabled={isCurrent}
            onClick={() => show(addDays(monday, 7))}
          >
            ›
          </button>
        </div>
        <p className="muted">
          {formatPeriod({ from: monday, to: addDays(monday, WEEK_DAYS - 1) })}
          {isCurrent && ' · идёт'}
        </p>
        {!isCurrent && (
          <button type="button" className="link-btn" onClick={() => show(today)}>
            К текущей неделе
          </button>
        )}
      </header>

      {food.status === 'failed' && <p className="error">Записи не прочитались: {food.error}</p>}
      {food.status === 'ready' && <WeekBody key={monday} monday={monday} today={today} data={food.data} />}
    </>
  )
}

function WeekBody({ monday, today, data }: { monday: DateStr; today: DateStr; data: Data }) {
  const [error, setError] = useState('')

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
  const summary = weekSummary(data.intake, dishes, data.categories, monday, today)
  const index = indexDays(data.intake, dishes)

  return (
    <>
      {error && <p className="error">{error}</p>}
      <p className="lead">{loggedText(summary)}</p>
      <NormsBlock monday={monday} today={today} data={data} index={index} save={save} />
      {summary.records > 0 && (
        <>
          <DaysBlock summary={summary} />
          <CompositionBlock summary={summary} />
          <MealsBlock summary={summary} />
          <KcalBlock summary={summary} />
        </>
      )}
    </>
  )
}

// ─── Нормы ─────────────────────────────────────────────────────────────────

function NormsBlock({
  monday,
  today,
  data,
  index,
  save,
}: {
  monday: DateStr
  today: DateStr
  data: Data
  index: DayIndex
  save: Save
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const norms = activeNorms(data.norms)
  const names = new Map(data.categories.map((category) => [category.id, category.name]))

  return (
    <Fold id="week:norms" title="Нормы" summary={`${norms.length} ${plural(norms.length, FORMS.norm)}`}>
      {norms.length === 0 && editing !== 'new' && (
        <p className="muted">
          Норм пока нет. Норма — сколько дней в неделю бывает набор категорий: «сладкое — не больше четырёх
          дней», «овощи — не меньше пяти».
        </p>
      )}
      <ul className="plain">
        {norms.map((norm, at) =>
          editing === norm.id ? (
            <li key={norm.id}>
              <NormEditor norm={norm} data={data} today={today} save={save} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <NormRow
              key={norm.id}
              norm={norm}
              monday={monday}
              today={today}
              index={index}
              names={names}
              first={at === 0}
              last={at === norms.length - 1}
              onMove={(step) => void save(() => db.putMany('norms', moveNorm(data.norms, norm.id, step)))}
              onEdit={() => setEditing(norm.id)}
            />
          ),
        )}
      </ul>
      {editing === 'new' ? (
        <NormEditor data={data} today={today} save={save} onDone={() => setEditing(null)} />
      ) : (
        <button type="button" className="btn" onClick={() => setEditing('new')}>
          Новая норма
        </button>
      )}
    </Fold>
  )
}

function NormRow({
  norm,
  monday,
  today,
  index,
  names,
  first,
  last,
  onMove,
  onEdit,
}: {
  norm: Norm
  monday: DateStr
  today: DateStr
  index: DayIndex
  names: ReadonlyMap<string, string>
  first: boolean
  last: boolean
  /** Ручной порядок (Р-27): тот же — в «Нормах недели» на «Сегодня». */
  onMove: (step: -1 | 1) => void
  onEdit: () => void
}) {
  const check = checkWeek(norm, index, monday)
  const history = normHistory(norm, index, monday, today)
  const bars = history.weeks.slice(-NORM_BARS_WEEKS)
  const categories = norm.categoryIds.map((id) => names.get(id) ?? 'категория удалена').join(', ')

  return (
    <li className="norm">
      <div className="norm__head">
        <button type="button" className="plain-btn tblock__main" aria-label={`Поправить норму: ${norm.name}`} onClick={onEdit}>
          {norm.name}: {normCheckText(norm, check)}
        </button>
        <button type="button" className="icon-btn" aria-label={`${norm.name} — выше`} disabled={first} onClick={() => onMove(-1)}>
          ↑
        </button>
        <button type="button" className="icon-btn" aria-label={`${norm.name} — ниже`} disabled={last} onClick={() => onMove(1)}>
          ↓
        </button>
      </div>
      <p className="muted">
        {normRuleText(norm)} · {categories}
      </p>
      <div className="norm__history">
        <p className="muted">{normHistoryText(history)}</p>
        {bars.length > 0 && (
          <MiniBars
            values={bars.map((each) => each.days)}
            titles={bars.map((each) => `${formatPeriod(each.week)}: ${daysText(each.days)}`)}
          />
        )}
      </div>
    </li>
  )
}

/** Форма нормы (Р-24, Р-25): название, категории по группам, правила, день начала. */
function NormEditor({
  norm,
  data,
  today,
  save,
  onDone,
}: {
  norm?: Norm
  data: Data
  today: DateStr
  save: Save
  onDone: () => void
}) {
  const [input, setInput] = useState<NormInput>(() => normInput(norm))
  const [problem, setProblem] = useState('')
  // Категория в архиве видна, только если уже стоит в норме.
  const shown = sortCategories(data.categories).filter(
    (category) => !category.archived || input.categoryIds.includes(category.id),
  )
  const groups = groupsOf(shown)

  async function submit() {
    const read = readNorm(input, data.categories, today)
    if ('problem' in read) {
      setProblem(read.problem)
      return
    }
    setProblem('')
    const record = norm ? applyNorm(norm, read.changes, nowIso()) : createNorm(data.norms, read.changes, ulid(), nowIso())
    if (await save(() => db.put('norms', record))) onDone()
  }

  function toggle(id: string, on: boolean) {
    const rest = input.categoryIds.filter((each) => each !== id)
    setInput({ ...input, categoryIds: on ? [...rest, id] : rest })
  }

  return (
    <form
      className="form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <label className="field">
        <span>Название</span>
        <input
          name="norm-name"
          value={input.name}
          placeholder="Сладкое"
          onChange={(event) => setInput({ ...input, name: event.target.value })}
        />
      </label>
      <fieldset className="field norm__categories">
        <legend>Категории — день с записью любой из них в счёте</legend>
        {activeCategories(data.categories).length === 0 && (
          <p className="muted">Категорий нет — заведите их на вкладке «Блюда».</p>
        )}
        {groups.map((group) => (
          <div key={group.key}>
            {group.name !== null && <p className="norm__group">{group.name}</p>}
            {group.categories.map((category) => (
              <label key={category.id} className="check">
                <input
                  type="checkbox"
                  name="norm-category"
                  value={category.id}
                  checked={input.categoryIds.includes(category.id)}
                  onChange={(event) => toggle(category.id, event.target.checked)}
                />
                <span>{category.archived ? `${category.name} (в архиве)` : category.name}</span>
              </label>
            ))}
          </div>
        ))}
      </fieldset>
      <label className="field">
        <span>
          Не меньше дней в неделю — от {MIN_NORM_DAYS} до {WEEK_DAYS}, по желанию
        </span>
        <input
          name="norm-min"
          inputMode="numeric"
          value={input.minDays}
          onChange={(event) => setInput({ ...input, minDays: event.target.value })}
        />
      </label>
      <label className="field">
        <span>
          Не больше дней в неделю — от {MIN_LIMIT_DAYS} до {MAX_LIMIT_DAYS}, по желанию
        </span>
        <input
          name="norm-max"
          inputMode="numeric"
          value={input.maxDays}
          onChange={(event) => setInput({ ...input, maxDays: event.target.value })}
        />
      </label>
      <label className="field">
        <span>С какого дня судить — пусто: вся история</span>
        <input
          name="norm-since"
          type="date"
          max={today}
          value={input.since}
          onChange={(event) => setInput({ ...input, since: event.target.value })}
        />
      </label>
      {problem && <p className="error">{problem}</p>}
      <div className="form__actions">
        {norm && (
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => void save(() => db.remove('norms', norm.id)).then((done) => done && onDone())}
          >
            Удалить
          </button>
        )}
        <button type="button" className="btn" onClick={onDone}>
          Отмена
        </button>
        <button type="submit" className="btn btn--primary">
          Сохранить
        </button>
      </div>
    </form>
  )
}

/** Категории по группам в порядке первой категории; без группы — каждая сама. */
function groupsOf(categories: readonly Category[]): { key: string; name: string | null; categories: Category[] }[] {
  const groups: { key: string; name: string | null; categories: Category[] }[] = []
  for (const category of categories) {
    const name = category.group ?? null
    const group = name === null ? undefined : groups.find((each) => each.name === name)
    if (group) group.categories.push(category)
    else groups.push({ key: name ?? category.id, name, categories: [category] })
  }
  return groups
}

// ─── Итоги недели ──────────────────────────────────────────────────────────

/** Подпись дня: «пн 16». */
function dayLabel(date: DateStr, index: number): string {
  return `${WEEKDAYS_SHORT[index] ?? ''} ${Number(date.slice(8))}`
}

/** Порции по дням столбиками; тап — день на «Сегодня». Дни без записей подписаны. */
function DaysBlock({ summary }: { summary: WeekSummary }) {
  const items = summary.days.map((day, index) => ({
    value: day.records > 0 ? day.portions : null,
    label: dayLabel(day.date, index),
    title:
      day.records > 0
        ? `${formatDateLong(day.date)}: ${portions(day.portions)} в ${day.records} ${plural(day.records, ['записи', 'записях', 'записях'])}`
        : `${formatDateLong(day.date)}: ${day.future ? 'ещё не наступил' : 'записей нет'}`,
    href: day.future ? undefined : dayHref(day.date),
    muted: day.records === 0,
  }))

  return (
    <Fold id="week:days" title="По дням" summary={portions(summary.portions)}>
      <BarChart items={items} label="Порции по дням недели" tickText={formatNumber} peakText={formatNumber} />
    </Fold>
  )
}

/** Состав недели (Р-25): группы и категории — порции и в скольких днях. */
function CompositionBlock({ summary }: { summary: WeekSummary }) {
  return (
    <Fold id="week:composition" title="Состав" summary={`${summary.groups.length} ${plural(summary.groups.length, ['группа', 'группы', 'групп'])}`}>
      <table className="stats">
        <thead>
          <tr>
            <th />
            <th className="num">порций</th>
            <th className="num">дней</th>
          </tr>
        </thead>
        <tbody>
          {summary.groups.flatMap((group) => {
            const only = group.categories[0]
            const single = group.categories.length === 1 && only && (group.name === null || group.name === only.name)
            if (single) {
              return [
                <tr key={only.id}>
                  <td>{only.name}</td>
                  <td className="num">{formatNumber(only.portions)}</td>
                  <td className="num">{only.days}</td>
                </tr>,
              ]
            }
            return [
              <tr key={`group:${group.name}`} className="stats__group">
                <td>{group.name}</td>
                <td className="num">{formatNumber(group.portions)}</td>
                <td className="num">{group.days}</td>
              </tr>,
              ...group.categories.map((line) => (
                <tr key={line.id}>
                  <td className="stats__sub">{line.name}</td>
                  <td className="num muted">{formatNumber(line.portions)}</td>
                  <td className="num muted">{line.days}</td>
                </tr>
              )),
            ]
          })}
          {summary.looseRecords > 0 && (
            <tr>
              <td>Без категории</td>
              <td className="num">{formatNumber(summary.loose)}</td>
              <td className="num" />
            </tr>
          )}
        </tbody>
      </table>
      {summary.assumed > 0 && (
        <p className="muted">
          В граммах без веса порции — посчитано по одной порции: {summary.assumed} {plural(summary.assumed, FORMS.record)}.
        </p>
      )}
    </Fold>
  )
}

/** Приёмы по дням: сколько блюд в каждом приёме. Будущих дней нет. */
function MealsBlock({ summary }: { summary: WeekSummary }) {
  return (
    <Fold id="week:meals" title="Приёмы по дням" summary={loggedText(summary).toLowerCase()} folded>
      <table className="stats week-meals">
        <thead>
          <tr>
            <th />
            {MEALS.map((meal) => (
              <th key={meal} className="num">
                {MEAL_NAMES[meal]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {summary.days.map((day, index) =>
            day.future ? null : (
              <tr key={day.date}>
                <td>
                  <a href={dayHref(day.date)}>{dayLabel(day.date, index)}</a>
                </td>
                {MEALS.map((meal) => (
                  <td key={meal} className={day.meals[meal] > 0 ? 'num' : 'num muted'}>
                    {day.meals[meal] > 0 ? day.meals[meal] : '—'}
                  </td>
                ))}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </Fold>
  )
}

/** Калории в среднем за день учёта, с основанием (Р-01). */
function KcalBlock({ summary }: { summary: WeekSummary }) {
  const text = weekKcalText(summary.kcal, summary.logged)
  if (!text) return null
  return (
    <Fold id="week:kcal" title="Калории" summary={`по ${summary.kcal.counted} из ${summary.kcal.total} ${plural(summary.kcal.total, ['записи', 'записей', 'записей'])}`} folded>
      <p>{text.charAt(0).toUpperCase() + text.slice(1)}</p>
      <p className="muted">Калории справочные: считаются только у блюд, где калорийность известна.</p>
    </Fold>
  )
}
