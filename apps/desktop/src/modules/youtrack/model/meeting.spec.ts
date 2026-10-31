import { describe, expect, it } from "vitest";
import { parseDraft } from "./draft";
import { assigneeOf, draftNames, meetingDraftOf, meetingDraftText } from "./meeting";

const PEOPLE = [
  { login: "ilya", name: "Илья Оберемок" },
  { login: "i.petrov", name: "Илья Петров" },
  { login: "anna", name: "Анна Семёнова" },
];

describe("черновики из встречи", () => {
  it("исполнитель находится по имени или логину, а двое подходящих или никто дают пусто", () => {
    expect(assigneeOf("Илья Оберемок", PEOPLE)).toBe("ilya");
    expect(assigneeOf("Анна", PEOPLE)).toBe("anna");
    expect(assigneeOf("семенова", PEOPLE)).toBe("anna");
    expect(assigneeOf("petrov", PEOPLE)).toBe("i.petrov");
    expect(assigneeOf("Илья", PEOPLE)).toBeNull();
    expect(assigneeOf("Петя", PEOPLE)).toBeNull();
    expect(assigneeOf("", PEOPLE)).toBeNull();
  });

  it("черновик читается формой: проект, исполнитель, срок, связи и цитата со встречи", () => {
    const draft = meetingDraftOf(
      {
        summary: "Подготовить письмо: вход по ссылке",
        description: "Шаблон письма для входа без пароля.",
        assignee: "Анна",
        due: "2026-11-07",
        issues: ["SAP-12", "SAP-3"],
        quote: "Анна к пятнице готовит письмо,\nсм. SAP-12.",
      },
      PEOPLE,
    );
    const text = meetingDraftText(draft, "SAP", "Встречи/Планёрка 30.10.md");
    const parsed = parseDraft(text, "Подготовить письмо");

    expect(parsed?.project).toBe("SAP");
    expect(parsed?.values.assignee).toBe("anna");
    expect(parsed?.links.relates_to).toEqual(["SAP-12", "SAP-3"]);
    expect(parsed?.custom).toEqual([{ name: "Due Date", value: "2026-11-07" }]);
    expect(text).toContain("> Анна к пятнице готовит письмо,\n> см. SAP-12.");
    expect(text).toContain("Из встречи «Планёрка 30.10».");
    expect(text).toContain("## Проверка");
  });

  it("без проекта и исполнителя черновик остаётся черновиком, а срок не датой не берётся", () => {
    const draft = meetingDraftOf(
      { summary: "Обновить план", description: "", assignee: "Петя", due: "пятница", issues: [], quote: "" },
      PEOPLE,
    );
    const text = meetingDraftText(draft, "", "Встречи/кофе.md");

    expect(draft.assignee).toBe("");
    expect(draft.due).toBe("");
    expect(parseDraft(text, "Обновить план")?.project).toBe("");
    expect(text).not.toContain("assignee");
    expect(text).not.toContain("fields");
  });

  it("имена файлов без запрещённых знаков и без повторов", () => {
    expect(
      draftNames(["Вход: по ссылке?", "Вход  по ссылке", "#[]", "Обновить план"], ["Задачи/Обновить план.md"]),
    ).toEqual(["Вход по ссылке", "Вход по ссылке 2", "Задача", "Обновить план 2"]);
  });
});
