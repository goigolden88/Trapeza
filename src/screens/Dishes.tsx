import { useState } from 'react'
import { Link } from 'react-router-dom'
import { db } from '../core/db.ts'
import { plural } from '../core/dates.ts'
import { ulid } from '../core/id.ts'
import type { Category, Dish } from '../core/model.ts'
import {
  activeCategories,
  activeDishes,
  archivedCategories,
  archivedDishes,
  createCategory,
  createDish,
  dishesOf,
  intakeUsing,
  moveCategory,
  removeCategoryPlan,
  removeDishPlan,
  restoreCategory,
  sortCategories,
} from '../modules/food/catalog.ts'
import { applyDish, dishFacts, dishInput, nameProblemText, readDish, type DishInput } from '../modules/food/forms.ts'
import { FORMS } from '../modules/food/labels.ts'
import { cleanName, nameProblem, normName } from '../modules/food/names.ts'
import { useFood, writePlan, type Food } from '../modules/food/useFood.ts'
import { Fold } from '../ui/Fold.tsx'

type Data = Food['data']

/** Сохранение с ошибкой на экране. true — прошло. */
type Save = (action: () => Promise<unknown>) => Promise<boolean>

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

function count(n: number, forms: [string, string, string]): string {
  return `${n} ${plural(n, forms)}`
}

/**
 * Экран «Блюда»: справочник блюд и категорий (Р-02, Р-12).
 *
 * Блюда — по категориям, свёрнутыми блоками: категорий два десятка, и экран
 * читается как оглавление. Поиск показывает найденное плоским списком и
 * называет, сколько найдено из скольких (Р-01). Категории и архив —
 * отдельными блоками внизу: в них заходят редко.
 */
export function Dishes() {
  const food = useFood()
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const { data } = food

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

  const dishes = activeDishes(data.dishes)
  const categories = sortCategories(data.categories)
  const known = new Set(categories.map((each) => each.id))
  const loose = dishes.filter((dish) => !dish.categoryId || !known.has(dish.categoryId))

  return (
    <>
      <header className="screen-head">
        <h1>Блюда</h1>
        {food.status === 'ready' && (
          <p className="muted">
            {count(dishes.length, FORMS.dish)} · {count(activeCategories(data.categories).length, FORMS.category)}
          </p>
        )}
      </header>

      {food.status === 'failed' && <p className="error">Блюда не прочитались: {food.error}</p>}
      {error && <p className="error">{error}</p>}

      {food.status === 'ready' && (
        <>
          <NewDish data={data} save={save} />

          {dishes.length === 0 ? (
            <section className="stub block">
              <p>Блюд пока нет. Заведите первое выше или загрузите список целиком:</p>
              <p className="muted">
                <Link to="/settings">«Настройки»</Link> → «Экспорт и импорт» → «Импорт записей» — там же промпт,
                чтобы ИИ собрал список из ваших заметок или таблицы.
              </p>
            </section>
          ) : (
            <>
              <input
                className="search"
                type="search"
                name="dish-search"
                placeholder="Найти блюдо"
                aria-label="Найти блюдо"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />

              {normName(query) ? (
                <Found dishes={dishes} data={data} query={query} save={save} />
              ) : (
                <>
                  {categories
                    .filter((category) => dishesOf(dishes, category.id).length > 0)
                    .map((category) => (
                      <Fold
                        key={category.id}
                        id={`dishes:cat:${category.id}`}
                        title={category.archived ? `${category.name} (в архиве)` : category.name}
                        summary={dishesOf(dishes, category.id).length}
                        folded
                      >
                        <DishList dishes={dishesOf(dishes, category.id)} data={data} save={save} />
                      </Fold>
                    ))}
                  {loose.length > 0 && (
                    <Fold id="dishes:loose" title="Без категории" summary={loose.length} folded>
                      <DishList dishes={loose} data={data} save={save} />
                    </Fold>
                  )}
                </>
              )}
            </>
          )}

          <Fold
            id="dishes:categories"
            title="Категории"
            summary={activeCategories(data.categories).length}
            folded
          >
            <Categories data={data} save={save} />
          </Fold>

          <Archive data={data} save={save} />
        </>
      )}
    </>
  )
}

/** Найденное поиском: без учёта регистра, «ё» и лишних пробелов — как у названий (Р-12). */
function Found({ dishes, data, query, save }: { dishes: Dish[]; data: Data; query: string; save: Save }) {
  const key = normName(query)
  const found = dishes.filter((dish) => normName(dish.name).includes(key))
  return (
    <section className="block">
      <p className="muted">
        Найдено {found.length} из {count(dishes.length, FORMS.dishOf)}
      </p>
      <DishList dishes={found} data={data} save={save} />
    </section>
  )
}

