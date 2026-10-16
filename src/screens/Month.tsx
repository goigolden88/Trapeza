import { useSearchParams } from 'react-router-dom'
import { addMonths, formatPeriod, monthOf, plural, type DateStr, type MonthStr } from '../shared/core/dates.ts'
import { FORMS, normRuleText } from '../modules/food/labels.ts'
import { monthGoing, monthNormText, monthSummary, monthWeeks, viewedMonth } from '../modules/food/month.ts'
import { indexDays } from '../modules/food/norms.ts'
import type { Food } from '../modules/food/useFood.ts'
import { loggedText, weekKcalText } from '../modules/food/week.ts'
import { Fold } from '../shared/ui/Fold.tsx'
import { monthTitle } from './period.ts'

type Data = Food['data']

/** Переключатель «Неделя / Месяц» в шапке экрана (Р-61). */
export function ViewToggle({ month, onWeek, onMonth }: { month: boolean; onWeek: () => void; onMonth: () => void }) {
  return (
    <div className="chips" role="group" aria-label="Неделя или месяц">
      <button type="button" className={month ? 'chip' : 'chip chip--on'} aria-pressed={!month} onClick={onWeek}>
        Неделя
      </button>
      <button type="button" className={month ? 'chip chip--on' : 'chip'} aria-pressed={month} onClick={onMonth}>
        Месяц
      </button>
    </div>
  )
}

/**
 * «Месяц» на экране «Неделя» (Р-61): итог месяца сводкой его недель — нормы
 * числом недель, дни учёта, ккал в среднем на день учёта. Неделя — в месяце
 * своего воскресенья.
 *
 * Месяц — `?m=` рядом с `?w=`: неделя остаётся в адресе, и «Неделя»
 * возвращает к ней. В будущее не листается.
 */
export function Month({ today, food }: { today: DateStr; food: Food }) {
  const [params, setParams] = useSearchParams()
  const month = viewedMonth(params.get('m'), today)
  const current = monthOf(today)
  const week = params.get('w')
  const { weeks, span } = monthWeeks(month)

  const show = (next: MonthStr) => setParams(week === null ? { m: next } : { w: week, m: next })
  const toWeek = () => setParams(week === null ? {} : { w: week })

  return (
    <>
      <header className="screen-head">
        <h1>Месяц</h1>
        <ViewToggle month onWeek={toWeek} onMonth={() => show(month)} />
        <div className="day-nav">
          <button type="button" className="icon-btn" aria-label="Предыдущий месяц" onClick={() => show(addMonths(month, -1))}>
            ‹
          </button>
          <span className="day-nav__month">{monthTitle(month)}</span>
          <button
            type="button"
            className="icon-btn"
            aria-label="Следующий месяц"
            disabled={month >= current}
            onClick={() => show(addMonths(month, 1))}
          >
            ›
          </button>
        </div>
        <p className="muted">
          Недели {formatPeriod(span)}
          {monthGoing(weeks, today) && ' · идёт'}
        </p>
        {month !== current && (
          <button type="button" className="link-btn" onClick={() => show(current)}>
            К текущему месяцу
          </button>
        )}
      </header>

      {food.status === 'failed' && <p className="error">Записи не прочитались: {food.error}</p>}
      {food.status === 'ready' && <MonthBody month={month} today={today} data={food.data} />}
    </>
  )
}

function MonthBody({ month, today, data }: { month: MonthStr; today: DateStr; data: Data }) {
  const dishes = new Map(data.dishes.map((dish) => [dish.id, dish]))
  const index = indexDays(data.intake, dishes)
  const summary = monthSummary(data.intake, dishes, data.categories, data.norms, index, month, today)

  // Пустой месяц — словами, а не нулями: «не ел» и «не записывал» учёт не различает.
  if (summary.records === 0) return <p className="lead">Записей нет</p>

  const kcal = weekKcalText(summary.kcal, summary.logged)
  return (
    <>
      <p className="lead">{loggedText(summary)}</p>
      <Fold id="month:norms" title="Нормы" summary={`${summary.norms.length} ${plural(summary.norms.length, FORMS.norm)}`}>
        {summary.norms.length === 0 ? (
          <p className="muted">Норм пока нет — их заводят на «Неделе».</p>
        ) : (
          <ul className="plain">
            {summary.norms.map((line) => (
              <li key={line.norm.id} className="norm">
                <p>
                  {line.norm.name}: {monthNormText(line)}
                </p>
                <p className="muted">{normRuleText(line.norm)} в неделю</p>
              </li>
            ))}
          </ul>
        )}
      </Fold>
      {kcal && (
        <Fold id="month:kcal" title="Калории" summary={`по ${summary.kcal.counted} из ${summary.kcal.total} ${plural(summary.kcal.total, ['записи', 'записей', 'записей'])}`}>
          <p>{kcal.charAt(0).toUpperCase() + kcal.slice(1)}</p>
          <p className="muted">Калории справочные: считаются только у блюд, где калорийность известна.</p>
        </Fold>
      )}
    </>
  )
}
