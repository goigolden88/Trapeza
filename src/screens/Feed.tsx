import { useState } from 'react'
import { Link } from 'react-router-dom'
import { feedDateText, feedHeading, filterFeed, groupFeed, recordsText, type FeedItem } from '../core/feed.ts'
import type { RecordKind } from '../core/model.ts'
import { KIND_ORDER, KINDS } from '../registry.ts'
import { Fold } from '../ui/Fold.tsx'
import { monthFoldedByDefault } from '../ui/monthFold.ts'
import { useFeed } from './useFeed.ts'

/**
 * Лента `#/feed` (Р-62): все записи одной хроникой, новые сверху. Взято
 * из «Дневников».
 *
 * «Сегодня» отвечает на вопрос «что делать сегодня», лента — на «что было»:
 * что сделано в августе, когда записана мысль, доехало ли с телефона. Отсюда
 * и устройство: хроника за всё время и поиск по всему сразу, без выбора
 * периода.
 *
 * Лента только читает (Р-59): строка ведёт туда, где запись правится, а у
 * сделанного и прошлого такого места нет — там строка без перехода.
 */
export function Feed() {
  const feed = useFeed()
  const [kind, setKind] = useState<RecordKind | null>(null)
  const [query, setQuery] = useState('')

  if (feed.status === 'loading') return <p className="muted">Открываю базу…</p>
  if (feed.status === 'failed') return <p className="error">База не открылась: {feed.error}</p>

  const total = feed.items.length
  // Чипы только тех видов, что есть: чип на пустой вид — тап, ведущий
  // к «ничего не нашлось».
  const present = KIND_ORDER.filter((each) => feed.items.some((item) => item.kind === each))
  const shown = filterFeed(feed.items, { kind, query })
  const groups = groupFeed(shown, KIND_ORDER)
  // Поиск и отбор раскрывают все месяцы: найденное не прячется (Р-78).
  const filtering = kind !== null || query.trim() !== ''

  const row = (item: FeedItem) => (
    <>
      <span className="feed__date">{feedDateText(item.date)}</span>
      <span className="feed__main">
        <span className="feed__title">{item.title}</span>
        {item.detail && <span className="feed__detail muted">{item.detail}</span>}
      </span>
      {kind === null && <span className="feed__kind muted">{KINDS[item.kind].label}</span>}
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
        <p className="muted">Заметки, план, учёт и обзоры — одной хроникой, новые сверху.</p>
      </header>

      {total === 0 ? (
        <p className="stub">Записей пока нет. Заметки, учтённое время и обзоры появятся здесь сами.</p>
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
            placeholder="Поиск: слова в любом порядке, «март», 12.03.2026"
            onChange={(event) => setQuery(event.target.value)}
          />

          <p className="muted">
            {shown.length === total ? recordsText(total) : `Показано ${shown.length} из ${total}`}
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
                  // Месяц — сворачиваемым блоком (Р-78, Р-82); свёрнутый не рисуется.
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
            Учёт — строкой на день, тап открывает день. Лента только показывает: правится запись на своём
            экране, а у сделанного и прошлого строка без перехода.
          </p>
        </>
      )}
    </>
  )
}
