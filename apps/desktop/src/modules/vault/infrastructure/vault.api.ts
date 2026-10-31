import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { EntryKind, NoteText, Unsaved, VaultEntry, VaultStatus, Version } from "../model/vault";

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
// а отвечает кодом note_missing. С base пишет, только если в файле всё ещё
// этот текст, иначе отвечает note_conflict: файл изменили снаружи. null
// пишет поверх любого текста. Пока запись не дошла, правка лежит в журнале.
export function vaultWrite(path: string, text: string, base: string | null) {
  return invoke<null>("vault_write", { path, text, base });
}

// Правки из журнала, которые не дошли до файлов: приложение упало
// или запись не прошла.
export function vaultUnsaved() {
  return invoke<Unsaved[]>("vault_unsaved");
}

export function vaultForgetUnsaved(path: string) {
  return invoke<null>("vault_forget_unsaved", { path });
}

// В системную корзину, откуда файл или папку можно вернуть. Заметки внутри
// Rust перед этим снимает в историю версий.
export function vaultTrash(path: string) {
  return invoke<null>("vault_trash", { path });
}

// Версии заметки, свежие первыми.
export function vaultVersions(path: string) {
  return invoke<Version[]>("vault_versions", { path });
}

export function vaultVersion(path: string, id: number) {
  return invoke<string>("vault_version", { path, id });
}

// Текущий текст Rust перед этим снимает версией, удалённую заметку создаёт
// заново.
export function vaultRestore(path: string, id: number) {
  return invoke<null>("vault_restore", { path, id });
}

// Удалённые заметки, у которых остались версии.
export function vaultDeleted() {
  return invoke<string[]>("vault_deleted");
}

// Тексты всех заметок разом. Непрочитанные Rust пропускает.
export function vaultTexts() {
  return invoke<NoteText[]>("vault_texts");
}

// Rust следит за папкой и шлёт событие, когда в ней что-то поменялось снаружи.
// Без Rust, в браузере и тестах, подписаться не на что: окно тогда просто
// не узнает о правках снаружи, а ошибку открытия покажет статус.
export function onVaultChanged(onChange: () => void) {
  return subscribe("vault://changed", onChange);
}

// Заметки, которые система попросила открыть ссылкой sapien://. Путь Rust
// уже проверил: он внутри хранилища и ведёт к заметке.
export function vaultOpened() {
  return invoke<string[]>("vault_opened");
}

// Система открыла приложение ссылкой на заметку: её пора забрать.
export function onVaultOpen(onOpen: () => void) {
  return subscribe("vault://open", onOpen);
}

function subscribe(event: string, handler: () => void) {
  const stop = listen(event, handler).catch(() => undefined);

  return () => {
    void stop.then((unlisten) => unlisten?.());
  };
}
