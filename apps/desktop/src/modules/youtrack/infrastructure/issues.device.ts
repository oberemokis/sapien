import { appStorage } from "@/core/storage/app-storage";
import type { IssueState } from "../model/youtrack";

const STORAGE_KEY = "sapien.youtrack.known";
// Задач в памяти не больше этого: давно не виденные уходят первыми.
const LIMIT = 500;

type Known = { projects: string[]; issues: Record<string, IssueState> };

// Названия задач лежат в хранилище приложения, зашифрованными. Испорченное
// или пропавшее это пустое последнее известное: плашки ждут ответа YouTrack.
function read(): Known {
  try {
    const known: Partial<Known> | null = JSON.parse(appStorage.getItem(STORAGE_KEY) ?? "null");

    return { projects: known?.projects ?? [], issues: known?.issues ?? {} };
  } catch {
    return { projects: [], issues: {} };
  }
}

function write(known: Known) {
  appStorage.setItem(STORAGE_KEY, JSON.stringify(known));
}

// Проекты и задачи на момент последнего ответа YouTrack: без сети плашки
// показывают их.
export function knownProjects() {
  return read().projects;
}

export function rememberProjects(projects: string[]) {
  write({ ...read(), projects });
}

export function knownIssue(id: string): IssueState | undefined {
  return read().issues[id];
}

export function rememberIssue(state: IssueState) {
  const { projects, issues } = read();
  const rest = Object.entries(issues).filter(([id]) => id !== state.id);

  write({ projects, issues: Object.fromEntries([...rest.slice(-(LIMIT - 1)), [state.id, state]]) });
}

export function forgetIssue(id: string) {
  const { projects, issues } = read();

  write({ projects, issues: Object.fromEntries(Object.entries(issues).filter(([known]) => known !== id)) });
}
