/**
 * Прогон собранного приложения в настоящем браузере.
 *
 * Зачем он есть. Тестов React-экранов в проекте нет и не будет: сломанный
 * экран виден в тот же день, а тесты экранов — самый хрупкий их вид. Но
 * «виден в тот же день» — это день, потраченный на выяснение, вместо минуты
 * до пуша. Этот скрипт закрывает разрыв: он не проверяет вёрстку и не
 * заменяет тесты расчёта, он отвечает на один вопрос — открывается ли
 * приложение и не падает ли оно на обычном пути.
 *
 * Почему не Playwright. Ради одного сценария он тянет свой Chromium
 * и сотню мегабайт в devDependencies. Здесь — уже установленный браузер
 * и протокол отладки поверх WebSocket, встроенного в Node 22+.
 * Ни одной зависимости.
 *
 * Данные не трогает: браузер запускается с пустым временным профилем,
 * и IndexedDB у него свой. На базу в твоём обычном браузере он повлиять
 * не может.
 *
 * Запуск: `npm run smoke`. Собирает сам, поэтому проверяет ровно тот код,
 * который лежит в `src/` сейчас. Падает с ненулевым кодом, если браузер
 * сообщил об ошибке или проверка не сошлась.
 *
 * Обвязка — из «Делу Время» с d86f0aa как есть (Р-06); сценарий — этого
 * проекта. Проверки прибавляются вместе с экранами, по этапам (Р-16).
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { build, preview } from 'vite'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Копия настоящих данных для прогона экранов:
 * `npm run smoke -- --data <файл>`. Путь — от того места, где набрали
 * команду. Нет ключа — обычный сценарий.
 */
const DATA_AT = process.argv.indexOf('--data')
const DATA =
  DATA_AT === -1 ? null : resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[DATA_AT + 1] ?? '')

/** Адрес собранного приложения. Заполняется, когда поднимется сервер. */
let APP = ''

/** Свой порт отладки, чтобы не столкнуться с открытым браузером. */
const DEBUG_PORT = 9333

/**
 * Где искать браузер. Годится любой на Chromium: Chrome, Edge, Chromium.
 * Свой путь задаётся переменной CHROME_PATH.
 */
const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** Отладочный вывод: `SMOKE_DEBUG=1 npm run smoke`. Без переменной молчит. */
const debug = (text) => {
  if (process.env.SMOKE_DEBUG) console.log(`[debug] ${text}`)
}

// ─── Запуск ────────────────────────────────────────────────────────────────

function findBrowser() {
  const found = BROWSERS.find((path) => path && existsSync(path))
  if (!found) {
    throw new Error(
      'Браузер на Chromium не найден. Укажите путь в переменной CHROME_PATH.',
    )
  }
  return found
}

/**
 * Поднимает просмотр собранного приложения.
 *
 * Через API Vite, а не отдельным процессом `npm run preview`: на Windows
 * Node не запускает `.cmd` без оболочки, а с оболочкой ругается на
 * аргументы. Заодно адрес берётся у самого сервера — вместе с `base`
 * из vite.config.ts, и держать его копию здесь не нужно.
 */
async function startServer() {
  // Собираем сами, а не полагаемся на dist от прошлого раза. Прогон,
  // который молча проверяет вчерашнюю сборку, хуже отсутствующего:
  // он показывает зелёное на сломанном коде.
  await build({ root: ROOT, logLevel: 'warn' })

  const server = await preview({ root: ROOT })
  const url = server.resolvedUrls?.local?.[0]
  if (!url) {
    await server.close()
    throw new Error('Сервер просмотра не назвал адрес')
  }

  APP = url
  return server
}

/** Адрес вкладки в протоколе отладки. */
async function pageSocket() {
  for (let i = 0; i < 40; i++) {
    try {
      const tabs = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json())
      const page = tabs.find((tab) => tab.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch {
      // Браузер ещё не открыл порт.
    }
    await sleep(250)
  }
  throw new Error('Браузер не отдал порт отладки')
}

// ─── Разговор с браузером ──────────────────────────────────────────────────

/** Ошибки, о которых сообщил сам браузер. Любая из них валит прогон. */
const problems = []

/** Проверки сценария: что должно было оказаться на экране. */
const checks = []

function check(what, passed, seen = '') {
  checks.push({ what, passed, seen })
}

let socket
let seq = 0
const waiting = new Map()

function connect(url) {
  socket = new WebSocket(url)

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)

    if (message.id !== undefined) {
      waiting.get(message.id)?.(message)
      waiting.delete(message.id)
      return
    }

    // Запрос страницы к GitHub — отвечает подставной репозиторий прогона.
    if (message.method === 'Fetch.requestPaused') {
      void onGitHub(message.params)
      return
    }

    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails
      problems.push(details.exception?.description ?? details.text)
    }

    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      problems.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '))
    }
  }

  return new Promise((done, fail) => {
    socket.onopen = done
    socket.onerror = fail
  })
}

function send(method, params = {}) {
  const id = ++seq
  return new Promise((done) => {
    waiting.set(id, (message) => done(message.result))
    socket.send(JSON.stringify({ id, method, params }))
  })
}

/**
 * Выполняет выражение на странице.
 *
 * Исключение здесь — тоже ошибка прогона: если сценарий не нашёл кнопку,
 * значит экран не тот, каким его считали.
 */
async function run(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    problems.push(result.exceptionDetails.exception?.description ?? 'ошибка в сценарии')
    return null
  }
  return result.result.value
}

/**
 * Помощники, доступные внутри каждого шага сценария.
 *
 * `set` пишет в поле так, как это делает человек: React слушает не
 * присваивание `value`, а событие с нативного сеттера. `blur` через
 * focusout по той же причине — обычный blur не всплывает, и onBlur
 * его не увидит.
 */
