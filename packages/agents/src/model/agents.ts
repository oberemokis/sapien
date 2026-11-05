// Названия агентов из AGENTS крейта sapien-agents: это имена программ,
// на язык окна они не переводятся.
const AGENT_NAMES = new Map([
  ["claude", "Claude Code"],
  ["codex", "Codex"],
  ["pi", "Pi"],
  ["opencode", "OpenCode"],
  ["gemini", "Gemini CLI"],
  ["cursor", "Cursor"],
]);

// Агента, которого Rust уже узнаёт, а окно ещё нет, оно называет как Rust.
export function agentName(agent: string) {
  return AGENT_NAMES.get(agent) ?? agent;
}
