import { invoke } from "@tauri-apps/api/core";

// Команды из src-tauri/src/secrets.rs. Секрет окно отдаёт в Rust один раз
// и обратно не получает: только последние четыре знака и то, переживёт ли
// он перезапуск.
export type SecretName = "model_key";

export type SecretStatus = { ending: string | null; kept: boolean };

export function secretStatus(name: SecretName) {
  return invoke<SecretStatus>("secret_status", { name });
}

export function saveSecret(name: SecretName, value: string) {
  return invoke<SecretStatus>("secret_set", { name, value });
}

export function deleteSecret(name: SecretName) {
  return invoke<null>("secret_delete", { name });
}