const HELPERS = `
  const set = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const blur = (el) => {
    el.blur()
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  }
  const byText = (tag, label) =>
    [...document.querySelectorAll(tag)].find((el) => el.textContent.trim() === label)
  const startsWith = (tag, prefix) =>
    [...document.querySelectorAll(tag)].find((el) => el.textContent.trim().startsWith(prefix))
`

// Точка с запятой между помощниками и шагом: шаг, начатый с `[` или `(`,
// иначе склеился бы с последней строкой помощников в одно выражение.
const act = (body) => run(`(() => {${HELPERS};\n${body}\n})()`)

/** Текст всего экрана. По нему и делаются проверки. */
const screen = () => run('document.querySelector("#root")?.innerText ?? ""')

/**
 * Есть ли на экране такой текст.
 *
 * Сравнение без учёта регистра и неразрывных пробелов. Заголовки блоков
 * рисуются капителью средствами CSS, и `innerText` отдаёт их прописными;
 * суммы пишутся с неразрывным пробелом между разрядами. Ни то ни другое
 * к смыслу проверки отношения не имеет, а ловушка тут злая: проверка вида
 * «этого текста больше нет» проходит ложно просто потому, что регистр
 * оказался другим.
 */
function has(text, needle) {
  const flat = (value) => value.replace(/\u00A0/g, ' ').toLowerCase()
  return flat(text).includes(flat(needle))
}

/** Переход по хеш-роутингу с ожиданием перерисовки. */
async function go(hash) {
  await run(`location.hash = ${JSON.stringify(hash)}`)
  await sleep(700)
}

/** Разворачивает блок по заголовку, если он свёрнут. */
async function unfold(title) {
  await act(`
    const button = [...document.querySelectorAll('.fold__btn')]
      .find((el) => el.textContent.trim() === ${JSON.stringify(title)})
    if (button?.getAttribute('aria-expanded') === 'false') button.click()
  `)
  await sleep(400)
}

/**
 * Полная загрузка страницы по адресу — как её открывает Android
 * из ярлыка. Адрес должен отличаться от текущего не только
 * хешем: иначе браузер сменит хеш без загрузки, и приём проверен не будет.
 */
async function open(url) {
  await send('Page.navigate', { url })
  await sleep(2000)
}

/** Сеть вкл/выкл — для проверки работы из кеша service worker. */
async function offline(on) {
  await send('Network.enable')
  await send('Network.emulateNetworkConditions', {
    offline: on,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })
}

// ─── Подставной GitHub ─────────────────────────────────────────────────────

/**
 * Репозиторий данных в памяти прогона (Этап 2). Блок взят из прогона
 * «Делу Время» с d86f0aa; своё — только имя репозитория. Запросы страницы
 * к api.github.com перехватываются протоколом отладки и обслуживаются
 * здесь: сеть не нужна, настоящий репозиторий не трогается.
 *
 * Отвечает теми кодами, что GitHub: 409 «Git Repository is empty» у пустого
 * репозитория — ровно на нём споткнулась первая интеграция «Дневников»,
 * 422 на сдвиг ветки не с головы, 401 на чужой токен. Отпечаток файла —
 * настоящий git blob sha: по нему приложение решает, что скачивать
 * и что отправлять.
 */
const GOOD_TOKEN = 'github_pat_smoke'
const REPO = 'me/trapeza-data'
const TOKEN_EXPIRES = '2027-09-01 12:00:00 +0300'

const github = {
  /** Голова ветки main. Null — в репозитории ни одного коммита. */
  head: null,
  /** sha коммита → { tree, parent, message } */
  commits: new Map(),
  /** sha дерева → Map путь → sha файла */
  trees: new Map(),
  /** sha файла → содержимое */
  blobs: new Map(),
  /** Токен не принимается — 401 на всё. */
  reject: false,
  /** Связи нет — запрос обрывается, как без сети. */
  down: false,
  seq: 0,
}

