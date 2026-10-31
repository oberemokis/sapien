import { describe, expect, it } from "vitest";
import { breakdownNotes, breakdownPath, breakdownTask, parseBreakdown } from "./breakdown";
import { familyOf } from "./check";
import { parseDraft } from "./draft";

const EPIC = "Проекты/sapien/Вход.md";
const EPIC_TEXT = "---\nproject: SAP\ntype: Epic\n---\n# Вход без пароля\n";

const BREAKDOWN = `---
breakdown: ${EPIC}
---
# Вход. Разбивка

## 1. Схема ссылок

- Тип: Task
- Оценка: s

Таблица одноразовых ссылок.

## 2. Письмо со ссылкой

- Тип: Feature
- Оценка: M
- Зависит от: 1

Шаблон и отправка.

## 3. Экран входа
- Зависит от: 1, 2
`;

// Подзадача эпика «Задачи/Эпик.md», которая зависит от названных.
function child(name: string, depends: string[] = []) {
  return {
    path: `Задачи/${name}.md`,
    text: `---\nproject: SAP\nparent: [Задачи/Эпик.md]\ndepends_on: [${depends.map((d) => `Задачи/${d}.md`).join(", ")}]\n---\n# ${name}\n`,
  };
}

describe("разбивка агентом", () => {
  it("разбивка лежит рядом с эпиком, задание называет её путь и формат", () => {
    expect(breakdownPath(EPIC)).toBe("Проекты/sapien/Вход. Разбивка.md");
    expect(breakdownPath("Эпик.md")).toBe("Эпик. Разбивка.md");
    expect(breakdownTask(EPIC, "SAP-1")).toContain("«Проекты/sapien/Вход. Разбивка.md»");
    expect(breakdownTask(EPIC, "SAP-1")).toContain("subtask of: SAP-1");
    expect(breakdownTask(EPIC, null)).not.toContain("subtask of");
  });

  it("задачи разбираются с типом, оценкой, зависимостями и описанием", () => {
    const { epic, tasks, problems } = parseBreakdown(BREAKDOWN);

    expect(epic).toBe(EPIC);
    expect(problems).toEqual([]);
    expect(tasks).toEqual([
      { number: 1, title: "Схема ссылок", type: "Task", size: "S", depends: [], description: "Таблица одноразовых ссылок." },
      { number: 2, title: "Письмо со ссылкой", type: "Feature", size: "M", depends: [1], description: "Шаблон и отправка." },
      { number: 3, title: "Экран входа", type: "", size: "", depends: [1, 2], description: "" },
    ]);
    expect(parseBreakdown("# Просто заметка\n").epic).toBeNull();
  });

  it("строки, которые не разобрались, видны с причиной", () => {
    const { problems } = parseBreakdown(
      `---\nbreakdown: ${EPIC}\n---\n## Без номера\n\n## 1. Раз\n- Оценка: XL\n\n## 1. Снова раз\n- Зависит от: 1, 7\n`,
    );

    expect(problems).toEqual([
      { code: "heading", line: "## Без номера" },
      { code: "size", line: "## 1. Раз" },
      { code: "duplicate", line: "## 1. Снова раз" },
      { code: "depends", line: "## 1. Снова раз" },
    ]);
  });

  it("черновики ложатся рядом с эпиком, а уже созданная подзадача второй раз не создаётся", () => {
    const epicDraft = parseDraft(EPIC_TEXT, "Вход")!;
    const notes = [
      { path: EPIC, text: EPIC_TEXT },
      {
        path: "Проекты/sapien/Схема.md",
        text: `---\nproject: SAP\nparent: [${EPIC}]\n---\n# Схема ссылок\n`,
      },
      { path: "Проекты/sapien/Письмо со ссылкой.md", text: "# Чужая заметка\n" },
    ];
    const { tasks } = parseBreakdown(BREAKDOWN);
    const { folder, create, existing } = breakdownNotes(EPIC, epicDraft, tasks, notes);

    expect(folder).toBe("Проекты/sapien");
    expect(existing).toBe(1);
    expect(create.map((note) => note.name)).toEqual(["Письмо со ссылкой 2", "Экран входа"]);

    const letter = parseDraft(create[0]!.text, "")!;
    const screen = parseDraft(create[1]!.text, "")!;

    expect(letter.project).toBe("SAP");
    expect(letter.values.type).toBe("Feature");
    expect(letter.links.parent).toEqual([EPIC]);
    expect(letter.links.depends_on).toEqual(["Проекты/sapien/Схема.md"]);
    expect(create[0]!.text).toContain("size: M");
    expect(screen.values.type).toBe("Task");
    expect(screen.links.depends_on).toEqual(["Проекты/sapien/Схема.md", "Проекты/sapien/Письмо со ссылкой 2.md"]);
  });

  it("публикация идёт от эпика к задачам по зависимостям, цикл в конце", () => {
    const notes = [
      child("В", ["Б"]),
      child("Б", ["А"]),
      child("А"),
      child("Цикл1", ["Цикл2"]),
      child("Цикл2", ["Цикл1"]),
      { path: "Задачи/Чужая.md", text: "---\nproject: SAP\n---\n# Чужая\n" },
    ];
    const epic = parseDraft("---\nproject: SAP\n---\n# Эпик\n", "Эпик")!;

    expect(familyOf("Задачи/Эпик.md", epic, notes).map((node) => node.path)).toEqual([
      "Задачи/Эпик.md",
      "Задачи/А.md",
      "Задачи/Б.md",
      "Задачи/В.md",
      "Задачи/Цикл1.md",
      "Задачи/Цикл2.md",
    ]);
  });
});
