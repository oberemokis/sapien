import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeetingDrafts } from "@/modules/youtrack";
import { changeDefaultProject } from "./interactions/project";
import type { MeetingTask } from "./model/meeting";

function task(summary: string, assignee: string): MeetingTask {
  return { summary, description: `${summary}, по встрече.`, assignee, due: "", issues: [], quote: `${summary}!` };
}

// В проекте SAP исполнителем можно назначить только Анну. Без подключения
// Rust отвечает отказом, как use_case.rs.
function fakeRust(connected = true) {
  mockIPC((command, args) => {
    if (command !== "youtrack_assignees") {
      throw new Error(`нет команды ${command}`);
    }

    if (!connected) {
      throw { kind: "not_found", code: "youtrack_not_connected" };
    }

    expect(args).toEqual({ project: "SAP" });
    return [{ login: "anna", name: "Анна Семёнова" }];
  });
}

function open(tasks: MeetingTask[] | null, problem: string | null = null) {
  const onCreate = vi.fn<(notes: { name: string; text: string }[]) => Promise<void>>(async () => undefined);

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MeetingDrafts
        source="Встречи/Планёрка.md"
        tasks={tasks}
        problem={problem}
        paths={["Задачи/План.md"]}
        onCreate={onCreate}
        onClose={() => undefined}
      />
    </QueryClientProvider>,
  );

  return onCreate;
}

beforeEach(() => {
  changeDefaultProject("SAP");
});

afterEach(() => {
  cleanup();
  clearMocks();
});

describe("задачи из встречи", () => {
  it("исполнитель не из YouTrack пуст и подсвечен, создаются только отмеченные", async () => {
    fakeRust();
    const onCreate = open([task("Письмо", "Анна"), task("План", "Петя"), task("Лишнее", "")]);

    const assignees = await screen.findAllByLabelText("Исполнитель");

    expect(assignees.map((input) => (input as HTMLInputElement).value)).toEqual(["anna", "", ""]);
    expect(assignees.map((input) => input.getAttribute("aria-invalid"))).toEqual([null, "true", null]);
    expect(screen.getByText(/назван «Петя», а в проекте YouTrack такого исполнителя нет/)).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: "Создать черновик «Лишнее»" }));
    fireEvent.change(assignees[1]!, { target: { value: "petr" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать черновики: 2" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());

    const notes = onCreate.mock.calls[0]?.[0] ?? [];

    expect(notes.map((note) => note.name)).toEqual(["Письмо", "План 2"]);
    expect(notes[0]?.text).toContain("assignee: anna");
    expect(notes[1]?.text).toContain("assignee: petr");
    expect(notes[1]?.text).toContain("> План!");
  });

  it("встреча без действий: агент так и говорит, создавать нечего", async () => {
    fakeRust();
    open([]);

    expect(await screen.findByText("Во встрече нет договорённостей и действий: черновиков не будет.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Создать черновики/ })).toBeNull();
  });

  it("пока агент читает, окно ждёт, а его отказ показывает", async () => {
    fakeRust();
    open(null);

    expect(screen.getByText("Агент читает встречу целиком, это может занять минуту.")).toBeTruthy();

    cleanup();
    open(null, "Нет связи с Anthropic: проверьте сеть.");

    expect(within(screen.getByRole("alert")).getByText("Нет связи с Anthropic: проверьте сеть.")).toBeTruthy();
  });

  it("без YouTrack исполнителя не сверить, и подсказка говорит почему", async () => {
    fakeRust(false);
    open([task("Письмо", "Анна")]);

    const [assignee] = await screen.findAllByLabelText("Исполнитель");

    expect(assignee?.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/сверить не с чем: YouTrack не подключён/)).toBeTruthy();
  });
});
