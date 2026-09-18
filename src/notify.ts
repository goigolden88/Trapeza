/**
 * Напоминание о незаполненном дне (Р-30).
 *
 * Механика — окно со звуком, тихое вне окна, со звуком не чаще раза в день,
 * журнал пробуждений, разрешение — ядра, `shared/notify.ts` (Р-48). Своё
 * здесь — о чём напоминать: правило дня в `modules/food/remind.ts` и тексты.
 * Тема одна; ключи её дней — `DAY_KEYS` ядра, те же, что лежали в настройках
 * устройства до перевода.
 *
 * Живёт на уровне приложения, рядом с `app.tsx`, а не в ядре: она знает
 * модули. Тот же объект зовут работник (`remind`) и «Настройки» (остальное).
 */

import { DAY_KEYS, createReminders } from './shared/notify.ts'
import { db } from './app/core.ts'
import { unfilledNotice } from './modules/food/remind.ts'
import { readSkipped, SKIPPED_KEY } from './modules/food/usual.ts'

export const reminders = createReminders(db.settings, {
  async topics(day) {
    // «Не было» — отметки этого устройства (Р-29): пропуском не считаются.
    const [intake, skipped] = await Promise.all([db.getAll('intake'), db.settings.get<unknown>(SKIPPED_KEY)])
    return [
      {
        notice: unfilledNotice(intake, day, readSkipped(skipped, day)),
        tag: 'day',
        target: '/',
        loudKey: DAY_KEYS.loud,
        quietKey: DAY_KEYS.quiet,
      },
    ]
  },
  idle: {
    title: 'Напоминать не о чем',
    body: 'Вчерашние приёмы и сегодняшний день записаны. Уведомление пришло, чтобы было видно: они доходят.',
    tag: 'day',
    target: '/',
  },
})
