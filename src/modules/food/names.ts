/**
 * Названия справочников и id из них (Р-12).
 *
 * Чистые функции, без React и без базы (02-Архитектура, «Структура кода»).
 * Образец — `modules/time/categories.ts` «Делу Время»; своё здесь — «ё»
 * и лишние пробелы внутри названия не в счёт, и правило одно на категории
 * и блюда.
 */

/** Что есть у категории и у блюда: по этому они ищутся и называются. */
export type Named = { id: string; name: string; deleted?: boolean; archived?: boolean }

/** Приставка id: `cat:` у категории, `dish:` у блюда (Р-12). */
export type IdPrefix = 'cat' | 'dish'

/** Название на экран и в базу: без пробелов по краям и без двойных внутри. */
export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

/**
 * Ключ названия: регистр, «ё» и лишние пробелы не в счёт — то же правило,
 * что у поиска (02-Архитектура, «Заметки по модели»).
 */
export function normName(name: string): string {
  return cleanName(name).toLocaleLowerCase('ru').replace(/ё/g, 'е')
}

/** Одно ли это название. */
export function sameName(a: string, b: string): boolean {
  return normName(a) === normName(b)
}

/** Id, который название даёт само: `cat:каши`, `dish:борщ`. */
export function nameId(prefix: IdPrefix, name: string): string {
  return `${prefix}:${normName(name)}`
}

/**
 * Id по названию. Одинаков на всех устройствах: одно и то же блюдо,
 * заведённое в двух местах до синхронизации, не раздваивается.
 *
 * Занят живой записью — её переименовали, а id остался прежним, —
 * к нему дописывается `suffix`. Занят надгробием — id берётся тот же,
 * и запись оживает.
 */
export function idFor(list: readonly Named[], prefix: IdPrefix, name: string, suffix: string): string {
  const base = nameId(prefix, name)
  const taken = list.find((each) => each.id === base)
  return taken && !taken.deleted ? `${base}:${suffix}` : base
}

/** Живая запись с этим названием, архивная тоже. */
export function findByName<T extends Named>(list: readonly T[], name: string): T | undefined {
  return list.find((each) => !each.deleted && sameName(each.name, name))
}

/** Почему название не годится. */
export type NameProblem = 'empty' | 'duplicate' | 'archived'

/**
 * Годится ли название. `selfId` — при переименовании: своё прежнее
 * название не мешает. Двойник в архиве называется отдельно — его
 * возвращают, а не заводят второй.
 */
export function nameProblem(list: readonly Named[], name: string, selfId?: string): NameProblem | null {
  if (!cleanName(name)) return 'empty'
  const twin = list.find((each) => !each.deleted && each.id !== selfId && sameName(each.name, name))
  if (!twin) return null
  return twin.archived ? 'archived' : 'duplicate'
}
