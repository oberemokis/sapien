// Чем идёт агент, как Method в domain.rs: подпиской Claude через
// Claude Code на устройстве или ключом API.
export type AgentMethod = "subscription" | "key";

export function parseAgentMethod(value: string | null): AgentMethod | null {
  if (value === "subscription" || value === "key") {
    return value;
  }

  return null;
}

// Claude Code на устройстве, как ClaudeStatus в domain.rs.
export type ClaudeState = "unsupported" | "missing" | "outdated" | "logged_out" | "not_subscription" | "ready";

export type ClaudeStatus = { state: ClaudeState; version: string | null };

// Способ, который человек выбрал, а без выбора подписка, когда Claude Code
// нашёлся со входом по подписке. Где Claude Code не поддержан, только ключ.
export function resolveMethod(chosen: AgentMethod | null, claude: ClaudeStatus | undefined): AgentMethod {
  if (claude?.state === "unsupported") {
    return "key";
  }

  if (chosen !== null) {
    return chosen;
  }

  if (claude?.state === "ready") {
    return "subscription";
  }

  return "key";
}
