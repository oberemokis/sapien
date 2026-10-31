import { describe, expect, it } from "vitest";
import { duplicateFindings, localFindings, remoteFindings, type Finding } from "./check";
import { parseDraft } from "./draft";

function draftOf(header: string, body = "# Задача\n\n## Проверка\n\n- работает\n") {
  return parseDraft(`---\nproject: SAP\n${header}\n---\n${body}`, "Задача")!;
}

// Код находки, «!» у той, что держит публикацию, и о чём она.
function codes(findings: Finding[]) {
  return findings.map((finding) =>
    `${finding.code}${"!".repeat(Number(finding.blocking))} ${finding.values.subject ?? ""}`.trim(),
  );
}

describe("проверка связей", () => {
  it("цикл через три черновика находится, «блокирует» считается зависимостью", () => {
    const notes = [
      { path: "Задачи/Б.md", text: "---\nproject: SAP\ndepends_on: [Задачи/В.md]\n---\n" },
      { path: "Задачи/В.md", text: "---\nproject: SAP\nyoutrack: SAP-7\ndepends_on: [Задачи/А.md]\n---\n" },
    ];
    const findings = localFindings("Задачи/А.md", draftOf("depends_on: [Задачи/Б.md]"), notes);
    const cycle = findings.find((finding) => finding.code === "cycle");

    expect(cycle?.blocking).toBe(true);
    expect(cycle?.values.subject).toBe("А → Б → В → А");
    expect(cycle?.drafts).toEqual(["Задачи/А.md", "Задачи/Б.md", "Задачи/В.md"]);

    // Без зависимости В от А цикла нет, а «А блокирует В» это она же.
    const open = [notes[0]!, { path: "Задачи/В.md", text: "---\nproject: SAP\n---\n" }];

    expect(codes(localFindings("Задачи/А.md", draftOf("depends_on: [Задачи/Б.md]"), open))).toEqual([]);
    expect(
      codes(localFindings("Задачи/А.md", draftOf("depends_on: [Задачи/Б.md]\nblocks: [Задачи/В.md]"), open)),
    ).toContain("cycle! А → Б → В → А");
  });

  it("локально: черновика нет, эпик в другом проекте, зависимость позже, нет «Проверки»", () => {
    const notes = [{ path: "Задачи/Б.md", text: "---\nproject: SAP\nsprint: Sprint 7\n---\n" }];
    const draft = draftOf(
      "sprint: Sprint 5\nparent: WEB-1\ndepends_on: [Задачи/Б.md, Задачи/Нет.md]",
      "# Задача\n\n## Проверка\n",
    );

    expect(codes(localFindings("Задачи/А.md", draft, notes))).toEqual([
      "parent_project WEB-1",
      "later_sprint Задачи/Б.md",
      "draft_missing! Задачи/Нет.md",
      "no_check",
    ]);
  });

  it("по ответу YouTrack: нет задачи держит публикацию, закрытая предупреждает, поправленное уходит", () => {
    const checked = {
      projectFound: true,
      missing: ["Subsystem", "Priority"],
      issues: [
        { id: "SAP-404", found: false, resolved: false, sprint: null, due: null },
        { id: "SAP-3", found: true, resolved: true, sprint: "Sprint 9", due: null },
      ],
    };
    const before = draftOf("sprint: Sprint 5\ndepends_on: [SAP-3]\nrelates_to: [SAP-404]");
    const after = draftOf("sprint: Sprint 5\npriority: Major\nfields:\n  Subsystem: Backend\ndepends_on: [SAP-3]");

    expect(codes(remoteFindings("Задачи/А.md", before, [], checked))).toEqual([
      "required! Subsystem",
      "required! Priority",
      "issue_closed SAP-3",
      "later_sprint SAP-3",
      "issue_missing! SAP-404",
    ]);
    expect(codes(remoteFindings("Задачи/А.md", after, [], checked))).toEqual(["issue_closed SAP-3", "later_sprint SAP-3"]);
    expect(codes(remoteFindings("Задачи/А.md", before, [], { ...checked, projectFound: false, missing: [] }))).toContain(
      "project_missing! SAP",
    );
  });

  it("кандидат в дубли с общими словами, кроме отмеченных «это не дубль» и связанных", () => {
    const similar = [
      { id: "SAP-5", summary: "Вход по ссылке из письма" },
      { id: "SAP-6", summary: "Ссылка на отчёт" },
      { id: "SAP-7", summary: "Вход по ссылке для гостей" },
      { id: "SAP-8", summary: "Вход через ссылке" },
    ];
    const draft = parseDraft("---\nproject: SAP\nnot_duplicates: [SAP-7]\nrelates_to: [SAP-8]\n---\n# Вход по ссылке\n", "")!;
    const findings = duplicateFindings(draft, similar);

    expect(findings.map((finding) => finding.values)).toEqual([
      { subject: "SAP-5", summary: "Вход по ссылке из письма", words: "вход, ссылке" },
    ]);
    expect(findings[0]?.blocking).toBe(false);
  });
});