function blobSha(content) {
  const body = Buffer.from(content, 'utf8')
  return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${body.length}\0`), body])).digest('hex')
}

function nextSha(kind) {
  github.seq += 1
  return createHash('sha1').update(`${kind}:${github.seq}`).digest('hex')
}

function putBlob(content) {
  const sha = blobSha(content)
  github.blobs.set(sha, content)
  return sha
}

function putTree(files) {
  const sha = nextSha('tree')
  github.trees.set(sha, files)
  return sha
}

function putCommit(tree, parent, message) {
  const sha = nextSha('commit')
  github.commits.set(sha, { tree, parent, message })
  return sha
}

/** Файлы дерева — по sha дерева или коммита: GitHub принимает оба. */
function filesAt(sha) {
  return github.trees.get(sha) ?? github.trees.get(github.commits.get(sha)?.tree) ?? new Map()
}

/** Файлы на голове ветки: путь → содержимое. */
function repoFiles() {
  return Object.fromEntries([...filesAt(github.head)].map(([path, sha]) => [path, github.blobs.get(sha)]))
}

/** Записи файла на голове ветки. Нет файла — пусто, не JSON — null. */
function repoRecords(path) {
  try {
    return JSON.parse(repoFiles()[path] ?? '[]')
  } catch {
    return null
  }
}

function commitCount() {
  let count = 0
  for (let sha = github.head; sha; sha = github.commits.get(sha)?.parent ?? null) count += 1
  return count
}

/** Коммит «с другого устройства» — прямо в ветку, мимо приложения. */
function commitFromOtherDevice(changes) {
  const files = new Map(filesAt(github.head))
  for (const [path, records] of Object.entries(changes)) {
    files.set(path, putBlob(`${JSON.stringify(records, null, 2)}\n`))
  }
  github.head = putCommit(putTree(files), github.head, 'Другое устройство')
}

/** Ответ на запрос приложения: { status, body }. */
function answer(request, text) {
  const auth = Object.entries(request.headers).find(([name]) => name.toLowerCase() === 'authorization')?.[1]
  if (github.reject || auth !== `Bearer ${GOOD_TOKEN}`) return { status: 401, body: { message: 'Bad credentials' } }

  const method = request.method
  const path = new URL(request.url).pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '')
  const data = text ? JSON.parse(text) : {}
  let match

  if (method === 'GET' && path === '') {
    return {
      status: 200,
      body: { full_name: REPO, private: true, default_branch: 'main', permissions: { push: true } },
    }
  }

  if (method === 'GET' && path === '/git/ref/heads/main') {
    return github.head
      ? { status: 200, body: { object: { sha: github.head } } }
      : { status: 409, body: { message: 'Git Repository is empty.' } }
  }

  if (method === 'PUT' && path.startsWith('/contents/')) {
    if (github.head) return { status: 422, body: { message: 'Invalid request. "sha" wasn\'t supplied.' } }
    const file = decodeURIComponent(path.slice('/contents/'.length))
    const content = Buffer.from(data.content, 'base64').toString('utf8')
    github.head = putCommit(putTree(new Map([[file, putBlob(content)]])), null, data.message)
    return { status: 201, body: { commit: { sha: github.head } } }
  }

  if (method === 'GET' && (match = /^\/git\/trees\/(\w+)$/.exec(path))) {
    const files = filesAt(match[1])
    // Как у GitHub: с recursive=1 в дереве и каталоги — приложение их отбрасывает.
    const dirs = [...new Set([...files.keys()].filter((each) => each.includes('/')).map((each) => each.split('/')[0]))]
    return {
      status: 200,
      body: {
        tree: [
          ...dirs.map((dir) => ({ path: dir, sha: nextSha('dir'), type: 'tree' })),
          ...[...files].map(([file, sha]) => ({ path: file, sha, type: 'blob' })),
        ],
        truncated: false,
      },
    }
  }

  if (method === 'GET' && (match = /^\/git\/blobs\/(\w+)$/.exec(path))) {
    const content = github.blobs.get(match[1])
    return content === undefined
      ? { status: 404, body: { message: 'Not Found' } }
      : { status: 200, body: { content: Buffer.from(content, 'utf8').toString('base64'), encoding: 'base64' } }
  }

  if (method === 'POST' && path === '/git/trees') {
    const files = new Map(filesAt(data.base_tree))
    for (const entry of data.tree) files.set(entry.path, putBlob(entry.content))
    return { status: 201, body: { sha: putTree(files) } }
  }

  if (method === 'POST' && path === '/git/commits') {
    return { status: 201, body: { sha: putCommit(data.tree, data.parents[0] ?? null, data.message) } }
  }

  if (method === 'PATCH' && path === '/git/refs/heads/main') {
    const commit = github.commits.get(data.sha)
    if (!commit || commit.parent !== github.head) {
      return { status: 422, body: { message: 'Update is not a fast forward' } }
    }
    github.head = data.sha
    return { status: 200, body: { object: { sha: data.sha } } }
  }

  return { status: 404, body: { message: `Подставной GitHub не знает ${method} ${path}` } }
}

const CORS = [
  { name: 'Access-Control-Allow-Origin', value: '*' },
  { name: 'Access-Control-Expose-Headers', value: 'github-authentication-token-expiration' },
]

/**
 * Перехваченный запрос. Отвечает всегда: запрос без ответа повис бы,
 * и прогон ждал бы его молча.
 */
async function onGitHub({ requestId, request }) {
  debug(`перехвачен ${request.method} ${request.url}`)
  if (github.down) {
    await send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' })
    return
  }

  if (request.method === 'OPTIONS') {
    await send('Fetch.fulfillRequest', {
      requestId,
      responseCode: 204,
      responseHeaders: [
        ...CORS,
        { name: 'Access-Control-Allow-Methods', value: 'GET, POST, PATCH, PUT' },
        { name: 'Access-Control-Allow-Headers', value: 'Authorization, Content-Type, Accept, X-GitHub-Api-Version' },
      ],
    })
    return
  }

  let reply
  let text = ''
  try {
    text =
      request.postData ??
      (request.postDataEntries ?? []).map((entry) => Buffer.from(entry.bytes ?? '', 'base64').toString('utf8')).join('')
    reply = answer(request, text)
  } catch (failure) {
    reply = { status: 500, body: { message: `Подставной GitHub упал: ${failure}` } }
  }
  debug(`github ${request.method} ${request.url} → ${reply.status}; тело ${text.length}, hasPostData ${request.hasPostData}`)

  await send('Fetch.fulfillRequest', {
    requestId,
    responseCode: reply.status,
    responseHeaders: [
      ...CORS,
      { name: 'Content-Type', value: 'application/json; charset=utf-8' },
      { name: 'github-authentication-token-expiration', value: TOKEN_EXPIRES },
    ],
    body: Buffer.from(JSON.stringify(reply.body), 'utf8').toString('base64'),
  })
}

/** Месяц `ГГГГ-ММ` по часам этого компьютера — как `today()` в приложении. */
function localMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// ─── Сценарий ──────────────────────────────────────────────────────────────

/** Базовый адрес сайта (Р-10). С ним согласованы манифест и работник. */
const BASE = '/Trapeza/'

/**
 * Каркас Этапа 0: сайт по своему адресу, манифест с ярлыком, «Сегодня»,
 * настройки, копия файлом туда и обратно, работа без сети. Любая ошибка
 * в консоли валит прогон.
 */
async function scenario() {
  await send('Runtime.enable')
  await send('Page.enable')
  // Скачанное — во временный профиль, который удаляется после прогона.
  // Без этого безголовый Chrome клал выгрузку в «Загрузки» человека.
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: profile })

  // ─ Манифест и base. Главный тихий риск каркаса: сборка зелёная,
  // страница белая. Проверяется собранное, а не исходник.
  const base = new URL(APP).pathname
  check(`приложение отдаётся по ${BASE}`, base === BASE, APP)

  const manifest = await fetch(new URL('manifest.webmanifest', APP)).then((r) => r.json())
  const shortcutIcons = (manifest.shortcuts ?? []).flatMap((each) => each.icons ?? [])
  const paths = [
    manifest.id,
    manifest.start_url,
    manifest.scope,
    ...manifest.icons.map((icon) => icon.src),
    ...(manifest.shortcuts ?? []).map((each) => each.url),
    ...shortcutIcons.map((icon) => icon.src),
  ]
  const outside = paths.filter((path) => typeof path !== 'string' || !path.startsWith(BASE))
  check(`в манифесте id, start_url, scope, иконки и ярлыки — под ${BASE}`, outside.length === 0, outside.join(', '))
  check('в манифесте имя «Трапеза»', manifest.name === 'Трапеза' && manifest.short_name === 'Трапеза', manifest.name)

  const icons = [...new Set([...manifest.icons, ...shortcutIcons].map((icon) => icon.src))]
  const served = await Promise.all(
    icons.map((src) => fetch(new URL(src, APP)).then((r) => `${src} ${r.status}`)),
  )
  check('иконки манифеста отдаются', served.every((each) => each.endsWith(' 200')), served.join('; '))

  check(
    'ярлык один — «Записать» на ?go=write — Р-16',
    (manifest.shortcuts ?? []).map((each) => `${each.name} ${each.url}`).join('; ') === `Записать ${BASE}?go=write`,
    (manifest.shortcuts ?? []).map((each) => `${each.name} ${each.url}`).join('; '),
  )
  check('«Поделиться» не объявлено', manifest.share_target === undefined, JSON.stringify(manifest.share_target))

  // ─ Первый запуск.
  await open(APP)
  const start = await screen()
  check(
    '«Сегодня» открылось; пустая база ведёт к блюдам и импорту',
    has(start, 'Сегодня') && has(start, 'блюд нет') && has(start, 'Импорт записей'),
    start.replace(/\s+/g, ' ').slice(0, 120),
  )
  const database = await run(`indexedDB.databases().then((list) => list.map((each) => each.name).join(', '))`)
  check('база называется trapeza — Р-10', database === 'trapeza', `базы: ${database}`)

  // ─ Ярлык: адрес с ?go=, а не с #.
  await open(`${APP}?go=write`)
  const writeAt = await run('({ hash: location.hash, search: location.search })')
  check(
    'ярлык «Записать» открывает «Сегодня», ?go из адреса ушёл',
    writeAt?.hash === '#/' && writeAt?.search === '' && has(await screen(), 'Сегодня'),
    JSON.stringify(writeAt),
  )
  await open(`${APP}?go=nowhere`)
  const unknownHash = await run('location.hash')
  check('ярлык на незнакомый экран открывает главный, а не пустоту', unknownHash === '#/', `хеш ${unknownHash}`)

  // ─ Настройки: шестерёнкой, разделы свёрнуты, у свёрнутой копии — итог.
  await act(`document.querySelector('[aria-label="Настройки"]')?.click()`)
  await sleep(700)
  const settings = await screen()
  check(
    'настройки открываются шестерёнкой, разделы свёрнуты',
    has(settings, 'О приложении') && has(settings, 'Экспорт и импорт') && !has(settings, 'Версия схемы'),
    settings.replace(/\s+/g, ' ').slice(0, 160),
  )
  check('у свёрнутого «Экспорт и импорт» видно, что копии нет', has(settings, 'копии нет'))
  check(
    'в «Настройках» синхронизация — первым разделом',
    settings.indexOf('СИНХРОНИЗАЦИЯ') !== -1 && settings.indexOf('СИНХРОНИЗАЦИЯ') < settings.indexOf('ЭКСПОРТ И ИМПОРТ'),
    settings.replace(/\s+/g, ' ').slice(0, 120),
  )

  await unfold('О приложении')
  const about = await screen()
  check(
    'в «О приложении» — схема, сборка и пять хранилищ',
    has(about, 'Версия схемы') &&
      has(about, 'Сборка') &&
      ['Категории', 'Блюда', 'Шаблоны приёмов', 'Нормы недели', 'Записи еды'].every((label) => has(about, label)),
    line(about, 'Записи еды'),
  )
  check(
    'в «О приложении» — как установить',
    has(about, 'Установка') && (has(about, 'Установить') || has(about, 'меню браузера')),
    about.replace(/\s+/g, ' ').slice(0, 200),
  )
  await unfold('Что нового')
  check('«Что нового» — история «Трапезы», а не «Делу Время»', has(await screen(), 'Первая сборка «Трапезы»'))

  // ─ Копия файлом: туда и обратно.
  await unfold('Экспорт и импорт')
  await act(`byText('button', 'Сохранить в файл')?.click()`)
  await sleep(1500)
  check('копия сохраняется в файл', has(await screen(), 'Файл сохранён'))

  const saved = readdirSync(profile).find((name) => /^trapeza-\d{4}-\d{2}-\d{2}\.json$/.test(name))
  let snapshot = null
  try {
    snapshot = saved ? JSON.parse(readFileSync(join(profile, saved), 'utf8')) : null
  } catch {
    snapshot = null
  }
  const stores = Object.keys(snapshot?.data ?? {}).sort().join(', ')
  check(
    'в файле копии — схема 1 и пять хранилищ, токена нет',
    snapshot?.schemaVersion === 1 &&
      stores === 'categories, dishes, intake, norms, templates' &&
      !JSON.stringify(snapshot).includes('syncToken'),
    saved ? `${saved}: ${stores}` : `файла нет: ${readdirSync(profile).filter((name) => name.endsWith('.json')).join(', ')}`,
  )

  // Запись с другого устройства — тем же путём, что у человека,
  // «Восстановить из копии». Экрана записей ещё нет: видно по счётчику.
  const restore = join(profile, 'restore.json')
  writeFileSync(
    restore,
    JSON.stringify({
      schemaVersion: 1,
      exportedAt: '2026-02-03T10:00:00.000Z',
      data: {
        dishes: [{ id: 'dish:борщ', updatedAt: '2026-02-03T10:00:00.000Z', name: 'Борщ' }],
        intake: [
          {
            id: '01JKXAMPLE0000000000000000',
            updatedAt: '2026-02-03T10:00:00.000Z',
            date: '2026-02-03',
            meal: 'lunch',
            dishId: 'dish:борщ',
          },
        ],
      },
    }),
  )
  const { root } = await send('DOM.getDocument')
  // Поле копии: у него в списке типов есть text/plain. У поля импорта записей — нет.
  const { nodeId } = await send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: 'input[type=file][accept*="text/plain"]',
  })
  await send('DOM.setFileInputFiles', { nodeId, files: [restore] })
  await sleep(1000)
  const restored = await screen()
  check('копия восстанавливается из файла', has(restored, 'Загружено записей: 2'), line(restored, 'Загружено'))
  check(
    'после восстановления — в базе блюдо и запись',
    /Блюда\s*1/.test(restored.replace(/ /g, ' ')) && /Записи еды\s*1/.test(restored.replace(/ /g, ' ')),
    `${line(restored, 'Блюда')}; ${line(restored, 'Записи еды')}`,
  )

  // ─ Импорт записей текстом, как ответ ИИ: в блоке ```json. Борщ уже есть —
  // пропуск; категория из того же файла заводится один раз (02-Архитектура).
  await unfold('Импорт записей')
  const importFile = {
    format: 'trapeza-import',
    version: 1,
    categories: [{ name: 'Супы', group: 'Первое' }],
    dishes: [
      { name: 'борщ', category: 'Супы', portionGrams: 300, kcal100: 50 },
      { name: 'Компот', category: 'Напитки', kcalPortion: 80 },
    ],
    intake: [
      { date: '2026-02-02', meal: 'lunch', dish: 'Компот' },
      { date: '2026-02-04', meal: 'lunch', dish: 'Компот', portions: 2 },
    ],
  }
  const importText = `Вот файл:\n\`\`\`json\n${JSON.stringify(importFile)}\n\`\`\``
  await act(`
    set(document.querySelector('.import__text'), ${JSON.stringify(importText)})
    byText('button', 'Разобрать')?.click()
  `)
  await sleep(700)
  const planned = await screen()
  check(
    'импорт: до записи — сводка, уже имеющееся названо',
    has(planned, 'Добавится: 2 категории, 1 блюдо, 2 записи еды') && has(planned, 'пропущено, не перезаписано: 1'),
    `${line(planned, 'Добавится')}; ${line(planned, 'пропущено')}`,
  )
  await act(`startsWith('button', 'Загрузить')?.click()`)
  await sleep(1000)
  const imported = await screen()
  // Строка счётчика — название и число в начале строки: в тексте импорта
  // выше те же слова встречаются в предложении.
  const counts = (text) =>
    ['Категории', 'Блюда', 'Записи еды'].map(
      (label) => `${label} ${new RegExp(`(?:^|\\n)${label}\\s+(\\d+)`).exec(text)?.[1] ?? '?'}`,
    )
  check('импорт записывает по кнопке', has(imported, 'Загружено записей: 5'), line(imported, 'Загружено'))
  check(
    'после импорта — две категории, два блюда, три записи',
    counts(imported).join('; ') === 'Категории 2; Блюда 2; Записи еды 3',
    counts(imported).join('; '),
  )
  await unfold('Как подготовить файл')
  await unfold('Показать промпт')
  const prompt = await screen()
  check('промпт — «Трапезы», с разделами еды', has(prompt, '"format": "trapeza-import"') && has(prompt, '"dishes" —'))

  // ─ «Блюда»: вкладка, блюда по категориям, новое блюдо формой.
  await act(`byText('a', 'Блюда')?.click()`)
  await sleep(700)
  const dishesScreen = await screen()
  check(
    '«Блюда» открываются вкладкой: итог и блоки категорий',
    has(dishesScreen, '2 блюда · 2 категории') && has(dishesScreen, 'Напитки') && has(dishesScreen, 'Без категории'),
    dishesScreen.replace(/\s+/g, ' ').slice(0, 160),
  )
  await unfold('Новое блюдо')
  await act(`
    set(document.querySelector('[name="dish-name"]'), 'Щи')
    const select = document.querySelector('[name="dish-category"]')
    select.value = 'cat:супы'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    set(document.querySelector('[name="dish-portionGrams"]'), '350')
    set(document.querySelector('[name="dish-kcal100"]'), '32,5')
  `)
  await act(`byText('button', 'Добавить')?.click()`)
  await sleep(700)
  await unfold('Супы')
  const withShchi = await screen()
  check(
    'новое блюдо заводится формой, в свою категорию, с калорийностью',
    has(withShchi, '3 блюда') && has(withShchi, 'Щи · порция 350 г · 32,5 ккал/100 г'),
    line(withShchi, 'Щи'),
  )

  // ─ Слияние одноимённых (Р-12): «БОРЩ» с другого устройства, пришедший
  // копией, сливается с «Борщом» сам — содержимое от поздней правки.
  await go('/settings')
  const twin = join(profile, 'twin.json')
  writeFileSync(
    twin,
    JSON.stringify({
      schemaVersion: 1,
      exportedAt: '2026-09-01T10:00:00.000Z',
      data: {
        dishes: [{ id: 'dish:борщ:01TWIN', updatedAt: '2030-01-01T00:00:00.000Z', name: 'БОРЩ', kcal100: 55 }],
      },
    }),
  )
  const doc = await send('DOM.getDocument')
  const copyField = await send('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector: 'input[type=file][accept*="text/plain"]',
  })
  await send('DOM.setFileInputFiles', { nodeId: copyField.nodeId, files: [twin] })
  await sleep(3000)
  await go('/dishes')
  await act(`document.querySelector('.search') && set(document.querySelector('.search'), 'борщ')`)
  await sleep(500)
  const merged = await screen()
  check(
    'одноимённое блюдо из копии слилось само — одно, с калорийностью поздней правки',
    /Найдено 1 из 3 блюд(?!а)/.test(merged) && has(merged, 'БОРЩ · 55 ккал/100 г'),
    `${line(merged, 'Найдено')}; ${line(merged, 'борщ')}`,
  )

  // ─ «Сегодня»: запись тапом по блюду в открытом текущем приёме (Р-11).
  // Какой приём текущий — по часам машины, поэтому ищется открытый список.
  await act(`byText('a', 'Сегодня')?.click()`)
  await sleep(700)
  const openMeals = await run(`[...document.querySelectorAll('.meal')]
    .filter((el) => el.querySelector('.meal__pick'))
    .map((el) => el.querySelector('.fold__btn').textContent.trim())`)
  check('на «Сегодня» открыт ровно один приём — текущий, не перекус', openMeals?.length === 1 && openMeals[0] !== 'Перекус', JSON.stringify(openMeals))
  const tapShchi = `[...document.querySelectorAll('.meal__pick .chip')].find((el) => el.textContent.trim() === 'Щи')?.click()`
  await act(tapShchi)
  await sleep(700)
  const recorded = await screen()
  check('тап по блюду записывает — одно действие', has(recorded, `${openMeals?.[0]}: Щи`) && has(recorded, '1 блюдо'), line(recorded, ': Щи'))
  await act(tapShchi)
  await sleep(700)
  check('повторный тап прибавляет порцию к той же записи', has(await screen(), 'Щи · 2 порции'), line(await screen(), 'Щи ·'))

  // Правка: шаг ½ вниз, время.
  await act(`document.querySelector('[aria-label="Поправить: Щи"]')?.click()`)
  await sleep(400)
  await act(`
    document.querySelector('[aria-label="Меньше на половину"]')?.click()
  `)
  await sleep(200)
  await act(`
    set(document.querySelector('[name="intake-at"]'), '14:05')
    byText('button', 'Сохранить')?.click()
  `)
  await sleep(700)
  const edited = await screen()
  check('правка записи: порции шагом ½ и время', has(edited, 'Щи · 1,5 порции · 14:05'), line(edited, 'Щи ·'))

  // Перезагрузка — запись на месте: полная загрузка по ярлыку, адрес
  // отличается не только хешем. Прошлый день — из адреса.
  await open(`${APP}?go=write`)
  check('после перезагрузки запись на месте', has(await screen(), 'Щи · 1,5 порции'))
  await go('/?day=2026-02-04')
  const past = await screen()
  check(
    'прошлый день по адресу: записи того дня, приёмы закрыты, есть «К сегодняшнему дню»',
    has(past, '4 февраля 2026') && has(past, 'Компот · 2 порции') && has(past, 'К сегодняшнему дню') &&
      (await run(`document.querySelectorAll('.meal__pick').length`)) === 0,
    line(past, 'Компот'),
  )

  // ─ Повтор приёма (Р-08, Р-17): на следующий день обед — «как вчера»,
  // и в списке обеда первым стоит то, что было в обеде.
  await go('/?day=2026-02-05')
  await act(`byText('button', 'Обед')?.click()`)
  await sleep(400)
  // До 5 февраля в обеде: компот — два дня (2-го и 4-го), борщ — один (3-го,
  // из копии). По алфавиту борщ был бы первым — порядок проверяет частоту.
  // Щи записаны в сентябре: позже дня, не в счёт.
  const chips = await run(`[...document.querySelectorAll('.meal__pick .chip')].map((el) => el.textContent.trim())`)
  check(
    'порядок по частоте: наверху обеда — бывшее в обеде до этого дня, записанное позже — ниже',
    chips?.[0] === 'Компот' && chips?.[1] === 'БОРЩ' && chips?.indexOf('Щи') > 1,
    JSON.stringify(chips),
  )
  await act(`document.querySelector('.meal__repeat')?.click()`)
  await sleep(700)
  const repeated = await screen()
  check(
    '«как вчера» ставит вчерашний обед одним тапом, с порциями, и кнопка уходит',
    has(repeated, 'Компот · 2 порции') && (await run(`document.querySelectorAll('.meal__repeat').length`)) === 0,
    line(repeated, 'Компот'),
  )

  // ─ Итог дня (Р-01, Р-18): порции по категориям, калории с основанием.
  // Компот — 80 ккал на порцию, две порции.
  check(
    'итог дня: порции, категория, ккал с основанием',
    has(repeated, 'Итог дня') &&
      has(repeated, '2 порции в 1 записи') &&
      has(repeated, '160 ккал по 1 из 1 записи') &&
      /(?:^|\n)Напитки\s+2(?:\n|$)/.test(repeated),
    `${line(repeated, 'в 1 записи')}; ${line(repeated, 'ккал по')}`,
  )

  await syncScenario()

  // ─ Service worker: без него нет ни офлайна, ни автообновления.
  const worker = await run(`Promise.race([
    navigator.serviceWorker.ready.then((r) => r.active?.state ?? 'нет'),
    new Promise((done) => setTimeout(() => done('не дождался'), 5000)),
  ])`)
  check('service worker встал и активен', worker === 'activated', `состояние ${worker}`)

  // ─ Без сети. Проверяется и то, что страницу отдал работник: иначе при
  // непойманном офлайне проверка прошла бы на обычной загрузке из сети.
  await offline(true)
  await open(`${APP}?go=write`)
  const cached = await screen()
  const controlled = await run('navigator.serviceWorker.controller !== null')
  check(
    'без сети приложение открывается из кеша, по ярлыку',
    has(cached, 'Сегодня') && controlled === true,
    `работник ${controlled ? 'управляет' : 'не управляет'} страницей`,
  )
  await go('/settings')
  await unfold('О приложении')
  const offlineAbout = await screen()
  check(
    'без сети данные на месте',
    /(?:^|\n)Записи еды\s*7/.test(offlineAbout.replace(/ /g, ' ')),
    /(?:^|\n)(Записи еды\s*\d+)/.exec(offlineAbout)?.[1] ?? '',
  )
  await offline(false)
}

