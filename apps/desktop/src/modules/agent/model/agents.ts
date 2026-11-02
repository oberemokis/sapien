import type { SessionInfo } from "./sessions";

// Модель агента, как AgentModel в domain.rs. id уходит агенту, resolved это
// полное имя модели за псевдонимом вроде «opus», efforts это уровни
// размышления, которые модель понимает.
export type AgentModel = { id: string; resolved: string | null; name: string; description: string; efforts: string[] };

// Агент на устройстве, как Provider в domain.rs. Список приходит только
// с установленными агентами, а модели в нём те, что агент назвал сам.
export type Provider = { id: string; name: string; models: AgentModel[] };

// Команда агента, как AgentCommand в domain.rs: своя команда, скил,
// команда плагина или встроенная. Её пишут в начале сообщения:
// «/name аргументы». hint подсказывает аргументы, например «<file>».
export type AgentCommand = { name: string; description: string; hint: string; aliases: string[]; builtin: boolean };

// Субагент, которому агент может отдать часть работы.
export type Subagent = { name: string; description: string };

// Команды и субагенты агента в папке проекта: у проекта свои команды,
// скилы и плагины.
export type Commands = { commands: AgentCommand[]; agents: Subagent[] };

// Команды под набранное после «/»: по имени и другим именам команды.
// Свои команды и скилы выше встроенных. У команд с одним именем
// остаётся одна: агент всё равно выполнит одну из них.
export function commandsMatching(commands: AgentCommand[], query: string) {
  const seen = new Set<string>();
  const words = query.toLowerCase();

  return commands
    .filter((command) => [command.name, ...command.aliases].some((name) => name.toLowerCase().includes(words)))
    .toSorted((a, b) => Number(a.builtin) - Number(b.builtin))
    .filter((command) => {
      if (seen.has(command.name)) {
        return false;
      }

      seen.add(command.name);
      return true;
    });
}

// Уровни размышления, которые принимает Rust.
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export type Effort = (typeof EFFORTS)[number];

export function isEffort(value: string | null): value is Effort {
  return EFFORTS.some((effort) => effort === value);
}

// С чем сессия отвечает: агент, модель и уровень размышления. model null:
// модель агента по умолчанию, effort null: уровень модели по умолчанию.
export type Choice = { provider: string; model: string | null; effort: Effort | null };

// То, с чем ушло последнее сообщение сессии. null: сессия ещё не отвечала.
export function savedChoice(session: SessionInfo): Choice | null {
  if (session.model === null) {
    return null;
  }

  let effort: Effort | null = null;

  if (isEffort(session.effort)) {
    effort = session.effort;
  }

  return { provider: session.provider, model: session.model, effort };
}

// Что хочет сессия: выбранное в ней, иначе то, с чем она отвечала, иначе
// последний выбор окна. Агент сессии, которая уже отвечала, не меняется:
// разговор продолжает тот же агент.
export function wantedChoice(session: SessionInfo, picked: Choice | null, last: Choice | null): Choice | null {
  const saved = savedChoice(session);
  const wanted = picked ?? saved ?? last;

  if (wanted === null || saved === null) {
    return wanted;
  }

  return { ...wanted, provider: saved.provider };
}

export function modelOf(provider: Provider, model: string | null) {
  return provider.models.find((candidate) => candidate.id === model || candidate.resolved === model);
}

// Выбор, который годится установленным агентам. Агента нет на устройстве,
// берётся первый и выбор в нём начинается заново, модели нет в списке,
// первая модель, уровня нет у модели, уровень по умолчанию. Агент
// не назвал моделей: выбор остаётся как есть, решит сам агент. null:
// агентов нет.
export function fitChoice(wanted: Choice | null, providers: Provider[]): Choice | null {
  const provider = providers.find((candidate) => candidate.id === wanted?.provider) ?? providers[0];

  if (provider === undefined) {
    return null;
  }

  if (wanted?.provider !== provider.id) {
    return fitChoice({ provider: provider.id, model: null, effort: null }, [provider]);
  }

  if (provider.models.length === 0) {
    return wanted;
  }

  const model = modelOf(provider, wanted.model) ?? provider.models[0];
  let effort = wanted.effort;

  if (model === undefined || (effort !== null && !model.efforts.includes(effort))) {
    effort = null;
  }

  return { provider: provider.id, model: model?.id ?? null, effort };
}
