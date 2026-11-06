# sapien

## Запуск

Нужны macOS, Node 24, pnpm 11 и Rust stable.

```bash
pnpm install
pnpm dev              # окно приложения (Vite на 1420 и Rust)
pnpm dev:web          # интерфейс в браузере, команды Rust там недоступны
pnpm bundle           # бандл в target/release/bundle
```

Первый запуск компилирует зависимости Rust, это около минуты.

## Проверки

```bash
pnpm typecheck        # tsc и cargo check
pnpm lint             # oxlint, cargo fmt, clippy, secretlint
pnpm test             # vitest и cargo test
pnpm audit:deps       # pnpm audit и cargo audit
```