/**
 * Синхронизация (Этап 2) на подставном GitHub: включить, завести пустой
 * репозиторий, отправить; тихий повтор; коммит другого устройства со вторым
 * «Борщом» и записью к нему (Р-12); отказ токена; обрыв связи и очередь.
 * В конце синхронизация выключается — дальше сценарий прежний.
 * Каркас — `syncScenario` прогона «Делу Время» с d86f0aa.
 */
async function syncScenario() {
  await send('Fetch.enable', { patterns: [{ urlPattern: 'https://api.github.com/*' }] })
  const syncNow = async (wait = 2500) => {
    await act(`byText('button', 'Синхронизировать')?.click()`)
    await sleep(wait)
    return screen()
  }

  // Проход идёт через пять секунд после последней записи: пусть прошлые
  // записи сценария отработают, пока синхронизация выключена.
  await sleep(6000)

  await go('/settings')
  await unfold('Синхронизация')
  const off = await screen()
  check(
    'синхронизация по умолчанию выключена — данные только в браузере',
    has(off, 'данные живут только в этом браузере'),
    line(off, 'выключен'),
  )

  await act(`document.querySelector('.check input')?.click()`)
  await sleep(500)
  await act(`
    set(document.querySelector('input[placeholder="владелец/репозиторий"]'), ${JSON.stringify(REPO)});
    const token = document.querySelector('input[type=password]');
    set(token, ${JSON.stringify(GOOD_TOKEN)});
    blur(token);
  `)
  await sleep(500)
  await act(`byText('button', 'Проверить доступ')?.click()`)
  await sleep(1500)
  const access = await screen()
  check(
    '«Проверить доступ»: репозиторий найден, приватный, запись разрешена; срок токена — из ответа',
    has(access, `Репозиторий ${REPO} найден, приватный, запись разрешена`) &&
      has(access, 'Токен действует до') &&
      has(access, 'Сохранён в этом браузере'),
    `${line(access, 'Репозиторий')}; ${line(access, 'Токен действует')}`,
  )

  // ─ Первый проход: пустой репозиторий заводится через Contents API, дальше — один коммит.
  const first = await syncNow(3000)
  debug(`экран после первого прохода:\n${first}`)
  const paths = Object.keys(repoFiles()).sort()
  const month = localMonth()
  check(
    'пустой репозиторий заведён сам, всё ушло одним коммитом',
    commitCount() === 2 && has(first, 'отправлено файлов') && has(first, 'Всё отправлено'),
    `коммитов ${commitCount()}; ${line(first, 'отправлено файлов')}`,
  )
  const expected = ['meta.json', 'categories.json', 'dishes.json', 'intake/2026-02.json', `intake/${month}.json`, 'README.md']
  check(
    'раскладка: справочники файлами, записи по месяцам, годовых файлов нет',
    expected.every((path) => paths.includes(path)) && !paths.some((path) => /^intake\/\d{4}\.json$/.test(path)),
    paths.join(', '),
  )
  check(
    'README «Трапезы» положен приложением в пустой репозиторий',
    (repoFiles()['README.md'] ?? '').startsWith('# Данные «Трапезы»') &&
      (repoFiles()['README.md'] ?? '').includes('`intake/ГГГГ-ММ.json`'),
    (repoFiles()['README.md'] ?? 'README нет').slice(0, 60),
  )
  check(
    'февраль — в своём файле: 2, 3, 4 и 5 февраля',
    repoRecords('intake/2026-02.json')?.length === 4,
    `в intake/2026-02.json записей ${repoRecords('intake/2026-02.json')?.length}`,
  )

  const quiet = await syncNow()
  check('повтор без правок — ни одного коммита', commitCount() === 2 && has(quiet, 'Всё и так совпадает'), `коммитов ${commitCount()}`)

  // ─ Другое устройство: свой «Борщ» с другим id и ужин с ним (Р-12).
  const later = new Date(Date.now() + 60_000).toISOString()
  commitFromOtherDevice({
    'dishes.json': [
      ...repoRecords('dishes.json'),
      { id: 'dish:борщ:phone', updatedAt: later, name: 'Борщ', kcal100: 60 },
    ],
    'intake/2026-02.json': [
      ...repoRecords('intake/2026-02.json'),
      { id: 'phone-intake', updatedAt: later, date: '2026-02-06', meal: 'dinner', dishId: 'dish:борщ:phone' },
    ],
  })
  const pulled = await syncNow()
  check('коммит другого устройства влит', has(pulled, 'получено записей 2'), line(pulled, 'получено'))

  // Слияние ждёт секунду тишины, его запись уезжает сама через пять.
  await sleep(8000)
  const tomb = repoRecords('dishes.json')?.find((each) => each.id === 'dish:борщ:phone')
  const moved = repoRecords('intake/2026-02.json')?.find((each) => each.id === 'phone-intake')
  check(
    'одноимённое блюдо слито и уехало обратно: надгробие с movedTo, запись у оставшегося',
    tomb?.deleted === true && tomb?.movedTo === 'dish:борщ' && moved?.dishId === 'dish:борщ',
    JSON.stringify({ tomb, moved }),
  )
  await go('/dishes')
  await act(`set(document.querySelector('.search'), 'борщ')`)
  await sleep(500)
  const dishes = await screen()
  check(
    'на «Блюдах» один «Борщ» — с калорийностью поздней правки',
    /Найдено 1 из 3 блюд(?!а)/.test(dishes) && has(dishes, 'Борщ · 60 ккал/100 г'),
    `${line(dishes, 'Найдено')}; ${line(dishes, 'ккал/100')}`,
  )
  await go('/?day=2026-02-06')
  const evening = await screen()
  check('ужин другого устройства — в своём дне', has(evening, 'Борщ') && has(evening, '1 блюдо'), line(evening, 'Борщ'))

  // ─ Токен не принят: причина словами, точка на шестерёнке красная.
  github.reject = true
  await go('/settings')
  const rejected = await syncNow()
  await go('/')
  const red = await run(`document.querySelector('.gear .dot--error') !== null`)
  check(
    'токен не принят — причина словами и красная точка на шестерёнке',
    has(rejected, 'Токен не принят') && red === true,
    `${line(rejected, 'Токен не принят')}; точка ${red ? 'есть' : 'нет'}`,
  )
  github.reject = false

  // ─ Связи нет: запись ждёт в очереди и доезжает, когда связь вернулась.
  github.down = true
  const before = repoRecords(`intake/${month}.json`)?.length ?? 0
  await go('/')
  await act(`[...document.querySelectorAll('.meal__pick .chip')].find((el) => el.textContent.trim() === 'Компот')?.click()`)
  await sleep(6500)
  const queued = await run(`document.querySelector('.gear .dot') !== null`)
  await go('/settings')
  const waiting = await screen()
  check(
    'без связи запись ждёт в очереди, точка горит',
    queued === true && has(waiting, 'Ждут отправки: 1'),
    `${line(waiting, 'Ждут отправки')}; точка ${queued ? 'есть' : 'нет'}`,
  )

  github.down = false
  const sent = await syncNow()
  const after = repoRecords(`intake/${month}.json`)?.length ?? 0
  await go('/')
  const dark = await run(`document.querySelector('.gear .dot') === null`)
  check(
    'связь вернулась — очередь доехала, точка погасла',
    after === before + 1 && has(sent, 'Всё отправлено') && dark === true,
    `в intake/${month}.json было ${before}, стало ${after}; ${line(sent, 'отправлен')}`,
  )

  await go('/settings')
  await act(`document.querySelector('.check input')?.click()`)
  await sleep(500)
  await send('Fetch.disable')
}

