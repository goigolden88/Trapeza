/**
 * О чём напоминает учёт еды (Р-30): сегодня ничего не записано или вчера не
 * записан завтрак, обед или ужин и у приёма нет отметки «Не было» (Р-29).
 *
 * Вчерашний день, а не сегодняшние приёмы: проверку будит браузер, время
 * выбирает он, и в одиннадцать утра «обед не записан» было бы ложью.
 * Вчерашний день закончился — пропуск в нём настоящий.
 *
 * Чистая функция: зовёт её `notify.ts` — и из service worker, и по кнопке
 * «Проверить сейчас».
 */

import { addDays, type DateStr } from '../../core/dates.ts'
import type { Intake } from '../../core/model.ts'
import { MEAL_NAMES } from './labels.ts'
import { MAIN_MEALS, missedMeals } from './usual.ts'

export type Notice = { title: string; body: string }

const TO_TODAY = 'На «Сегодня» — «Как обычно?» одним тапом.'

/**
 * Напоминание о незаполненном дне. Null — напоминать не о чем. `skipped` —
 * отметки «Не было» этого устройства.
 */
export function unfilledNotice(intake: readonly Intake[], today: DateStr, skipped: readonly string[]): Notice | null {
  const missed = missedMeals(intake, addDays(today, -1), MAIN_MEALS, skipped)
  const todayEmpty = !intake.some((record) => !record.deleted && record.date === today)

  if (missed.length > 0) {
    const names = missed.map((meal) => MEAL_NAMES[meal].toLowerCase()).join(', ')
    return {
      title: `Вчера не ${missed.length === 1 ? 'записан' : 'записаны'}: ${names}`,
      body: todayEmpty ? `И сегодня пока ничего. ${TO_TODAY}` : TO_TODAY,
    }
  }
  if (todayEmpty) {
    return { title: 'Сегодня ничего не записано', body: 'Одним тапом — блюдо на «Сегодня»; привычное — «Как обычно?» и шаблоны.' }
  }
  return null
}
