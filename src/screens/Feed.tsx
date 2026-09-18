import { useState } from 'react'
import { Link } from 'react-router-dom'
import { days, plural } from '../shared/core/dates.ts'
import { feedDateText, feedHeading, filterFeed, groupFeed, type FeedItem } from '../shared/core/feed.ts'
import type { RecordKind } from '../app/model.ts'
import { feedItems, KIND_ORDER, KINDS, kindLabel } from '../registry.ts'
import { Fold } from '../shared/ui/Fold.tsx'
import { monthFoldedByDefault } from '../shared/ui/monthFold.ts'
import { useFeed } from '../shared/screens/useFeed.ts'

/**
 * Лента `#/feed`: дни учёта одной хроникой, новые сверху, с поиском.
 * Вход — ⌕ в шапке «Сегодня» (Р-33). Взято из «Делу Время» с d86f0aa, у них
 * — из «Дневников»; их номера помечены хозяином, голые — «Трапезы» (Р-53).
 *
 * «Сегодня» отвечает на вопрос «что я ем сегодня», лента — на «что было»:
 * что я ел в тот день, когда в последний раз была пицца. Отсюда и устройство:
 * хроника за всё время и поиск по всему сразу, без выбора периода.
 *
 * Лента только читает (их Р-59): строка — день, тап открывает его на
 * «Сегодня», где записи и правятся.
 */
/** После «из»: «из 1 дня», «из 3 дней», «из 47 дней». */
const DAYS_OF: [string, string, string] = ['дня', 'дней', 'дней']

export function Feed() {
  const feed = useFeed(feedItems)
  const [kind, setKind] = useState<RecordKind | null>(null)
  const [query, setQuery] = useState('')

  if (feed.status === 'loading') return <p className="muted">Открываю базу…</p>
  if (feed.status === 'failed') return <p className="error">База не открылась: {feed.error}</p>

  const total = feed.items.length
  // Чипы только тех видов, что есть: чип на пустой вид — тап, ведущий
  // к «ничего не нашлось». Вид один — ни чипов, ни подписи вида в строке:
  // «Еда» в каждой строке ничего не говорит (Р-34).
  const present = KIND_ORDER.filter((each) => feed.items.some((item) => item.kind === each))
  const kindShown = kind === null && present.length > 1
  const shown = filterFeed(feed.items, { kind, query })
  const groups = groupFeed(shown, KIND_ORDER)
  // Поиск и отбор раскрывают все месяцы: найденное не прячется (Р-78 «Делу Время»).
  const filtering = kind !== null || query.trim() !== ''

  const row = (item: FeedItem) => (
    <>
      <span className="feed__date">{feedDateText(item.date)}</span>
      <span className="feed__main">
        <span className="feed__title">{item.title}</span>
        {item.detail && <span className="feed__detail muted">{item.detail}</span>}
      </span>
      {kindShown && <span className="feed__kind muted">{kindLabel(item.kind)}</span>}
      {item.link && (
        <span className="feed__go muted" aria-hidden="true">
          ›
        </span>
      )}
    </>
  )

  return (
    <>
      <header className="screen-head">
        <h1>Лента</h1>
        <p className="muted">Что ели по дням — одной хроникой, новые сверху.</p>
      </header>

      {total === 0 ? (
        <p className="stub">Записей пока нет. Дни с записями появятся здесь сами.</p>
      ) : (
        <>
          {present.length > 1 && (
            <div className="chips" role="group" aria-label="Отбор по виду">
              <button
                type="button"
                className={kind === null ? 'chip chip--on' : 'chip'}
                aria-pressed={kind === null}
                onClick={() => setKind(null)}
              >
                Всё
              </button>
              {present.map((each) => (
                <button
                  key={each}
                  type="button"
                  className={each === kind ? 'chip chip--on' : 'chip'}
                  aria-pressed={each === kind}
                  onClick={() => setKind(each)}
                >
                  {KINDS[each].label}
                </button>
              ))}
            </div>
          )}

          <input
            type="search"
            name="search"
            className="search"
            value={query}
            placeholder="Поиск: блюдо, категория, заметка, «март», 12.03.2026"
            aria-label="Поиск по дням"
            onChange={(event) => setQuery(event.target.value)}
          />

          {/* Строка — день, а не запись: и счёт — днями (Р-01). */}
          <p className="muted">
            {shown.length === total ? days(total) : `Показано ${shown.length} из ${total} ${plural(total, DAYS_OF)}`}
          </p>

          {shown.length === 0 && <p className="muted">Под поиск и отбор ничего не подошло.</p>}

          {groups.map((group, index) => {
            const list = (
              <ul className="feed">
                {group.items.map((item) => (
                  <li key={`${item.kind}:${item.id}`}>
                    {item.link ? (
                      <Link className="feed__row" to={item.link}>
                        {row(item)}
                      </Link>
                    ) : (
                      <div className="feed__row">{row(item)}</div>
                    )}
                  </li>
                ))}
              </ul>
            )
            return (
              <div className="month-group" key={group.month ?? 'без даты'}>
                {filtering ? (
                  <>
                    <h3 className="unit__name">
                      {feedHeading(group.month)}
                      <span className="muted"> · {group.items.length}</span>
                    </h3>
                    {list}
                  </>
                ) : (
                  // Месяц — сворачиваемым блоком (Р-78, Р-82 «Делу Время»); свёрнутый не рисуется.
                  <Fold
                    id={`feed:month:${group.month ?? 'undated'}`}
                    title={feedHeading(group.month)}
                    summary={group.items.length}
                    folded={monthFoldedByDefault(index, total)}
                    sub
                  >
                    {list}
                  </Fold>
                )}
              </div>
            )
          })}

          <p className="muted">
            Строка — день: приёмы и блюда, под ней порции и калории. Ищутся и категории, и заметки. Тап
            открывает день на «Сегодня» — там записи и правятся.
          </p>
        </>
      )}
    </>
  )
}