/** Строка экрана с образцом внутри. Для внятного отчёта о непрошедшем. */
function line(text, part) {
  const flat = (value) => value.replace(/ /g, ' ')
  return flat(text)
    .split('\n')
    .find((each) => each.toLowerCase().includes(part.toLowerCase())) ?? ''
}

// ─── Копия настоящих данных ────────────────────────────────────────────────

/** Разворачивает все свёрнутые блоки, вложенные тоже: они появляются после внешних. */
async function unfoldAll() {
  for (let round = 0; round < 3; round++) {
    await act(`document.querySelectorAll('.fold__btn[aria-expanded="false"]').forEach((el) => el.click())`)
    await sleep(400)
  }
}

/**
 * Экраны на копии настоящих данных. Копия загружается тем же путём, что
 * у человека, — «Восстановить из копии», — и каждый экран открывается со
 * всеми развёрнутыми блоками: ошибка на кривой записи прячется именно
 * в свёрнутом. Условие прохода прежнее — ни одной ошибки в консоли.
 *
 * Данные остаются во временном профиле браузера и удаляются вместе с ним.
 */
async function dataScenario(file) {
  await send('Runtime.enable')
  await send('Page.enable')
  await send('DOM.enable')

  await send('Page.navigate', { url: APP })
  await sleep(2000)

  await go('/settings')
  await unfold('Экспорт и импорт')
  // Поле копии: у него в списке типов есть text/plain.
  const field = await send('Runtime.evaluate', {
    expression: `document.querySelector('input[type=file][accept*="text/plain"]')`,
  })
  const objectId = field?.result?.objectId
  check('поле «Восстановить из копии» найдено', Boolean(objectId))
  if (!objectId) return

  await send('DOM.setFileInputFiles', { files: [file], objectId })
  await sleep(3000)
  const restored = await screen()
  const loaded = /Загружено записей: (\d+)/.exec(restored.replace(/ /g, ' '))
  check('копия загрузилась через «Восстановить из копии»', loaded !== null, loaded?.[0] ?? restored.slice(0, 160))

  // Маршруты прибавляются вместе с экранами, по этапам.
  const routes = ['/', '/dishes', '/settings']

  for (const route of routes) {
    await go(route)
    await unfoldAll()
    const text = await screen()
    check(
      `${route} — открылся на настоящих данных, всё развёрнуто`,
      text.trim().length > 0 && !has(text, 'База не открылась') && !has(text, 'не прочитались'),
      text.replace(/\s+/g, ' ').slice(0, 80),
    )
  }
}

