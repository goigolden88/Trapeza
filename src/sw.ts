/**
 * Service worker приложения.
 *
 * Свой файл, а не собранный плагином: в нём будут напоминания (Этап 4).
 * Без сервера веб-пуш невозможен, и остаётся периодическая фоновая
 * синхронизация — браузер сам будит работника примерно раз в сутки.
 * Работает в Chrome на Android у установленного приложения; на остальных
 * событие просто не придёт. Проверка напоминания и тап по уведомлению
 * берутся из «Делу Время» вместе с `notify.ts` в Этапе 4 (Р-16).
 *
 * Всё прочее здесь повторяет то, что раньше было опциями `generateSW`,
 * и ломать это нельзя: автообновление — главный риск Этапа 0.
 *
 * Ярлык сюда не входит: это обычная навигация, и её отдаёт подмена
 * навигации ниже. Разбор адреса — в `src/launch.ts`.
 */

import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

/**
 * Ровно то, чем работник пользуется. Библиотека типов `webworker` целиком
 * спорит с `DOM`, на котором собрано остальное приложение, а заводить ради
 * одного файла второй tsconfig — дороже десяти строк ниже.
 */
type Scope = {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>
  skipWaiting(): Promise<void>
}

declare const self: Scope

// autoUpdate: новый работник забирает управление сразу, не дожидаясь, пока
// закроются все вкладки. Иначе телефон неделю показывает вчерашнюю сборку.
void self.skipWaiting()
clientsClaim()

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Без подмены навигации открытие без сети по прямой ссылке даёт пустую
// страницу: запрос уходит в сеть, сети нет, показать нечего. В разработке
// index.html в кеше нет, и подмена упала бы на старте работника.
if (!import.meta.env.DEV) {
  registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))
}
