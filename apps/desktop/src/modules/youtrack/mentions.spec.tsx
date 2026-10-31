import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIssueMentions } from "@/modules/youtrack";
import type { IssueState } from "./model/youtrack";

const LOGIN: IssueState = {
  id: "SAP-1",
  summary: "Вход по ссылке",
  state: "In Progress",
  resolved: false,
  assignee: "Илья Оберемок",
  due: Date.UTC(2026, 11, 31, 12),
  links: [{ kind: "depends on", ids: ["SAP-2", "SAP-3"] }],
  url: "https://acme.youtrack.cloud/issue/SAP-1",
};

// YouTrack с проектом SAP и одной задачей. up: false это сервер, который
// не отвечает, как его видит youtrack_status.
function fakeRust(server: { state: string; up: boolean; connected: boolean }) {
  const asked: string[] = [];

  mockIPC((command, args) => {
    const { id } = args as { id?: string };

    if (!server.connected) {
      return { kind: "none" };
    }

    if (command === "youtrack_status" && !server.up) {
      return { kind: "broken", host: "https://acme.youtrack.cloud", code: "youtrack_unreachable" };
    }

    if (!server.up) {
      throw { kind: "unavailable", code: "youtrack_unreachable" };
    }

    switch (command) {
      case "youtrack_status":
        return { kind: "connected", host: "https://acme.youtrack.cloud", name: "Илья" };
      case "youtrack_projects":
        return ["SAP"];
      case "youtrack_issue_state":
        asked.push(id ?? "");

        if (id !== "SAP-1") {
          throw { kind: "not_found", code: "youtrack_missing" };
        }

        return { ...LOGIN, state: server.state };
      default:
        throw new Error(`нет команды ${command}`);
    }
  });

  return asked;
}

function mentions(text: string) {
  const client = new QueryClient();

  return renderHook(() => useIssueMentions(text), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

afterEach(() => {
  cleanup();
  clearMocks();
  localStorage.clear();
  vi.useRealTimers();
});

describe("номера задач в заметке", () => {
  it("номер проекта YouTrack получает статус и карточку, чужой префикс не спрашивается", async () => {
    const asked = fakeRust({ state: "In Progress", up: true, connected: true });
    const { result } = mentions("SAP-1 после SAP-404, а ABC-1 не наш");

    await waitFor(() => expect(result.current?.mentions.size).toBe(2));

    expect(result.current?.prefixes).toEqual(new Set(["SAP"]));
    expect(result.current?.mentions.get("SAP-1")).toEqual({
      label: "In Progress",
      muted: false,
      title: "SAP-1 Вход по ссылке",
      details: [
        "Статус: In Progress",
        "Исполнитель: Илья Оберемок",
        expect.stringMatching(/^Срок: 31 декабря 2026/),
        "depends on: SAP-2, SAP-3",
      ],
    });
    expect(result.current?.mentions.get("SAP-404")).toMatchObject({ label: "не найдена", muted: true });
    expect(asked.toSorted()).toEqual(["SAP-1", "SAP-404"]);
  });

  it("статус, сменённый в YouTrack, приходит сам через минуту", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const server = { state: "Open", up: true, connected: true };
    fakeRust(server);
    const { result } = mentions("SAP-1");

    // waitFor из testing-library ждёт на setInterval, а он тут поддельный.
    await vi.waitFor(() => expect(result.current?.mentions.get("SAP-1")?.label).toBe("Open"));

    server.state = "Fixed";
    await act(() => vi.advanceTimersByTimeAsync(60_000));

    await vi.waitFor(() => expect(result.current?.mentions.get("SAP-1")?.label).toBe("Fixed"));
  });

  it("YouTrack не отвечает: последний известный статус серым с пометкой", async () => {
    const server = { state: "In Progress", up: true, connected: true };
    fakeRust(server);
    const first = mentions("SAP-1");

    await waitFor(() => expect(first.result.current?.mentions.get("SAP-1")?.label).toBe("In Progress"));
    first.unmount();

    // Перезапуск без связи: ответы только из памяти устройства.
    server.up = false;
    const { result } = mentions("SAP-1 и SAP-9");

    await waitFor(() => expect(result.current?.mentions.get("SAP-1")?.muted).toBe(true));

    expect(result.current?.prefixes).toEqual(new Set(["SAP"]));
    expect(result.current?.mentions.get("SAP-1")).toMatchObject({ label: "In Progress, мог устареть" });
    expect(result.current?.mentions.get("SAP-1")?.details.at(-1)).toBe(
      "YouTrack сейчас не отвечает, это статус на момент последнего ответа.",
    );
    expect(result.current?.mentions.get("SAP-9")).toMatchObject({ label: "статус неизвестен", muted: true });
  });

  it("YouTrack не подключён: номерам не с чем сверяться", async () => {
    fakeRust({ state: "Open", up: true, connected: false });
    const { result } = mentions("SAP-1");

    await waitFor(() => expect(result.current).toBeNull());
  });
});
