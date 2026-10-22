/**
 * Демо-данные «Трапезы» (Я-44, Я-45 «FamilyCore»): выдуманные записи каждого
 * хранилища от дня входа в демо — справочник, шаблон приёма, нормы недели,
 * основные приёмы, пять недель еды и пара отметок «Не было». Видно день,
 * неделю, месяц и историю норм: «Сладкое» в прошлой неделе не уложилось.
 *
 * Ядро кладёт записи в базу `trapeza-demo` при её создании и не синхронизирует
 * её. Всё здесь выдумано: репозиторий публичный. Названия справочника — без
 * повторов, id — из названия (Р-12): иначе слияние одноимённых (`watchMerges`)
 * переписало бы демо на первом же запуске. Отметка «Не было» — только у приёма
 * без еды: еда её снимает (Р-59).
 *
 * Функция знает всё приложение — как срез итогов, — поэтому лежит здесь,
 * а не в модуле.
 */

import { addDays, type DateStr } from '../shared/core/dates.ts'
import { ulid } from '../shared/core/id.ts'
import type {
  Category,
  Dish,
  Intake,
  MainMeals,
  Meal,
  Norm,
  Skip,
  StoreRecord,
  SyncedStore,
  Template,
} from '../app/model.ts'
import { nameId } from '../modules/food/names.ts'
import { MAIN_MEALS, MAIN_MEALS_ID } from '../modules/food/skips.ts'

export type DemoData = { [S in SyncedStore]: StoreRecord[S][] }

/**
 * Сколько дней еды в демо, считая день входа: пять недель (Р-62). Столько,
 * чтобы история нормы набрала `NORM_MIN_WEEKS` с запасом, а «Месяц» показал
 * полные недели.
 */
export const DEMO_DAYS = 35

/** Справочник заведён раньше первой записи еды. */
const CATALOG_AGO = DEMO_DAYS + 1

/** `updatedAt` дня и часа по часам устройства — как у записи, сделанной тогда. */
function stamp(date: DateStr, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString()
}

/** Категории: название и укрупнение для сводок (Р-15). */
const CATEGORIES: readonly [name: string, group?: string][] = [
  ['Каши'],
  ['Супы', 'Первое'],
  ['Мясное', 'Второе'],
  ['Рыба', 'Второе'],
  ['Гарниры', 'Второе'],
  ['Овощи и фрукты'],
  ['Выпечка', 'Пироги и сладости'],
  ['Сладости', 'Пироги и сладости'],
  ['Напитки', 'Напитки'],
  ['Сладкие напитки', 'Напитки'],
]

/** Блюда: категория и что известно о порции. «Кефир» — без категории (Р-02), у «Чая» калорий нет. */
const DISHES: readonly [name: string, category: string | null, fields: Pick<Dish, 'portionGrams' | 'kcal100' | 'kcalPortion' | 'recipe'>][] = [
  ['Овсянка', 'Каши', { portionGrams: 250, kcal100: 90 }],
  ['Гречка', 'Каши', { portionGrams: 200, kcal100: 110 }],
  ['Сырники', 'Выпечка', { portionGrams: 150, kcal100: 220 }],
  [
    'Борщ',
    'Супы',
    {
      portionGrams: 300,
      kcal100: 55,
      recipe: 'Свёкла, капуста, картофель, морковь, лук. Бульон — час, овощи — ещё двадцать минут.',
    },
  ],
  ['Куриный суп', 'Супы', { portionGrams: 300, kcal100: 40 }],
  ['Котлета', 'Мясное', { portionGrams: 100, kcal100: 220 }],
  ['Курица запечённая', 'Мясное', { portionGrams: 150, kcal100: 190 }],
  ['Треска', 'Рыба', { portionGrams: 150, kcal100: 100 }],
  ['Картофельное пюре', 'Гарниры', { portionGrams: 200, kcal100: 95 }],
  ['Макароны', 'Гарниры', { portionGrams: 200, kcal100: 150 }],
  ['Салат овощной', 'Овощи и фрукты', { portionGrams: 150, kcal100: 40 }],
  ['Яблоко', 'Овощи и фрукты', { portionGrams: 150, kcal100: 50 }],
  ['Пирожок с капустой', 'Выпечка', { portionGrams: 80, kcal100: 250 }],
  ['Шоколад', 'Сладости', { portionGrams: 25, kcal100: 540 }],
  ['Печенье', 'Сладости', { kcalPortion: 120 }],
  ['Кофе с молоком', 'Напитки', { kcalPortion: 60 }],
  ['Чай', 'Напитки', {}],
  ['Компот', 'Сладкие напитки', { portionGrams: 200, kcal100: 40 }],
  ['Кефир', null, { portionGrams: 200, kcal100: 50 }],
]

/** Что съедено в приёме: блюдо и, по желанию, поля записи. */
type Eaten = [dish: string, extra?: Pick<Intake, 'portions' | 'grams' | 'at' | 'note'>]

/** День еды: приёмы с блюдами. Нет приёма — в него ничего не записано. */
type Menu = Partial<Record<Meal, Eaten[]>>

/** Дни с компотом в обед. */
const COMPOT = [1, 4, 8, 12]

/**
 * Дни с рыбой на ужин. Между 10 и 24 — тринадцать дней без рыбы: в них при
 * любом дне входа целая неделя, и норма «Рыба» в ней не выполнена.
 */
const FISH = [2, 10, 24, 31]

/**
 * Меню дня `ago` дней назад. Последние две недели сладкое — выпечка,
 * сладости, компот — почти через день: в любые семь прошлых дней подряд таких
 * дней больше двух, и норма «Сладкое» в закончившейся неделе не уложилась.
 * Раньше сладкого меньше — сырники раз в четыре дня и один пирожок: в истории
 * нормы недели выходят и выполненными, и нет. Сегодня — только завтрак и перекус: обед
 * и ужин ещё впереди.
 */
