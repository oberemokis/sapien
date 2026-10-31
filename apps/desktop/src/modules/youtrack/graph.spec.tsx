import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openTaskGraph, TaskDraftForm, TaskGraph } from "@/modules/youtrack";
import type { TaskGraph as Graph } from "./model/youtrack";

function node(id: string, state: string, resolved = false) {
  return {
    id,
    summary: `Задача ${id}`,
    state,
    resolved,
    assignee: null,
    project: id.split("-")[0] ?? "",
    url: `https://acme.youtrack.cloud/issue/${id}`,
  };
}

const GRAPH: Graph = {
  nodes: [node("SAP-1", "Open"), node("SAP-2", "In Progress"), node("WEB-4", "Done", true)],
  edges: [
    { from: "SAP-1", to: "SAP-2", kind: "subtask" },
    { from: "SAP-2", to: "WEB-4", kind: "relates" },
  ],
};

const NOTES = [
  { path: "Задачи/Вход.md", text: "---\nproject: SAP\nyoutrack: SAP-1\n---\n# Вход по ссылке" },
  { path: "Задачи/Письмо.md", text: "---\nproject: SAP\nparent: Задачи/Вход.md\n---\n# Письмо со ссылкой" },
  { path: "Задачи/Один.md", text: "---\nproject: SAP\nyoutrack: SAP-9\n---\n# Одинокая" },
];

type Asked = { ids: string[]; depth: number };

// YouTrack за командами Rust: граф отдаёт тот, что лежит в server сейчас.
function fakeRust(server: { graph: Graph }) {
  const asked: Asked[] = [];
  const opened: string[] = [];

  mockIPC((command, args) => {
    switch (command) {
      case "youtrack_status":
        return { kind: "connected", host: "https://acme.youtrack.cloud", name: "Илья" };
      case "youtrack_graph": {
        const { ids, depth } = args as Asked;

        asked.push({ ids, depth });

        if (ids.includes("SAP-9")) {
          return { nodes: [node("SAP-9", "Open")], edges: [] };
        }

        return server.graph;
      }
      case "open_link":
        opened.push((args as { url: string }).url);

        return null;
      case "youtrack_issue_state":
        return { ...node("SAP-1", "Open"), assignee: null, due: null, links: [] };
      default:
        throw new Error(`нет команды ${command}`);
    }
  });

  return { asked, opened };
}

function launch() {
  const onOpenNote = vi.fn();

  render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskGraph notes={NOTES} onOpenNote={onOpenNote} />
    </QueryClientProvider>,
  );

  return onOpenNote;
}

async function open(path: string) {
  act(() => openTaskGraph(path));

  return screen.findByRole("dialog");
}

function points() {
  return within(screen.getByRole("list", { name: "Задачи графа" }))
    .getAllByRole("button")
    .map((button) => button.textContent);
}

afterEach(() => {
  cleanup();
  clearMocks();
  localStorage.clear();
  focusManager.setFocused(undefined);
  vi.restoreAllMocks();
});

describe("граф связей", () => {
  it("граф черновика показывает задачи и черновики, клик по черновику открывает заметку, по задаче YouTrack", async () => {
    const { asked, opened } = fakeRust({ graph: GRAPH });
    const onOpenNote = launch();
    const dialog = await open("Задачи/Вход.md");

    await waitFor(() => expect(points()).toHaveLength(4));
    expect(dialog.getAttribute("aria-label")).toBe("Граф связей «Задача SAP-1»");
    expect(asked).toEqual([{ ids: ["SAP-1"], depth: 2 }]);
    expect(points()).toContain("Письмо, Письмо со ссылкой, без статуса");
    expect(points()).toContain("WEB-4, Задача WEB-4, Done");

    fireEvent.click(screen.getByRole("button", { name: /^Письмо/ }));

    expect(onOpenNote).toHaveBeenCalledWith("Задачи/Письмо.md");
    expect(screen.queryByRole("dialog")).toBeNull();

    await open("Задачи/Вход.md");
    fireEvent.click(await screen.findByRole("button", { name: /^SAP-2/ }));

    await waitFor(() => expect(opened).toEqual(["https://acme.youtrack.cloud/issue/SAP-2"]));
  });

  it("«Граф связей» в форме черновика открывает граф этой задачи", async () => {
    const { asked } = fakeRust({ graph: GRAPH });
    const [draft] = NOTES;

    render(
      <QueryClientProvider client={new QueryClient()}>
        <TaskDraftForm
          path={draft?.path ?? ""}
          text={draft?.text ?? ""}
          readOnly={false}
          notes={NOTES}
          onOpen={() => undefined}
          onChange={() => undefined}
        />
        <TaskGraph notes={NOTES} onOpenNote={() => undefined} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Граф связей" }));

    expect(await screen.findByRole("dialog", { name: "Граф связей «Вход по ссылке»" })).toBeTruthy();
    await waitFor(() => expect(asked).toEqual([{ ids: ["SAP-1"], depth: 2 }]));
  });

  it("у задачи без связей одна точка и подсказка", async () => {
    fakeRust({ graph: GRAPH });
    launch();
    await open("Задачи/Один.md");

    await waitFor(() => expect(points()).toEqual(["SAP-9, Задача SAP-9, Open"]));
    expect(screen.getByText(/У задачи нет связей/)).toBeTruthy();
  });

  it("глубина и фильтр по статусу меняют граф", async () => {
    const { asked } = fakeRust({ graph: GRAPH });

    launch();
    await open("Задачи/Вход.md");
    await waitFor(() => expect(points()).toHaveLength(4));

    fireEvent.click(screen.getByLabelText("3 связи"));
    await waitFor(() => expect(asked.at(-1)).toEqual({ ids: ["SAP-1"], depth: 3 }));

    fireEvent.change(screen.getByLabelText("Статус"), { target: { value: "In Progress" } });

    expect(points()).toEqual(["SAP-1, Задача SAP-1, Open", "SAP-2, Задача SAP-2, In Progress"]);
  });

  it("связь поменяли в YouTrack: открытый граф обновляется при возврате в окно", async () => {
    const server = { graph: GRAPH };

    fakeRust(server);
    launch();
    await open("Задачи/Вход.md");
    await waitFor(() => expect(points()).toHaveLength(4));

    server.graph = {
      nodes: [...GRAPH.nodes, node("SAP-5", "Open")],
      edges: [...GRAPH.edges, { from: "SAP-5", to: "SAP-1", kind: "blocks" }],
    };
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    await waitFor(() => expect(points()).toContain("SAP-5, Задача SAP-5, Open"));
  });

  it("без сети граф строится по последней загрузке с пометкой", async () => {
    const { asked } = fakeRust({ graph: GRAPH });

    launch();
    await open("Задачи/Вход.md");
    await waitFor(() => expect(points()).toHaveLength(4));
    cleanup();

    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    launch();
    await open("Задачи/Вход.md");

    expect(await screen.findByText(/граф на момент последней загрузки/)).toBeTruthy();
    expect(points()).toHaveLength(4);
    expect(asked).toHaveLength(1);
  });
});
