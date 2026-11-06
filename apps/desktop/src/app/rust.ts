import { isTauri } from "@tauri-apps/api/core";

// Окно в браузере без Tauri (pnpm dev:web) отвечает подделкой Rust из
// @sapien/ipc/fake. Условие с import.meta.env.DEV сборка вырезает вместе
// с импортом, поэтому в приложение подделка не попадает.
export async function fakeRustInBrowser() {
  if (import.meta.env.DEV && !isTauri()) {
    const { browserRust } = await import("@sapien/ipc/fake");

    browserRust(location.hash);
  }
}
