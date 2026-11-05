import type { Forge } from "@sapien/ipc";

export const FORGE_NAMES: Record<Forge, string> = { github: "GitHub", gitlab: "GitLab" };

// Коды отказов forge_connect, у каждого своя подсказка.
const PROBLEMS = [
  "forge_token_empty",
  "forge_token_rejected",
  "forge_unreachable",
  "forge_host_insecure",
  "forge_host_invalid",
] as const;

export type ForgeProblem = (typeof PROBLEMS)[number] | "failed";

export function forgeProblemOf(error: unknown): ForgeProblem {
  let code: unknown = null;

  if (typeof error === "object" && error !== null && "code" in error) {
    code = error.code;
  }

  return PROBLEMS.find((problem) => problem === code) ?? "failed";
}
