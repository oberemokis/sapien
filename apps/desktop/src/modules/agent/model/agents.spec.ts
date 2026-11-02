import { describe, expect, it } from "vitest";
import { commandsMatching, fitChoice, wantedChoice, type AgentCommand, type Choice, type Provider } from "./agents";
import type { SessionInfo } from "./sessions";

const ALL = ["low", "medium", "high", "xhigh", "max"];

const CLAUDE: Provider = {
  id: "claude",
  name: "Claude Code",
  models: [
    { id: "sonnet", resolved: "claude-sonnet-5-5", name: "Sonnet 5.5", description: "", efforts: ALL },
    { id: "haiku", resolved: "claude-haiku-5-5", name: "Haiku 5.5", description: "", efforts: [] },
  ],
};

// Агент, который не назвал своих моделей.
const SILENT: Provider = { id: "claude", name: "Claude Code", models: [] };

const choice = (model: string | null, effort: Choice["effort"] = null, provider = "claude"): Choice => ({
  provider,
  model,
  effort,
});

describe("выбор, который годится установленным агентам", () => {
  it.each([
    ["выбора ещё не было: первая модель первого агента", null, [CLAUDE], choice("sonnet")],
    ["модель и уровень есть у агента", choice("sonnet", "high"), [CLAUDE], choice("sonnet", "high")],
    ["полное имя модели находит её псевдоним", choice("claude-haiku-5-5"), [CLAUDE], choice("haiku")],
    ["модели больше нет: первая", choice("claude-opus-4-1"), [CLAUDE], choice("sonnet")],
    ["модель без размышления сбрасывает уровень", choice("haiku", "max"), [CLAUDE], choice("haiku")],
    ["агента нет на устройстве: первый установленный", choice("gpt-5", "low", "codex"), [CLAUDE], choice("sonnet")],
    ["агент не назвал моделей: выбор как есть", choice("opus", "high"), [SILENT], choice("opus", "high")],
    ["агентов нет", choice("sonnet"), [], null],
  ])("%s", (_, wanted, providers, fitted) => {
    expect(fitChoice(wanted, providers)).toEqual(fitted);
  });
});

const session = (provider: string, model: string | null, effort: string | null = null): SessionInfo => ({
  id: "s1",
  project: "p1",
  title: "",
  updated: 1,
  provider,
  model,
  effort,
});

describe("что хочет сессия", () => {
  it.each([
    ["выбранное в сессии важнее сохранённого", session("claude", "sonnet"), choice("haiku"), choice("opus"), choice("haiku")],
    ["сохранённое важнее последнего выбора окна", session("claude", "sonnet", "high"), null, choice("haiku"), choice("sonnet", "high")],
    ["новая сессия берёт последний выбор окна", session("claude", null), null, choice("haiku"), choice("haiku")],
    ["агент ответившей сессии не меняется", session("claude", "sonnet"), choice("gpt-5", null, "codex"), null, choice("gpt-5")],
    ["неизвестный уровень из файла сессии не берётся", session("claude", "sonnet", "turbo"), null, null, choice("sonnet")],
  ])("%s", (_, info, picked, last, wanted) => {
    expect(wantedChoice(info, picked, last)).toEqual(wanted);
  });
});

const command = (name: string, builtin = false, aliases: string[] = []): AgentCommand => ({
  name,
  description: "",
  hint: "",
  aliases,
  builtin,
});

describe("команды под набранное после «/»", () => {
  const COMMANDS = [command("compact", true), command("review"), command("clear", true, ["reset"]), command("review", true)];

  it.each([
    ["без набранного все, свои выше встроенных, одноимённая одна", "", ["review", "compact", "clear"]],
    ["по части имени без учёта регистра", "REV", ["review"]],
    ["по другому имени команды", "reset", ["clear"]],
    ["ничего не подходит", "deploy", []],
  ])("%s", (_, query, names) => {
    expect(commandsMatching(COMMANDS, query).map((found) => found.name)).toEqual(names);
  });

  it("из одноимённых остаётся своя команда", () => {
    expect(commandsMatching(COMMANDS, "review")).toEqual([command("review")]);
  });
});
