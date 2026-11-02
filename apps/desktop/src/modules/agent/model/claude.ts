// Claude Code на устройстве, как ClaudeStatus в domain.rs.
export type ClaudeState = "missing" | "outdated" | "logged_out" | "not_subscription" | "ready";

export type ClaudeStatus = { state: ClaudeState; version: string | null };