// ─── Блюда ─────────────────────────────────────────────────────────────────

function CategorySelect({
  value,
  categories,
  onChange,
}: {
  value: string
  categories: Category[]
  onChange: (value: string) => void
}) {
  return (
    <label className="field">
      <span>Категория</span>
      <select name="dish-category" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">без категории</option>
        {activeCategories(categories).map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function NewDish({ data, save }: { data: Data; save: Save }) {
  const [input, setInput] = useState<DishInput>(dishInput())
  const [problem, setProblem] = useState('')

  async function submit() {
    const read = readDish(input, data.dishes, data.categories)
    if ('problem' in read) {
      setProblem(read.problem)
      return
    }
    setProblem('')
    const { name, ...fields } = read.changes
    const dish = createDish(data.dishes, name, ulid(), fields)
    if (await save(() => db.put('dishes', dish))) setInput({ ...dishInput(), categoryId: input.categoryId })
  }

  return (
    <Fold id="dishes:new" title="Новое блюдо" folded>
      <form
        className="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <DishFields input={input} categories={data.categories} onChange={setInput} />
        {problem && <p className="error">{problem}</p>}
        <div className="form__actions">
          <button type="submit" className="btn btn--primary" disabled={!input.name.trim()}>
            Добавить
          </button>
        </div>
      </form>
    </Fold>
  )
}

/**
 * Поля блюда. noValidate у формы: пределы проверяет `readDish` и называет
 * причину; браузер перехватил бы её своей подсказкой.
 */
function DishFields({
  input,
  categories,
  onChange,
}: {
  input: DishInput
  categories: Category[]
  onChange: (input: DishInput) => void
}) {
  const number = (key: 'portionGrams' | 'kcal100' | 'kcalPortion', label: string) => (
    <label className="field">
      <span>{label}</span>
      <input
        name={`dish-${key}`}
        inputMode="decimal"
        value={input[key]}
        onChange={(event) => onChange({ ...input, [key]: event.target.value })}
      />
    </label>
  )

  return (
    <>
      <label className="field">
        <span>Название</span>
        <input name="dish-name" value={input.name} onChange={(event) => onChange({ ...input, name: event.target.value })} />
      </label>
      <CategorySelect
        value={input.categoryId}
        categories={categories}
        onChange={(categoryId) => onChange({ ...input, categoryId })}
      />
      {number('portionGrams', 'Порция, г')}
      {number('kcal100', 'Ккал на 100 г')}
      {number('kcalPortion', 'Ккал на порцию — если граммы не подходят')}
    </>
  )
}

function DishList({ dishes, data, save }: { dishes: Dish[]; data: Data; save: Save }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <ul className="plain">
      {dishes.map((dish) => (
        <DishRow
          key={dish.id}
          dish={dish}
          data={data}
          save={save}
          open={open === dish.id}
          onToggle={() => setOpen(open === dish.id ? null : dish.id)}
        />
      ))}
    </ul>
  )
}

function DishRow({
  dish,
  data,
  save,
  open,
  onToggle,
}: {
  dish: Dish
  data: Data
  save: Save
  open: boolean
  onToggle: () => void
}) {
  const facts = dishFacts(dish)
  return (
    <li className="cat">
      <div className="cat__head">
        <button type="button" className="plain-btn cat__name" aria-expanded={open} onClick={onToggle}>
          {dish.name}
          {facts ? <span className="muted"> · {facts}</span> : <span className="muted"> · ккал не известны</span>}
        </button>
      </div>
      {open && <DishEditor dish={dish} data={data} save={save} onDone={onToggle} />}
    </li>
  )
}

function DishEditor({ dish, data, save, onDone }: { dish: Dish; data: Data; save: Save; onDone: () => void }) {
  const [input, setInput] = useState<DishInput>(() => dishInput(dish))
  const [problem, setProblem] = useState('')

  async function submit() {
    const read = readDish(input, data.dishes, data.categories, dish.id)
    if ('problem' in read) {
      setProblem(read.problem)
      return
    }
    setProblem('')
    if (await save(() => db.put('dishes', applyDish(dish, read.changes)))) onDone()
  }

  return (
    <div className="cat__body">
      <form
        className="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <DishFields input={input} categories={data.categories} onChange={setInput} />
        {problem && <p className="error">{problem}</p>}
        <div className="form__actions">
          <button type="button" className="btn" onClick={() => void save(() => db.put('dishes', { ...dish, archived: true }))}>
            В архив
          </button>
          <button type="submit" className="btn btn--primary">
            Сохранить
          </button>
        </div>
      </form>
      <RemoveDish dish={dish} data={data} save={save} />
    </div>
  )
}

/**
 * Удаление блюда: без записей — после подтверждения, с записями или
 * в шаблонах — только переносом в другое блюдо (Р-12).
 */
function RemoveDish({ dish, data, save }: { dish: Dish; data: Data; save: Save }) {
  const [moving, setMoving] = useState<string | null>(null)
  const used = intakeUsing(data.intake, dish.id)
  const needsMove = removeDishPlan(data, dish.id, null) === null
  const targets = activeDishes(data.dishes).filter((each) => each.id !== dish.id)

  function remove(moveTo: string | null) {
    if (needsMove && moveTo === null) {
      setMoving('')
      return
    }
    if (!needsMove && !window.confirm(`Удалить «${dish.name}»? Записей с ним нет.`)) return
    const plan = removeDishPlan(data, dish.id, moveTo)
    if (plan) void save(() => writePlan(plan))
  }

  return (
    <div className="cat__remove">
      <button type="button" className="btn btn--danger" onClick={() => remove(null)}>
        Удалить
      </button>
      {moving !== null && (
        <div className="form">
          <p>
            С «{dish.name}» {count(used, FORMS.record)}
            {used === 0 ? ' и он стоит в шаблонах' : ''}. Удалить можно, только перенеся их в другое блюдо — так же
            сливаются два одинаковых.
          </p>
          <select
            name="dish-move-target"
            aria-label="Куда перенести записи"
            value={moving}
            onChange={(event) => setMoving(event.target.value)}
          >
            <option value="">— выберите блюдо —</option>
            {targets.map((each) => (
              <option key={each.id} value={each.id}>
                {each.name}
              </option>
            ))}
          </select>
          <div className="form__actions">
            <button type="button" className="btn" onClick={() => setMoving(null)}>
              Отмена
            </button>
            <button type="button" className="btn btn--danger" disabled={!moving} onClick={() => remove(moving)}>
              Перенести и удалить
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Категории ─────────────────────────────────────────────────────────────

function Categories({ data, save }: { data: Data; save: Save }) {
  const [name, setName] = useState('')
  const [group, setGroup] = useState('')
  const [problem, setProblem] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const list = activeCategories(data.categories)

  async function add() {
    const found = nameProblem(data.categories, name)
    if (found) {
      setProblem(nameProblemText(found, 'Категория'))
      return
    }
    setProblem('')
    const category = createCategory(data.categories, name, ulid(), group)
    if (await save(() => db.put('categories', category))) {
      setName('')
      setGroup('')
    }
  }

  return (
    <>
      <p className="muted">
        Порядок категорий — порядок в итогах дня. Группа сворачивает категории в сводках: «Супы обычные» и «Супы
        особые» — в «Супы».
      </p>
      <ul className="plain">
        {list.map((category, index) => (
          <CategoryRow
            key={category.id}
            category={category}
            data={data}
            save={save}
            first={index === 0}
            last={index === list.length - 1}
            open={open === category.id}
            onToggle={() => setOpen(open === category.id ? null : category.id)}
          />
        ))}
      </ul>
      <form
        className="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void add()
        }}
      >
        <label className="field">
          <span>Новая категория</span>
          <input name="category-name" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field">
          <span>Группа — по желанию</span>
          <input name="category-group" value={group} onChange={(event) => setGroup(event.target.value)} />
        </label>
        {problem && <p className="error">{problem}</p>}
        <div className="form__actions">
          <button type="submit" className="btn" disabled={!name.trim()}>
            Добавить категорию
          </button>
        </div>
      </form>
    </>
  )
}

function CategoryRow({
  category,
  data,
  save,
  first,
  last,
  open,
  onToggle,
}: {
  category: Category
  data: Data
  save: Save
  first: boolean
  last: boolean
  open: boolean
  onToggle: () => void
}) {
  const [name, setName] = useState(category.name)
  const [group, setGroup] = useState(category.group ?? '')
  const [problem, setProblem] = useState('')
  const own = dishesOf(data.dishes, category.id).length

  function move(step: -1 | 1) {
    void save(() => db.putMany('categories', moveCategory(data.categories, category.id, step)))
  }

  async function submit() {
    const found = nameProblem(data.categories, name, category.id)
    if (found) {
      setProblem(nameProblemText(found, 'Категория'))
      return
    }
    setProblem('')
    const next: Category = { ...category, name: cleanName(name) }
    if (cleanName(group)) next.group = cleanName(group)
    else delete next.group
    await save(() => db.put('categories', next))
  }

  return (
    <li className="cat">
      <div className="cat__head">
        <button type="button" className="plain-btn cat__name" aria-expanded={open} onClick={onToggle}>
          {category.name}
          <span className="muted">
            {category.group ? ` · ${category.group}` : ''} · {count(own, FORMS.dish)}
          </span>
        </button>
        <button type="button" className="icon-btn" aria-label={`${category.name} — выше`} disabled={first} onClick={() => move(-1)}>
          ↑
        </button>
        <button type="button" className="icon-btn" aria-label={`${category.name} — ниже`} disabled={last} onClick={() => move(1)}>
          ↓
        </button>
      </div>

      {open && (
        <div className="cat__body">
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
              <input name="category-rename" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="field">
              <span>Группа</span>
              <input name="category-regroup" value={group} onChange={(event) => setGroup(event.target.value)} />
            </label>
            {problem && <p className="error">{problem}</p>}
            <div className="form__actions">
              <button
                type="button"
                className="btn"
                onClick={() => void save(() => db.put('categories', { ...category, archived: true }))}
              >
                В архив
              </button>
              <button type="submit" className="btn btn--primary">
                Сохранить
              </button>
            </div>
          </form>
          <RemoveCategory category={category} data={data} save={save} />
        </div>
      )}
    </li>
  )
}

/** Удаление категории: пустую — после подтверждения, с блюдами или в нормах — только переносом (Р-12, Р-13). */
function RemoveCategory({ category, data, save }: { category: Category; data: Data; save: Save }) {
  const [moving, setMoving] = useState<string | null>(null)
  const own = dishesOf(data.dishes, category.id).length
  const needsMove = removeCategoryPlan(data, category.id, null) === null
  const targets = activeCategories(data.categories).filter((each) => each.id !== category.id)

  function remove(moveTo: string | null) {
    if (needsMove && moveTo === null) {
      setMoving('')
      return
    }
    if (!needsMove && !window.confirm(`Удалить категорию «${category.name}»? Блюд в ней нет.`)) return
    const plan = removeCategoryPlan(data, category.id, moveTo)
    if (plan) void save(() => writePlan(plan))
  }

  return (
    <div className="cat__remove">
      <button type="button" className="btn btn--danger" onClick={() => remove(null)}>
        Удалить
      </button>
      {moving !== null && (
        <div className="form">
          <p>
            В «{category.name}» {count(own, FORMS.dish)}
            {own === 0 ? ', и она стоит в нормах' : ''}. Удалить можно, только перенеся их в другую категорию — так же
            сливаются две одинаковые.
          </p>
          <select
            name="category-move-target"
            aria-label="Куда перенести блюда"
            value={moving}
            onChange={(event) => setMoving(event.target.value)}
          >
            <option value="">— выберите категорию —</option>
            {targets.map((each) => (
              <option key={each.id} value={each.id}>
                {each.name}
              </option>
            ))}
          </select>
          <div className="form__actions">
            <button type="button" className="btn" onClick={() => setMoving(null)}>
              Отмена
            </button>
            <button type="button" className="btn btn--danger" disabled={!moving} onClick={() => remove(moving)}>
              Перенести и удалить
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Архив ─────────────────────────────────────────────────────────────────

function Archive({ data, save }: { data: Data; save: Save }) {
  const dishes = archivedDishes(data.dishes)
  const categories = archivedCategories(data.categories)
  if (dishes.length === 0 && categories.length === 0) return null

  return (
    <Fold id="dishes:archive" title="Архив" summary={dishes.length + categories.length} folded>
      <p className="muted">Архивное не предлагается при записи, но остаётся в истории и итогах.</p>
      <ul className="plain">
        {categories.map((category) => (
          <li key={category.id} className="cat__head">
            <span className="cat__name">Категория «{category.name}»</span>
            <button
              type="button"
              className="btn"
              onClick={() => void save(() => db.put('categories', restoreCategory(data.categories, category)))}
            >
              Вернуть
            </button>
          </li>
        ))}
        {dishes.map((dish) => (
          <li key={dish.id} className="cat__head">
            <span className="cat__name">{dish.name}</span>
            <button type="button" className="btn" onClick={() => void save(() => db.put('dishes', { ...dish, archived: false }))}>
              Вернуть
            </button>
          </li>
        ))}
      </ul>
    </Fold>
  )
}
