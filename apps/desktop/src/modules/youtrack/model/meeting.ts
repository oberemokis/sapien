import { withFrontmatterList, withFrontmatterMap, withFrontmatterValue } from "@/core/markdown/frontmatter";
import { CUSTOM_KEY, noteTitle } from "./draft";
import type { Person } from "./youtrack";

// Действие со встречи, которое предложил агент: так его отдаёт команда
// agent_meeting_tasks. assignee это имя, как его назвали на встрече.
export type MeetingTask = {
  summary: string;
  description: string;
  assignee: string;
  due: string;
  issues: string[];
  quote: string;
};

// Черновик из встречи, как его поправил человек. assignee это логин,
// links это номера задач через запятую.
export type MeetingDraft = {
  summary: string;
  description: string;
  assignee: string;
  due: string;
  links: string;
  quote: string;
};

// Черновики из встречи ложатся в папку задач в корне хранилища.
export const MEETING_FOLDER = "Задачи";

function wordsOf(text: string) {
  return text
    .toLowerCase()
    .replaceAll("ё", "е")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
}

// Исполнитель по имени со встречи: человек проекта, у которого в полном
// имени или логине есть все слова имени. Подходит не один или никто,
// исполнителя нет: выбирать между двумя Ильями человек будет сам.
export function assigneeOf(name: string, people: Person[]) {
  const words = wordsOf(name);

  if (words.length === 0) {
    return null;
  }

  const found = people.filter((person) => {
    const known = new Set([...wordsOf(person.name), ...wordsOf(person.login)]);

    return words.every((word) => known.has(word));
  });

  if (found.length !== 1) {
    return null;
  }

  return found[0]?.login ?? null;
}

// Черновик из предложения агента. Срок не датой агент мог придумать сам,
// такой не берётся.
export function meetingDraftOf(task: MeetingTask, people: Person[]): MeetingDraft {
  let due = "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(task.due)) {
    due = task.due;
  }

  return {
    summary: task.summary,
    description: task.description,
    assignee: assigneeOf(task.assignee, people) ?? "",
    due,
    links: task.issues.join(", "),
    quote: task.quote,
  };
}

// Текст заметки-черновика: шапка, как у шаблона задачи, описание, цитата
// со встречи и пустой раздел «Проверка», который человек допишет.
export function meetingDraftText(draft: MeetingDraft, project: string, source: string) {
  const parts = [`# ${draft.summary.trim()}`, draft.description.trim()];
  const quote = draft.quote.trim();

  if (quote !== "") {
    parts.push(
      quote
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n"),
    );
  }

  parts.push(`Из встречи «${noteTitle(source)}».`, "## Проверка\n");

  const body = parts.filter((part) => part !== "").join("\n\n");
  let text = `---\n${`project: ${project}`.trim()}\ntype: Task\n---\n${body}`;
  const due = [];

  if (draft.due !== "") {
    due.push({ name: "Due Date", value: draft.due });
  }

  text = withFrontmatterValue(text, "assignee", draft.assignee);
  text = withFrontmatterList(text, "relates_to", draft.links.split(/[\s,]+/));
  text = withFrontmatterMap(text, CUSTOM_KEY, due);

  return text;
}

// Имена файлов черновиков: название без знаков, которые не годятся в имени
// файла или ломают ссылку Obsidian. Занятое имя, в папке или среди этих же
// черновиков, получает номер.
export function draftNames(summaries: string[], paths: string[]) {
  const taken = new Set(paths);

  return summaries.map((summary) => {
    const base =
      summary
        .replaceAll(/[\\/:*?"<>|#^[\]]/g, " ")
        .replaceAll(/\s+/g, " ")
        .trim()
        .slice(0, 100)
        .trim() || "Задача";
    let name = base;

    for (let index = 2; taken.has(`${MEETING_FOLDER}/${name}.md`); index += 1) {
      name = `${base} ${index}`;
    }

    taken.add(`${MEETING_FOLDER}/${name}.md`);
    return name;
  });
}
