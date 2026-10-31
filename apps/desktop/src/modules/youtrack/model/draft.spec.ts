import { describe, expect, it } from "vitest";
import { withFrontmatterList } from "@/core/markdown/frontmatter";
import { draftRequest, parseDraft, resolveLinks, withIssueText } from "./draft";

const NOTE = `---
project: SAP
type: Feature
assignee: ilya
depends_on: [SAP-3, Проекты/Почта.md]
parent: SAP-1
fields:
  Subsystem: Backend
tags: [работа]
---
# Вход по ссылке

Письмо со ссылкой вместо пароля.

## Проверка

- ссылка живёт 15 минут
`;

describe("черновик задачи", () => {
  it("заметка без проекта в шапке не черновик", () => {
    expect(parseDraft("---\ntags: [работа]\n---\n# Идеи\n", "Идеи")).toBeNull();
    expect(parseDraft("# Идеи\n", "Идеи")).toBeNull();
  });

  it("название из заголовка, описание из текста под ним, поля и связи из шапки", () => {
    const draft = parseDraft(NOTE, "Вход");

    expect(draft).not.toBeNull();
    expect(draftRequest(draft!)).toEqual({
      project: "SAP",
      summary: "Вход по ссылке",
      description: "Письмо со ссылкой вместо пароля.\n\n## Проверка\n\n- ссылка живёт 15 минут",
      fields: [
        { name: "Type", value: "Feature" },
        { name: "Assignee", value: "ilya" },
        { name: "Subsystem", value: "Backend" },
      ],
      links: [
        { kind: "parent", id: "SAP-1" },
        { kind: "dependsOn", id: "SAP-3" },
        { kind: "dependsOn", id: "Проекты/Почта.md" },
      ],
    });
    expect(draft!.id).toBeNull();
  });

  it("связь на черновик встаёт номером его задачи, неопубликованный держит публикацию", () => {
    const draft = parseDraft(NOTE, "Вход")!;
    const before = resolveLinks(draft, [{ path: "Проекты/Почта.md", text: "---\nproject: SAP\n---\n# Почта\n" }]);
    const after = resolveLinks(draft, [{ path: "Проекты/Почта.md", text: "---\nproject: SAP\nyoutrack: SAP-7\n---\n" }]);

    expect(before.unpublished).toEqual(["Проекты/Почта.md"]);
    expect(after.unpublished).toEqual([]);
    expect(after.draft.links.depends_on).toEqual(["SAP-3", "SAP-7"]);
  });

  it("путь черновика с пробелами читается целиком, записанный формой и строками списка", () => {
    const written = withFrontmatterList(NOTE, "relates_to", ["SAP-4", "Проекты/Вход по коду.md"]);
    const block = "---\nproject: SAP\nrelates_to:\n  - SAP-4\n  - Проекты/Вход по коду.md\n---\n";

    expect(parseDraft(written, "Вход")?.links.relates_to).toEqual(["SAP-4", "Проекты/Вход по коду.md"]);
    expect(parseDraft(block, "Вход")?.links.relates_to).toEqual(["SAP-4", "Проекты/Вход по коду.md"]);
  });

  it("без заголовка название это имя заметки", () => {
    const draft = parseDraft("---\nproject: SAP\nyoutrack: SAP-12\n---\nПросто текст.\n", "Вход");

    expect(draft?.summary).toBe("Вход");
    expect(draft?.description).toBe("Просто текст.");
    expect(draft?.id).toBe("SAP-12");
  });

  it("текст из YouTrack встаёт под шапку, шапка остаётся", () => {
    const text = withIssueText(NOTE, "Вход по коду", "Код в письме.");

    expect(text.startsWith("---\nproject: SAP\n")).toBe(true);
    expect(text.endsWith("---\n# Вход по коду\n\nКод в письме.\n")).toBe(true);
  });
});
