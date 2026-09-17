import { useNotes } from '../modules/notes/useNotes.ts'
import { useBlocks } from '../modules/time/useBlocks.ts'

/**
 * Даты всех записей — дни блоков, дни записи и плана заметок: из них
 * собирается выбор месяца и года (Р-77) и периода выгрузки (Р-79). Экран
 * вправе знать оба модуля (Р-10); кривые даты отсеет тот, кто выбирает.
 */
export function useRecordDates(): string[] {
  const time = useBlocks()
  const read = useNotes()
  return [
    ...(time.status === 'ready' ? time.blocks.map((block) => block.date) : []),
    ...(read.notes ?? []).flatMap((note) => [note.capturedOn ?? '', note.plannedFor ?? '']),
  ]
}
