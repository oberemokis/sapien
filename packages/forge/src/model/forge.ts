import type { Forge, ForgeCode } from "@sapien/ipc";

export const FORGE_NAMES: Record<Forge, string> = { github: "GitHub", gitlab: "GitLab" };

// Подсказка на каждый код отказа forge. Код, который добавит Rust, не
// скомпилируется, пока окно не решит, что о нём сказать, а перевод каждой
// подсказки проверяет t. Отказ диска и хранилища паролей идёт общей причиной.
const PROBLEMS = {
  forge_token_empty: "forge_token_empty",
  forge_token_rejected: "forge_token_rejected",
  forge_unreachable: "forge_unreachable",
  forge_host_insecure: "forge_host_insecure",
  forge_host_invalid: "forge_host_invalid",
  forge_unreadable: "failed",
  forge_unwritable: "failed",
  secret_empty: "failed",
  secret_unsaved: "failed",
  secret_unerased: "failed",
} as const satisfies Record<ForgeCode, string>;

export type ForgeProblem = (typeof PROBLEMS)[ForgeCode];

export function forgeProblemOf(error: unknown): ForgeProblem {
  let code: unknown = null;

  if (typeof error === "object" && error !== null && "code" in error) {
    code = error.code;
  }

  return Object.entries(PROBLEMS).find(([known]) => known === code)?.[1] ?? "failed";
}
