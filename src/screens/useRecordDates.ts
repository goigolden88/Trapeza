import { useFood } from '../modules/food/useFood.ts'

/**
 * Даты всех записей еды: из них собирается выбор периода выгрузки (Р-34).
 * Экран вправе знать модуль; кривые даты отсеет тот, кто выбирает.
 *
 * Взято из «Делу Время» с d86f0aa (Р-35): у них — дни блоков времени
 * и заметок, у «Трапезы» вид записи один.
 */
export function useRecordDates(): string[] {
  const food = useFood()
  return food.status === 'ready' ? food.data.intake.flatMap((record) => (record.deleted ? [] : [record.date])) : []
}
