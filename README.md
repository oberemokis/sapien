# sapien

Монорепа на pnpm и turbo: приложение для macOS на Tauri v2 и React для работы с агентами вроде Claude Code в терминалах проектов. Устройство слоёв, дерево каталогов и правила: [docs/architecture.md](./docs/architecture.md).

## Стек

| Слой | Инструмент |
| --- | --- |
| Оболочка | Tauri 2, Rust 2024 edition |
| Интерфейс | React 19, TanStack Router с файловыми маршрутами, Tailwind 4 |
| Состояние | TanStack Query для данных из Rust, TanStack Store для остального |
| Локализация | i18next и react-i18next |
| Сборка | Vite 8, turbo, pnpm 11 |
| Проверки | tsc, oxlint, `scripts/check-boundaries.mjs`, cargo check, clippy и rustfmt, secretlint, pnpm audit и cargo audit |
| Тесты | vitest, Testing Library, happy-dom, cargo test |

## Раскладка

```
Cargo.toml            Cargo workspace: члены, общие версии, lints, profile.release
apps/desktop          @sapien/desktop
  src/                интерфейс: app/, core/, modules/<модуль>/, pages/
  src-tauri/          Rust: точка входа, команды, права окна, иконки

packages/ui           @sapien/ui: кнопки, иконки, меню, строки настроек, токены темы
packages/i18n         @sapien/i18n: запуск i18next и типы словарей
packages/device       @sapien/device: настройки устройства в localStorage
packages/testing      @sapien/testing: настройка vitest и подделка xterm
scripts/              проверка направления зависимостей
```

## Запуск

Нужны macOS, Node 24, pnpm 11 и Rust stable. Приложение собирается и работает только на macOS.

```bash
pnpm install
pnpm dev              # окно приложения (Vite на 1420 и Rust)
pnpm dev:web          # интерфейс в браузере, команды Rust там недоступны
pnpm bundle           # бандл под текущую систему в target/release/bundle
```

Порт Vite закреплён на 1420: его ждёт `devUrl` в `src-tauri/tauri.conf.json`, и занятый порт роняет запуск, а не уводит Vite на соседний.

Первый `pnpm dev` и первый `pnpm typecheck` компилируют зависимости Rust, это около минуты. Дальше сборка инкрементальная.

## Проверки

```bash
pnpm typecheck        # tsc и cargo check по всему workspace
pnpm lint             # oxlint, границы слоёв, cargo fmt, clippy без предупреждений, секреты
pnpm audit:deps       # известные уязвимости: pnpm audit и cargo audit
pnpm test             # vitest и cargo test
```

Хук перед коммитом гоняет `typecheck` и `lint`, CI гоняет `typecheck`, `lint` и `test`. Аудит идёт отдельным workflow на пул-реквесте и раз в неделю: база уязвимостей меняется и без коммитов. Найденное по расписанию открывает задачу.

Переменную, которую задают снаружи, надо объявить в `globalPassThroughEnv` в `turbo.json`: turbo 2 по умолчанию работает в строгом режиме окружения и отдаёт задачам только объявленное. Незаявленная переменная не вызывает ошибки, она просто не действует.
