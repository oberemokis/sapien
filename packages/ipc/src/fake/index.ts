// Подделка Rust: fakeRust для тестов, browserRust для pnpm dev:web.
export { browserRust } from "./browser.ts";
export { fakeRust, type Command, type FakeOptions, type FakeRust, type FakeState, type Handler } from "./rust.ts";
