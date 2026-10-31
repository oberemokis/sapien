import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { VaultEntry, VaultStatus } from "../model/vault";

export function vaultStatus() {
  return invoke<VaultStatus>("vault_status");
}

export function vaultTree() {
  return invoke<VaultEntry[]>("vault_tree");
}

// Папку выбирает системный диалог в Rust, путь сюда не передаётся.
export function vaultChoose() {
  return invoke<VaultStatus>("vault_choose");
}

// Rust следит за папкой и шлёт событие, когда в ней что-то поменялось снаружи.
// Без Rust, в браузере и тестах, подписаться не на что: окно тогда просто
// не узнает о правках снаружи, а ошибку открытия покажет статус.
export function onVaultChanged(onChange: () => void) {
  const stop = listen("vault://changed", onChange).catch(() => undefined);

  return () => {
    void stop.then((unlisten) => unlisten?.());
  };
}
