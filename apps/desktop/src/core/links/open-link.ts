import { invoke } from "@tauri-apps/api/core";

// Адрес из текста открывает браузер системы, окно приложения остаётся
// на месте. Годится ли адрес, решает Rust: окно не может отдать системе
// javascript: или file:, и отказ здесь просто ничего не делает.
export function openLink(url: string) {
  void invoke("open_link", { url }).catch(() => undefined);
}
