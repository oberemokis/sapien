import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Inbox, InboxLink, restoreInbox, useInbox, YoutrackSettings } from "@/modules/youtrack";
import type { FeedEvent, IssueDetail } from "./model/youtrack";

const DAY = 24 * 3_600_000;
const START = Date.UTC(2026, 9, 31, 9);

const STATE: FeedEvent = {
  id: "s1",
  kind: "state",
  issue: "SAP-1",
  summary: "Вход по ссылке",
  project: "SAP",
  at: START - 2 * 3_600_000,
  author: "Анна",
  detail: "Open → In Progress",
};

const COMMENT: FeedEvent = {
  id: "c1",
  kind: "mentioned",
  issue: "SAP-7",
  summary: "Тёмная тема",
  project: "SAP",
  at: START - 3_600_000,
  author: "Пётр",
  detail: "@ilya глянь макет",
};

const DETAIL: IssueDetail = {
  id: "SAP-7",
  summary: "Тёмная тема",
  description: "Тема по системной настройке.",
  state: "Open",
  reporter: "Пётр",
  project: "SAP",
  url: "https://acme.youtrack.cloud/issue/SAP-7",
  comments: [{ author: "Пётр", text: "@ilya глянь макет", created: START - 3_600_000 }],
};

type Server = { status: "connected" | "broken" | "none"; events: FeedEvent[] };
type Asked = { query: string; ids: string[]; since: number };

// YouTrack за командами Rust: события ленты отдаёт те, что лежат в server
// сейчас, и записывает, о чём спросили.
function fakeRust(server: Server) {
  const asked: Asked[] = [];
  const opened: string[] = [];

  mockIPC((command, args) => {
    switch (command) {
      case "youtrack_status":
        if (server.status === "connected") {
          return { kind: "connected", host: "https://acme.youtrack.cloud", name: "Илья" };
        }

        if (server.status === "broken") {
          return { kind: "broken", host: "https://acme.youtrack.cloud", code: "youtrack_token_rejected" };
        }

        return { kind: "none" };
      case "youtrack_feed":
        asked.push(args as Asked);

        return server.events;
      case "youtrack_issue_detail":
        return DETAIL;
      case "open_link":
        opened.push((args as { url: string }).url);

        return null;
      default:
        throw new Error(`нет команды ${command}`);
    }
  });

  return { asked, opened };
}

const NOTES = [{ text: "---\nproject: SAP\nyoutrack: SAP-7\n---\n# Тёмная тема" }];

// Запуск окна: лента читается с устройства, как в app.tsx. Пункт
// «Входящие» открывает ленту, рядом настройки YouTrack.
function launch(onAsk = vi.fn()) {
  restoreInbox();

  function Page() {
    const inbox = useInbox(NOTES);
    const [open, setOpen] = useState(false);

    return (
      <>
        {inbox.connected && <InboxLink inbox={inbox} active={open} onOpen={() => setOpen(true)} />}
        {open && <Inbox inbox={inbox} onAsk={onAsk} />}
        <YoutrackSettings />
      </>
    );
  }

  const router = createRouter({
    routeTree: createRootRoute({ component: Page }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return { ...view, onAsk };
}

async function openInbox() {
  fireEvent.click(await screen.findByRole("button", { name: /Входящие/ }));

  return screen.findByRole("region", { name: "Входящие" });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: START });
});