function menuOf(ago: number): Menu {
  if (ago === 0) {
    return {
      breakfast: [['Овсянка', { at: '08:15' }], ['Кофе с молоком']],
      snack: [['Яблоко']],
    }
  }

  const menu: Menu = {}

  // Завтрак: обычно овсянка с кофе; в выходной ритм — сырники. День 3 — без
  // завтрака: у него отметка «Не было».
  if (ago !== 3) {
    menu.breakfast =
      ago % 4 === 2 ? [['Сырники'], ['Чай']] : ago % 5 === 4 ? [['Гречка', { grams: 150 }], ['Чай']] : [['Овсянка'], ['Кофе с молоком']]
  }

  // Обед: суп, горячее с гарниром, через день — компот.
  const soup: Eaten = ago % 2 === 0 ? ['Борщ'] : ['Куриный суп']
  const main: Eaten = ago % 3 === 0 ? ['Курица запечённая'] : ['Котлета']
  const side: Eaten = ago % 2 === 0 ? ['Картофельное пюре'] : ['Макароны']
  menu.lunch = ago === 5 ? [['Борщ', { portions: 0.5, note: 'в кафе' }], main, ['Салат овощной']] : [soup, main, side]
  if (COMPOT.includes(ago)) menu.lunch.push(['Компот'])

  // Ужин: рыба в свои дни; день 9 — без ужина, у него отметка.
  if (ago !== 9) {
    menu.dinner =
      FISH.includes(ago)
        ? [['Треска'], ['Салат овощной']]
        : ago % 2 === 0
          ? [['Гречка'], ['Котлета']]
          : [['Курица запечённая'], ['Салат овощной']]
  }

  // Перекус: сладкое в свои дни, в остальные — фрукт или кефир.
  const sweet: Record<number, Eaten[]> = {
    1: [['Шоколад'], ['Чай']],
    2: [['Печенье', { portions: 2 }], ['Чай']],
    6: [['Пирожок с капустой'], ['Чай']],
    9: [['Шоколад']],
    31: [['Пирожок с капустой']],
  }
  menu.snack = sweet[ago] ?? (ago % 3 === 0 ? [['Кефир']] : [['Яблоко']])

  return menu
}

/** Отметки «Не было»: приём без еды и причина. */
const SKIPS: readonly [ago: number, meal: Meal, reason?: string][] = [
  [3, 'breakfast', 'не успел'],
  [9, 'dinner'],
]

/** Часы приёмов — для `updatedAt` записи, когда время не названо. */
const MEAL_TIME: Record<Meal, string> = { breakfast: '08:30', lunch: '13:15', dinner: '19:00', snack: '16:30' }

/** Выдуманные записи каждого хранилища от дня входа в демо. */
export function demo(day: DateStr): DemoData {
  const catalogAt = stamp(addDays(day, -CATALOG_AGO), '10:00')
  const catId = (name: string) => nameId('cat', name)
  const dishId = (name: string) => nameId('dish', name)

  const categories: Category[] = CATEGORIES.map(([name, group], at) => ({
    id: catId(name),
    updatedAt: catalogAt,
    name,
    order: at + 1,
    ...(group ? { group } : {}),
  }))

  const dishes: Dish[] = DISHES.map(([name, category, fields]) => ({
    id: dishId(name),
    updatedAt: catalogAt,
    name,
    ...(category ? { categoryId: catId(category) } : {}),
    ...fields,
  }))

  const templates: Template[] = [
    {
      id: ulid(Date.parse(catalogAt)),
      updatedAt: catalogAt,
      name: 'Обычный завтрак',
      meal: 'breakfast',
      items: [{ dishId: dishId('Овсянка') }, { dishId: dishId('Кофе с молоком') }],
      order: 1,
    },
  ]

  const norm = (name: string, cats: string[], rules: Pick<Norm, 'minDays' | 'maxDays'>, order: number): Norm => ({
    id: ulid(Date.parse(catalogAt)),
    updatedAt: catalogAt,
    name,
    categoryIds: cats.map(catId),
    ...rules,
    order,
  })
  const norms: Norm[] = [
    norm('Сладкое', ['Выпечка', 'Сладости', 'Сладкие напитки'], { maxDays: 2 }, 1),
    norm('Каши', ['Каши'], { minDays: 4 }, 2),
    norm('Рыба', ['Рыба'], { minDays: 1 }, 3),
  ]

  const meals: MainMeals[] = [{ id: MAIN_MEALS_ID, updatedAt: catalogAt, meals: [...MAIN_MEALS] }]

  const intake: Intake[] = []
  for (let ago = DEMO_DAYS - 1; ago >= 0; ago--) {
    const date = addDays(day, -ago)
    for (const [meal, eaten] of Object.entries(menuOf(ago)) as [Meal, Eaten[]][]) {
      for (const [name, extra] of eaten) {
        const updatedAt = stamp(date, extra?.at ?? MEAL_TIME[meal])
        intake.push({ id: ulid(Date.parse(updatedAt)), updatedAt, date, meal, dishId: dishId(name), ...extra })
      }
    }
  }

  const skips: Skip[] = SKIPS.map(([ago, meal, reason]) => {
    const date = addDays(day, -ago)
    const updatedAt = stamp(date, '21:00')
    return { id: ulid(Date.parse(updatedAt)), updatedAt, date, meal, ...(reason ? { reason } : {}) }
  })

  return { categories, dishes, templates, norms, intake, meals, skips }
}
