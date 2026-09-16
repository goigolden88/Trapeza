import { Link } from 'react-router-dom'
import { formatDateLong, today } from '../core/dates.ts'

/**
 * Главный экран «Сегодня» — каркас Этапа 0.
 *
 * Свой, а не «Делу Время»: у них здесь план дня и учёт времени (Р-16).
 * Четыре приёма дня, запись и итог появятся в Этапе 1; пока экран честно
 * говорит, что умеет сборка, и ведёт в настройки — там установка и копия.
 *
 * Дата — на момент открытия: смена в полночь без перезапуска (`useToday`)
 * приходит вместе с записью в Этапе 1.
 */
export function Today() {
  return (
    <>
      <header className="screen-head">
        <div className="screen-head__row">
          <h1>Сегодня</h1>
          <div className="screen-head__tools">
            <Link className="gear" to="/settings" aria-label="Настройки">
              <span aria-hidden="true">⚙</span>
            </Link>
          </div>
        </div>
        <p className="muted">{formatDateLong(today())}</p>
      </header>

      <section className="stub block">
        <p>
          Здесь будут приёмы дня — завтрак, обед, ужин и перекус — и что в них съедено. Запись
          появится в одном из следующих обновлений.
        </p>
        <p className="muted">
          Уже сейчас: приложение ставится иконкой на телефон, открывается без сети и обновляется
          само. Установка и копия данных — в <Link to="/settings">настройках</Link>.
        </p>
      </section>
    </>
  )
}
