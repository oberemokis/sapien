import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BreakdownForm, TaskDraftForm } from "@/modules/youtrack";
import type { DraftRequest } from "./model/draft";

const EPIC = "Задачи/Вход.md";

const BREAKDOWN = `---
breakdown: ${EPIC}
---
# Вход. Разбивка

## 1. Схема ссылок

- Оценка: S

## 2. Письмо

- Тип: Feature
- Зависит от: 1
`;

afterEach(() => {
  cleanup();
  clearMocks();
});

describe("разбивка в черновики", () => {
  it("черновики создаются только по кнопке, рядом с эпиком и со связями", async () => {
    const onCreate = vi.fn(async (folder: string, notes: { name: string; text: string }[]) =>
      notes.map((note) => `${folder}/${note.name}.md`),
    );
    const notes = [{ path: EPIC, text: "---\nproject: SAP\ntype: Epic\n---\n# Вход\n" }];

    render(<BreakdownForm text={BREAKDOWN} notes={notes} readOnly={false} onCreate={onCreate} onOpen={() => undefined} />);

    expect(screen.getByText("задач: 2, уже есть черновиков: 0")).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Создать черновики: 2" }));

    await screen.findByText(/Черновиков создано: 2/);

    const [folder, created] = onCreate.mock.calls[0]!;

    expect(folder).toBe("Задачи");
    expect(created.map((note) => note.name)).toEqual(["Схема ссылок", "Письмо"]);
    expect(created[1]?.text).toContain("depends_on: [Задачи/Схема ссылок.md]");
  });

  it("строка, которая не разобралась, видна с причиной и держит создание", () => {
    const notes = [{ path: EPIC, text: "---\nproject: SAP\n---\n# Вход\n" }];

    render(
      <BreakdownForm
        text={BREAKDOWN.replace("- Оценка: S", "- Оценка: XL")}
        notes={notes}
        readOnly={false}
        onCreate={async () => []}
        onOpen={() => undefined}
      />,
    );

    expect(screen.getByText("«## 1. Схема ссылок»: оценка бывает только S, M или L")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Создать черновики: 2" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

// Эпик и две задачи: Письмо зависит от Схемы. YouTrack нумерует задачи
// с SAP-100 и один раз обрывается на заданной по счёту публикации.
function fakeYoutrack(breakAt: number) {
  const published: DraftRequest[] = [];
  let calls = 0;

  mockIPC((command, args) => {
    const { draft } = args as { draft: DraftRequest };

    switch (command) {
      case "youtrack_status":
        return { kind: "connected", host: "https://acme.youtrack.cloud", name: "Илья" };
      case "youtrack_check":
        return { projectFound: true, missing: [], issues: [] };
      case "youtrack_publish":
        calls += 1;

        if (calls === breakAt) {
          throw { kind: "unavailable", code: "youtrack_unreachable" };
        }

        published.push(draft);
        return { kind: "done", id: `SAP-${99 + published.length}`, failed: [] };
      case "youtrack_issue_state":
        return { id: "SAP-100", state: "Open", assignee: null, url: "https://acme.youtrack.cloud/issue/SAP-100" };
      default:
        throw new Error(`нет команды ${command}`);
    }
  });

  return published;
}

const FAMILY = {
  [EPIC]: "---\nproject: SAP\ntype: Epic\n---\n# Вход\n\n## Проверка\n\n- работает\n",
  "Задачи/Письмо.md": `---\nproject: SAP\nparent: [${EPIC}]\ndepends_on: [Задачи/Схема.md]\n---\n# Письмо\n\n## Проверка\n\n- уходит\n`,
  "Задачи/Схема.md": `---\nproject: SAP\nparent: [${EPIC}]\n---\n# Схема\n\n## Проверка\n\n- есть\n`,
};

// Хранилище в памяти: форма эпика и запись номеров в заметки.
function Vault({ writes }: { writes: string[] }) {
  const [texts, setTexts] = useState<Record<string, string>>(FAMILY);

  async function onWrite(path: string, text: string) {
    writes.push(path);
    setTexts((before) => ({ ...before, [path]: text }));

    return true;
  }

  return (
    <TaskDraftForm
      path={EPIC}
      text={texts[EPIC] ?? ""}
      readOnly={false}
      onChange={(text) => setTexts((before) => ({ ...before, [EPIC]: text }))}
      notes={Object.entries(texts).map(([path, text]) => ({ path, text }))}
      onOpen={() => undefined}
      onWrite={onWrite}
    />
  );
}

describe("опубликовать всё", () => {
  it("эпик первым, задача после той, от которой зависит, а повтор после обрыва идёт с места остановки", async () => {
    const published = fakeYoutrack(3);
    const writes: string[] = [];

    render(
      <QueryClientProvider client={new QueryClient()}>
        <Vault writes={writes} />
      </QueryClientProvider>,
    );

    const run = await screen.findByRole("button", { name: "Опубликовать всё" });

    await waitFor(() => expect((run as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(run);

    expect(await screen.findByText(/^Остановлено на «Письмо»: Сервер не отвечает/)).toBeTruthy();
    expect(writes).toEqual([EPIC, "Задачи/Схема.md"]);
    expect(screen.getByText("черновиков: 3, не опубликовано: 1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Опубликовать всё" }));

    expect(await screen.findByText("Опубликовано: 1.")).toBeTruthy();
    expect(published.map((draft) => draft.summary)).toEqual(["Вход", "Схема", "Письмо"]);
    expect(published[2]?.links).toEqual([
      { kind: "parent", id: "SAP-100" },
      { kind: "dependsOn", id: "SAP-101" },
    ]);
  });
});