// ─── Прогон ────────────────────────────────────────────────────────────────

let server
let browser
let profile

try {
  if (DATA !== null && !existsSync(DATA)) throw new Error(`Файла копии нет: ${DATA}`)
  server = await startServer()
  profile = mkdtempSync(join(tmpdir(), 'trapeza-smoke-'))
  browser = spawn(
    findBrowser(),
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      // Пустой временный профиль: своей базы у прогона нет и быть не должно.
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--disable-gpu',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  await connect(await pageSocket())
  await (DATA === null ? scenario() : dataScenario(DATA))
} catch (failure) {
  problems.push(failure instanceof Error ? failure.message : String(failure))
} finally {
  socket?.close()
  browser?.kill()
  await server?.close()
}

// Браузер отпускает профиль не мгновенно, и на Windows удаление сразу
// после kill падает с EPERM. Не удалось — не беда: это папка во временных.
await sleep(500)
if (profile) {
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {
    // Останется до следующей уборки временных файлов.
  }
}

const failed = checks.filter((each) => !each.passed)

for (const each of checks) {
  console.log(`${each.passed ? '  ok' : 'НЕТ '} ${each.what}${each.seen ? ` — ${each.seen}` : ''}`)
}

if (problems.length > 0) {
  console.log('\nБраузер сообщил об ошибках:')
  for (const problem of problems) console.log(`  ${problem}`)
}

const bad = failed.length > 0 || problems.length > 0
console.log(
  bad
    ? `\nПрогон не прошёл: проверок ${checks.length}, не сошлось ${failed.length}, ошибок ${problems.length}`
    : `\nПрогон прошёл: ${checks.length} проверок, ошибок нет`,
)

process.exit(bad ? 1 : 0)
