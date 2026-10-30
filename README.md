# sapien

Монорепа на pnpm и turbo: сервер на Hono, десктопное приложение на Tauri v2 и React и приложение для iOS и Android на Expo. Оба приложения ходят в сервер через клиент Hono RPC. Устройство слоёв, дерево каталогов и правила: [docs/architecture.md](./docs/architecture.md).

## Стек

| Слой | Инструмент |
| --- | --- |
| Сервер | Hono 4 на `@hono/node-server`, zod 4 |
| Транспорт | Hono RPC: клиент `hc` выводит типы из маршрутов сервера |
| Оболочка | Tauri 2, Rust 2024 edition |
| Интерфейс | React 19, TanStack Router с файловыми маршрутами, Tailwind 4 |
| Телефон | Expo SDK 58, React Native 0.88, Expo Router, Uniwind (Tailwind 4) |
| Состояние | TanStack Query для данных сервера, TanStack Store для остального |
| Локализация | i18next и react-i18next |
| Сборка | Vite 8, Metro, tsup, tsx, turbo, pnpm 11 |
| Проверки | tsc, oxlint, `scripts/check-boundaries.mjs`, cargo check и rustfmt, secretlint, pnpm audit и cargo audit |
| Тесты | vitest, `hono/testing`, Testing Library, happy-dom |

## Раскладка

```
apps/api              @sapien/api, порт 3400
  src/core/           окружение
  src/app/            цепочка маршрутов, CORS, тип AppType
  src/modules/<модуль>/{domain,use-case,infrastructure,transport}

apps/desktop          @sapien/desktop
  src/                интерфейс: app/, core/, modules/<модуль>/, pages/
  src/core/api/       клиент hc<AppType>
  src-tauri/          Rust: точка входа, команды, права окна, иконки

apps/mobile           @sapien/mobile, iOS и Android
  src/app/            файловые маршруты Expo Router
  src/core/api/       клиент hc<AppType>
  app.json            настройки Expo, из них prebuild пишет ios/ и android/

packages/             пусто, пакет появляется при втором потребителе
scripts/              проверка направления зависимостей
```

## Запуск

Нужны Node 24, pnpm 11 и Rust stable. На Linux ещё системные библиотеки WebKitGTK, список в [требованиях Tauri](https://tauri.app/start/prerequisites/).

```bash
pnpm install
pnpm dev              # api на 3400 и окно приложения (Vite на 1420 и Rust)
pnpm dev:web          # api и интерфейс в браузере, команды Rust там недоступны
pnpm dev:mobile       # api и Metro, приложение открывается в Expo Go по QR-коду
pnpm dev:api          # только api
pnpm bundle           # бандл под текущую систему в src-tauri/target/release/bundle
```

Порт Vite закреплён на 1420: его ждёт `devUrl` в `src-tauri/tauri.conf.json`, и занятый порт роняет запуск, а не уводит Vite на соседний.

Api слушает 3400, а не 3000: на трёх тысячах сидит почти каждый локальный сервер. Порт задаёт `PORT`, адрес api для окна задаёт `VITE_API_URL`. Окно грузится со своего origin, поэтому ходит в api напрямую, без прокси, а api пускает его через CORS. Сменили адрес, поменяйте его и в `connect-src` в `tauri.conf.json`: иначе бандл заблокирует запросы.

Телефон и компьютер должны быть в одной сети. Api телефон находит сам по адресу машины, где запущен Metro, порт тот же 3400. Для сборки без дев-сервера адрес задаёт `EXPO_PUBLIC_API_URL`, и он должен быть https. Собрать нативное приложение можно через `pnpm --filter @sapien/mobile exec expo run:ios` (нужен Mac с Xcode) или `expo run:android` (нужен Android SDK).

Первый `pnpm dev` и первый `pnpm typecheck` компилируют зависимости Rust, это около минуты. Дальше сборка инкрементальная.

## Проверки

```bash
pnpm typecheck        # tsc и cargo check
pnpm lint             # oxlint, границы слоёв, cargo fmt --check, секреты
pnpm audit:deps       # известные уязвимости: pnpm audit и cargo audit
pnpm test             # vitest и cargo test
```

Хук перед коммитом гоняет `typecheck` и `lint`, CI гоняет `typecheck`, `lint` и `test`. Аудит идёт отдельным workflow на пул-реквесте и раз в неделю: база уязвимостей меняется и без коммитов. Найденное по расписанию открывает задачу.

Переменную, которую задают снаружи, надо объявить в `globalPassThroughEnv` в `turbo.json`: turbo 2 по умолчанию работает в строгом режиме окружения и отдаёт задачам только объявленное. Незаявленная переменная не вызывает ошибки, она просто не действует.
