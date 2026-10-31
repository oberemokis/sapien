import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { EntryKind, NoteText, VaultEntry, VaultStatus } from "../model/vault";

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

// Отдаёт путь созданного элемента в том же виде, что в дереве.
export function vaultCreate(input: { parent: string; name: string; kind: EntryKind }) {
  return invoke<string>("vault_create", input);
}

export function vaultRead(path: string) {
  return invoke<string>("vault_read", { path });
}

// Переписывает существующую заметку. Пропавшую Rust не создаёт заново,
// а отвечает кодом note_missing.
export function vaultWrite(path: string, text: string) {
  return invoke<null>("vault_write", { path, text });
}

// Тексты всех заметок разом. Непрочитанные Rust пропускает.
export function vaultTexts() {
  return invoke<NoteText[]>("vault_texts");
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