afterEach(() => {
  cleanup();
  clearMocks();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("входящие", () => {
  it("первый опрос берёт неделю по запросу и номерам черновиков, открытое событие прочитано", async () => {
    const { asked, opened } = fakeRust({ status: "connected", events: [COMMENT, STATE] });
    const { onAsk } = launch();

    await screen.findByText("непрочитанных: 2");
    expect(asked).toEqual([
      { query: "for: me or reported by: me or commenter: me", ids: ["SAP-7"], since: START - 7 * DAY },
    ]);

    const list = await openInbox();

    fireEvent.click(within(list).getByRole("button", { name: /SAP-7 Тёмная тема/ }));

    expect(await screen.findByText("Тема по системной настройке.")).toBeTruthy();
    expect(screen.getByText("Open · Автор: Пётр")).toBeTruthy();
    expect(screen.getByText("непрочитанных: 1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Открыть в YouTrack" }));
    fireEvent.click(screen.getByRole("button", { name: "Спросить агента" }));

    await waitFor(() => expect(opened).toEqual(["https://acme.youtrack.cloud/issue/SAP-7"]));
    expect(onAsk).toHaveBeenCalledWith(expect.stringContaining("SAP-7 «Тёмная тема»"));
  });

  it("после перезапуска лента догоняет с прошлого опроса, и событие не повторяется", async () => {
    const server: Server = { status: "connected", events: [COMMENT, STATE] };
    const { asked } = fakeRust(server);

    const first = launch();

    await screen.findByText("непрочитанных: 2");
    first.unmount();

    vi.setSystemTime(START + DAY);
    server.events = [{ ...STATE, id: "s2", at: START + 3_600_000, detail: "In Progress → Done" }, COMMENT];
    launch();

    const list = await openInbox();

    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(3));
    expect(asked[1]?.since).toBe(START - 60_000);
  });

  it("«Обновить» подтягивает новое, «Прочитать все» гасит точку", async () => {
    const server: Server = { status: "connected", events: [STATE] };
    const { asked } = fakeRust(server);

    launch();
    const list = await openInbox();

    await within(list).findByText(/Open → In Progress/);
    server.events = [COMMENT];
    fireEvent.click(within(list).getByRole("button", { name: "Обновить" }));

    await within(list).findByText(/глянь макет/);
    expect(asked).toHaveLength(2);
    expect(screen.getByText("непрочитанных: 2")).toBeTruthy();

    fireEvent.click(within(list).getByRole("button", { name: "Прочитать все" }));

    expect(screen.queryByText(/непрочитанных/)).toBeNull();
  });

  it("без сети лента показывает загруженное и время обновления, а YouTrack не спрашивается", async () => {
    const { asked } = fakeRust({ status: "connected", events: [STATE] });

    const first = launch();

    await screen.findByText("непрочитанных: 1");
    first.unmount();

    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    vi.setSystemTime(START + 2 * 3_600_000);
    launch();
    const list = await openInbox();

    expect(within(list).getByText("Нет сети, показано загруженное.")).toBeTruthy();
    expect(within(list).getByText("Обновлено 2 часа назад")).toBeTruthy();
    expect(within(list).getByText(/Open → In Progress/)).toBeTruthy();
    expect(asked).toHaveLength(1);
  });

  it("сломанное подключение лента называет и ведёт в настройки", async () => {
    const { asked } = fakeRust({ status: "broken", events: [STATE] });

    launch();
    const list = await openInbox();
    const alert = await within(list).findByRole("alert");

    expect(alert.textContent).toContain("YouTrack не принял токен");
    expect(within(alert).getByRole("link", { name: "Открыть настройки" }).getAttribute("href")).toBe(
      "/settings/integrations",
    );
    expect(asked).toEqual([]);
  });

  it("без подключения пункта «Входящие» нет", async () => {
    fakeRust({ status: "none", events: [] });
    launch();

    await screen.findByText(/Адрес, по которому YouTrack открывается/);
    expect(screen.queryByRole("button", { name: /Входящие/ })).toBeNull();
  });

  it("запрос отслеживаемых задач из настроек меняет опрос, пустой возвращает исходный", async () => {
    const { asked } = fakeRust({ status: "connected", events: [] });

    launch();
    const field = await screen.findByLabelText("Отслеживаемые задачи");

    await waitFor(() => expect(asked).toHaveLength(1));
    fireEvent.change(field, { target: { value: "project: SAP" } });
    fireEvent.blur(field);

    await waitFor(() => expect(asked.at(-1)?.query).toBe("project: SAP"));

    fireEvent.change(field, { target: { value: "  " } });
    act(() => fireEvent.keyDown(field, { key: "Enter" }));

    await waitFor(() => expect(asked.at(-1)?.query).toBe("for: me or reported by: me or commenter: me"));
    expect((field as HTMLInputElement).value).toBe("for: me or reported by: me or commenter: me");
  });
});
