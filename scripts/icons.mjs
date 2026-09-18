/**
 * Иконки PWA «Трапезы» из геометрии public/favicon.svg.
 *
 * Растеризатор и PNG — ядра (`shared/scripts/icons.mjs`, Р-48); здесь — свои
 * цвет и рисунок. Запускается руками (`npm run icons`), результат
 * коммитится. В сборку не входит: иконка меняется раз в год.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BACKGROUND, INK, writeIcons } from '../src/shared/scripts/icons.mjs'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

/**
 * Акцент «Трапезы» — зелёный. Фон общий с «Дневниками» и «Делу Время»,
 * акцент у каждого свой — синий, тёплый, зелёный: три иконки на одном
 * телефоне не должны путаться. Акцент экранов при этом тёплый (Р-44).
 */
const ACCENT = [0x7c, 0xcf, 0x8a]

/**
 * Те же фигуры, что в favicon.svg. Расходиться им нельзя.
 *
 * Круг — скруглённый прямоугольник с радиусом в половину стороны, кольцо —
 * круг цвета фона поверх круга акцента. Всё внутри безопасной зоны maskable:
 * круга в 80% стороны, который система не обрежет никогда.
 */
const SHAPES = [
  // Тарелка сверху: кольцо края
  { x: 74, y: 116, w: 280, h: 280, r: 140, color: ACCENT, alpha: 1 },
  { x: 98, y: 140, w: 232, h: 232, r: 116, color: BACKGROUND, alpha: 1 },
  // Дно тарелки — внутренний круг, приглушённый
  { x: 144, y: 186, w: 140, h: 140, r: 70, color: ACCENT, alpha: 0.35 },
  // Ложка справа: черпак и черенок
  { x: 382, y: 146, w: 44, h: 76, r: 22, color: INK, alpha: 1 },
  { x: 392, y: 206, w: 24, h: 164, r: 12, color: INK, alpha: 1 },
]

writeIcons({ out: OUT, shapes: SHAPES })
