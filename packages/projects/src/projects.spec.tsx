import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeRust } from "@sapien/ipc/fake";
import { clearMocks } from "@tauri-apps/api/mocks";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@sapien/ipc";
import { ProjectHeader, ProjectList, ProjectsHeader, RemoveProject } from "./index";

const SAPIEN: Project = { id: "p1", name: "sapien", path: "/Users/me/sapien", missing: false };
const SITE: Project = { id: "p2", name: "сайт", path: "/Users/me/сайт", missing: true };
// Папка, которую человек выберет в системном диалоге.
const DOCS: Project = { id: "p3", name: "документы", path: "/Users/me/документы", missing: false };

// Проект, как его показывает окно: шапка, по правой кнопке вопрос
// об удалении.
function Row({ project, onRemoved }: { project: Project; onRemoved: () => Promise<unknown> }) {
  const [removing, setRemoving] = useState(false);

  return (
    <li>
      <ProjectHeader project={project} onContextMenu={() => setRemoving(true)} />
      {removing && <RemoveProject project={project} onRemoved={onRemoved} onClose={() => setRemoving(false)} />}
    </li>
  );
}

function open({ onAdded = () => Promise.resolve(), onRemoved = () => Promise.resolve() } = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ProjectsHeader onAdded={onAdded} />
      <ProjectList>{(project) => <Row key={project.id} project={project} onRemoved={onRemoved} />}</ProjectList>
    </QueryClientProvider>,
  );
}

function names() {
  return screen.queryAllByRole("listitem").map((item) => item.querySelector("[title] > span:nth-child(2)")?.textContent);
}

afterEach(() => {
  clearMocks();
});

describe("проекты", () => {
  it("пустой список говорит, с чего начать, а пропавшая папка видна в шапке проекта", async () => {
    const rust = fakeRust();
    open();

    expect(await screen.findByText("Проектов пока нет. Добавьте папку, в которой агент будет работать.")).toBeTruthy();

    rust.state.projects = [SAPIEN, SITE];
    fireEvent.click(screen.getByRole("button", { name: "Добавить проект" }));

    await waitFor(() => expect(names()).toEqual(["sapien", "сайт"]));
    expect(screen.getByTitle("/Users/me/сайт").textContent).toContain("нет папки");
  });

  it("добавленный проект появляется в списке и уходит в onAdded, закрытый диалог ничего не добавляет", async () => {
    const rust = fakeRust({ state: { projects: [SAPIEN], picked: DOCS } });
    const onAdded = vi.fn(() => Promise.resolve());
    open({ onAdded });
    await waitFor(() => expect(names()).toEqual(["sapien"]));

    fireEvent.click(screen.getByRole("button", { name: "Добавить проект" }));

    await waitFor(() => expect(names()).toEqual(["sapien", "документы"]));
    expect(onAdded).toHaveBeenCalledWith(DOCS);

    rust.state.picked = null;
    fireEvent.click(screen.getByRole("button", { name: "Добавить проект" }));

    await waitFor(() => expect(rust.calls.projectsAdd).toHaveLength(2));
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("отказ Rust или onAdded при добавлении виден под заголовком", async () => {
    const rust = fakeRust({ state: { picked: DOCS } });
    rust.refuse("projectsAdd", { kind: "unavailable", code: "projects_unwritable" }, 1);
    open({ onAdded: () => Promise.reject(new Error("сессия не завелась")) });

    fireEvent.click(await screen.findByRole("button", { name: "Добавить проект" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Не удалось добавить проект или начать сессию, попробуйте ещё раз.");

    fireEvent.click(screen.getByRole("button", { name: "Добавить проект" }));

    await waitFor(() => expect(names()).toEqual(["документы"]));
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("убрать проект можно только подтвердив, отказ Rust оставляет вопрос открытым", async () => {
    const rust = fakeRust({ state: { projects: [SAPIEN, DOCS] } });
    const onRemoved = vi.fn(() => Promise.resolve());
    open({ onRemoved });
    await waitFor(() => expect(names()).toEqual(["sapien", "документы"]));

    fireEvent.contextMenu(screen.getByTitle(DOCS.path));
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Отмена" }));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(rust.calls.projectsRemove).toEqual([]);

    rust.refuse("projectsRemove", { kind: "conflict", code: "agent_busy" }, 1);
    fireEvent.contextMenu(screen.getByTitle(DOCS.path));
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Убрать" }));

    expect(await screen.findByText("Не удалось убрать проект. Если агент отвечает в нём, остановите ответ.")).toBeTruthy();
    expect(names()).toEqual(["sapien", "документы"]);

    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Убрать" }));

    await waitFor(() => expect(names()).toEqual(["sapien"]));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(rust.calls.projectsRemove).toEqual([["p3"], ["p3"]]);
    expect(onRemoved).toHaveBeenCalledTimes(2);
  });
});
