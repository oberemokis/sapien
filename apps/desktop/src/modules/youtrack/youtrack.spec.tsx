import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskDraftForm, YoutrackSettings } from "@/modules/youtrack";
import type { DraftRequest, LinkedNote } from "./model/draft";
import type { Checked, Published, Similar } from "./model/youtrack";

const TOKEN = "perm:очень-секретно";

// Команды Rust с YouTrack, который знает один токен. Адрес и токен
// сохраняются, только если сервер принял токен, как в use_case.rs.
function fakeRust() {
  const saved: { host: string | null; token: string | null; server: "up" | "down" } = {
    host: null,
    token: null,
    server: "up",
  };

  mockIPC((command, args) => {
    const { host, token } = args as { host?: string; token?: string };

    switch (command) {
      case "youtrack_status":
        if (saved.host === null) {
          return { kind: "none" };
        }

        if (saved.server === "down") {
          return { kind: "broken", host: saved.host, code: "youtrack_unreachable" };
        }

        return { kind: "connected", host: saved.host, name: "Илья" };
      case "youtrack_connect":
        if (token !== TOKEN) {
          throw { kind: "invalid", code: "youtrack_token_rejected" };
        }

        saved.host = `https://${host}`;
        saved.token = token;
        return { kind: "connected", host: saved.host, name: "Илья" };
      case "youtrack_disconnect":
        saved.host = null;
        saved.token = null;
        return null;
      default:
        throw new Error(`нет команды ${command}`);
    }
  });

  return saved;
}

function open() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <YoutrackSettings />
    </QueryClientProvider>,
  );
}

async function connect(token: string) {
  fireEvent.change(await screen.findByLabelText("Адрес"), { target: { value: "acme.youtrack.cloud" } });
  fireEvent.change(screen.getByLabelText("Токен"), { target: { value: token } });
  fireEvent.click(screen.getByRole("button", { name: "Подключить" }));
}

afterEach(() => {
  cleanup();
  clearMocks();
  vi.restoreAllMocks();
});

describe("подключение YouTrack", () => {
  it("принятый токен уходит в Rust, окно показывает только владельца", async () => {
    const saved = fakeRust();
    open();

    await connect(TOKEN);

    expect(await screen.findByText(/Подключено как Илья/)).toBeDefined();
    expect(screen.getByText("https://acme.youtrack.cloud")).toBeDefined();
    expect(saved.token).toBe(TOKEN);
    expect(document.body.innerHTML).not.toContain("очень-секретно");
  });

  it("отказ сервера виден причиной, адрес остаётся, токен нет", async () => {
    const saved = fakeRust();
    open();

    await connect("perm:чужой");

    expect(await screen.findByText(/YouTrack не принял токен/)).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>("Адрес").value).toBe("acme.youtrack.cloud");
    expect(screen.getByLabelText<HTMLInputElement>("Токен").value).toBe("");
    expect(saved.host).toBeNull();
  });

  it("сломанное подключение говорит почему, «Отключить» его забывает", async () => {
    const saved = fakeRust();
    saved.host = "https://acme.youtrack.cloud";
    saved.server = "down";
    open();

    expect(await screen.findByText(/Сервер не отвечает/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Отключить" }));

    expect(await screen.findByLabelText("Адрес")).toBeDefined();
    expect(saved.host).toBeNull();
  });
});

const DRAFT = `---
project: SAP
type: Feature
---
# Вход по ссылке

Письмо со ссылкой вместо пароля.
`;

type Sent = { text: string; draft: DraftRequest; id: string | null; force: boolean };

// Что YouTrack ответит на проверку и на поиск похожих.
type Server = { checked?: Checked; similar?: Similar[] };

// Подключённый YouTrack. Публикация отвечает по очереди заданными ответами,
// потом созданной задачей SAP-12. Строка вместо ответа это отказ с таким
// кодом, как AppError из error.rs.
function fakeYoutrack(answers: (Published | string)[] = [], server: Server = {}) {
  const sent: Sent[] = [];

  mockIPC((command, args) => {
    switch (command) {
      case "youtrack_status":
        return { kind: "connected", host: "https://acme.youtrack.cloud", name: "Илья" };
      case "youtrack_check":
        return server.checked ?? { projectFound: true, missing: [], issues: [] };
      case "youtrack_similar":
        return server.similar ?? [];
      case "youtrack_publish": {
        sent.push(args as Sent);
        const answer = answers.shift() ?? { kind: "done", id: "SAP-12", failed: [] };

        if (typeof answer === "string") {
          throw { kind: "invalid", code: answer };
        }

        return answer;
      }
      case "youtrack_issue_state":
        return { id: "SAP-12", state: "Open", assignee: "Илья", url: "https://acme.youtrack.cloud/issue/SAP-12" };
      default:
        throw new Error(`нет команды ${command}`);
    }
  });

  return sent;
}

type HarnessProps = {
  initial: string;
  onText: (text: string) => void;
  notes: LinkedNote[];
  onOpen: (path: string) => void;
};

// Заметка, которую правит только форма.
function Harness({ initial, onText, notes, onOpen }: HarnessProps) {
  const [text, setText] = useState(initial);

  return (
    <TaskDraftForm
      path="Задачи/Вход.md"
      text={text}
      readOnly={false}
      notes={notes}
      onOpen={onOpen}
      onChange={(next) => {
        onText(next);
        setText(next);
      }}
    />
  );
}

// Текст заметки после правок формы лежит в note.text.
function openDraft(text: string, { notes = [], onOpen = () => undefined }: Partial<Pick<HarnessProps, "notes" | "onOpen">> = {}) {
  const note = { text };

  render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness
        initial={text}
        onText={(next) => {
          note.text = next;
        }}
        notes={notes}
        onOpen={onOpen}
      />
    </QueryClientProvider>,
  );

  return note;
}

// Кнопка становится доступной, когда пришёл ответ о подключении.
async function ready(name: string) {
  const button = await screen.findByRole<HTMLButtonElement>("button", { name });

  await waitFor(() => expect(button.disabled).toBe(false));

  return button;
}

describe("черновик задачи", () => {
  it("заметка без проекта в шапке формы не получает", () => {
    fakeYoutrack();
    openDraft("# Идеи\n");

    expect(screen.queryByRole("region", { name: "Задача YouTrack" })).toBeNull();
  });

  it("публикация пишет номер в шапку, повтор обновляет ту же задачу", async () => {
    const sent = fakeYoutrack();
    const note = openDraft(DRAFT);

    fireEvent.click(await ready("Опубликовать в YouTrack"));

    expect(await screen.findByText("Отправлено в SAP-12")).toBeDefined();
    expect(note.text).toContain("youtrack: SAP-12");
    expect(sent[0]).toMatchObject({
      id: null,
      force: false,
      draft: {
        project: "SAP",
        summary: "Вход по ссылке",
        description: "Письмо со ссылкой вместо пароля.",
        fields: [{ name: "Type", value: "Feature" }],
      },
    });

    fireEvent.click(await ready("Обновить в YouTrack"));

    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]?.id).toBe("SAP-12");
    expect(await screen.findByText("Open")).toBeDefined();
  });

  it("обязательные поля проекта без значения подсвечены, задача не создана", async () => {
    const sent = fakeYoutrack([{ kind: "missing", fields: ["Priority", "Subsystem"] }]);
    const note = openDraft(DRAFT);

    fireEvent.click(await ready("Опубликовать в YouTrack"));

    expect(await screen.findByText(/не заполнены обязательные поля: Priority, Subsystem/)).toBeDefined();
    expect(screen.getByLabelText("Приоритет").getAttribute("aria-invalid")).toBe("true");

    const subsystem = screen.getByLabelText("Subsystem");

    expect(subsystem.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(subsystem, { target: { value: "Backend" } });
    fireEvent.blur(subsystem);

    expect(note.text).toContain("fields:\n  Subsystem: Backend");
    expect(note.text).not.toContain("youtrack:");
    expect(screen.getByLabelText("Subsystem").getAttribute("aria-invalid")).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it("проекта нет в YouTrack: понятная ошибка, черновик не меняется", async () => {
    fakeYoutrack(["youtrack_project_missing"]);
    const note = openDraft(DRAFT);

    fireEvent.click(await ready("Опубликовать в YouTrack"));

    expect(await screen.findByText(/нет проекта с таким коротким именем/)).toBeDefined();
    expect(note.text).toBe(DRAFT);
  });

  it("правку в YouTrack не затирает: текст оттуда встаёт в заметку и уходит обратно", async () => {
    const sent = fakeYoutrack([{ kind: "diverged", summary: "Вход по коду", description: "Код в письме." }]);
    const note = openDraft(DRAFT.replace("type: Feature", "type: Feature\nyoutrack: SAP-12"));

    fireEvent.click(await ready("Обновить в YouTrack"));
    expect(await screen.findByText("Вход по коду")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Взять из YouTrack" }));

    await waitFor(() => expect(sent).toHaveLength(2));
    expect(note.text).toContain("youtrack: SAP-12\n---\n# Вход по коду\n\nКод в письме.\n");
    expect(sent[1]).toMatchObject({ force: true, draft: { summary: "Вход по коду", description: "Код в письме." } });
  });

  it("связь на неопубликованный черновик держит публикацию и открывает его", async () => {
    fakeYoutrack();
    const opened: string[] = [];

    openDraft(DRAFT.replace("type: Feature", "type: Feature\ndepends_on: [Задачи/Почта.md]"), {
      notes: [{ path: "Задачи/Почта.md", text: "---\nproject: SAP\n---\n# Почта\n" }],
      onOpen: (path) => opened.push(path),
    });

    expect(await screen.findByText(/Связанные черновики ещё не задачи/)).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Опубликовать в YouTrack" }).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));

    expect(opened).toEqual(["Задачи/Почта.md"]);
  });

  it("задача из шаблона без проекта: поле подсвечено, публикация ждёт проект", async () => {
    fakeYoutrack();
    const note = openDraft(DRAFT.replace("project: SAP", "project:"));
    const project = await screen.findByLabelText("Проект");

    // Ответ о подключении уже пришёл: держит именно пустой проект.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(project.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Опубликовать в YouTrack" }).disabled).toBe(true);

    fireEvent.change(project, { target: { value: "SAP" } });
    fireEvent.blur(project);

    await ready("Опубликовать в YouTrack");
    expect(note.text).toContain("project: SAP\n");
  });

  it("без сети черновик правится, а публикация недоступна", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    fakeYoutrack();
    const note = openDraft(DRAFT);

    expect(await screen.findByText(/Нет сети/)).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Опубликовать в YouTrack" }).disabled).toBe(true);

    const assignee = screen.getByLabelText("Исполнитель");

    fireEvent.change(assignee, { target: { value: "ilya" } });
    fireEvent.keyDown(assignee, { key: "Enter" });

    expect(note.text).toContain("assignee: ilya");
  });
});

// Находки проверки текстом, как их видит человек.
function findings() {
  return within(screen.getByRole("region", { name: "Проверка" }))
    .queryAllByRole("listitem")
    .map((item) => item.textContent);
}

describe("проверка связей", () => {
  it("цикл через три черновика: все три названы, публикация недоступна", async () => {
    fakeYoutrack();
    const opened: string[] = [];

    openDraft(DRAFT.replace("type: Feature", "type: Feature\ndepends_on: [Задачи/Почта.md]"), {
      notes: [
        { path: "Задачи/Почта.md", text: "---\nproject: SAP\ndepends_on: [Задачи/Письмо.md]\n---\n" },
        { path: "Задачи/Письмо.md", text: "---\nproject: SAP\ndepends_on: [Задачи/Вход.md]\n---\n" },
      ],
      onOpen: (path) => opened.push(path),
    });

    await screen.findByRole("region", { name: "Проверка" });
    expect(findings()[0]).toContain("Цикл зависимостей: Вход → Почта → Письмо → Вход.");
    expect(screen.getByLabelText("Зависит от").getAttribute("aria-invalid")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Открыть «Письмо»" }));

    expect(opened).toEqual(["Задачи/Письмо.md"]);
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Опубликовать в YouTrack" }).disabled).toBe(true);
  });

  it("без сети проверки YouTrack пропущены с пометкой, локальные работают", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    fakeYoutrack();
    openDraft(DRAFT.replace("type: Feature", "type: Feature\nrelates_to: [Задачи/Нет.md]"));

    expect(await screen.findByText(/Без сети проверено только то, что видно в заметках/)).toBeDefined();
    expect(findings()).toEqual([
      "ОшибкаСвязь ведёт на черновик, которого нет: Задачи/Нет.md.",
      "ПредупреждениеНет раздела «Проверка» с критериями приёмки, или он пуст.",
    ]);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Проверить" }).disabled).toBe(true);
  });

  it("находка YouTrack уходит после правки без новой проверки, а с ней задача не публикуется", async () => {
    const sent = fakeYoutrack([], {
      checked: {
        projectFound: true,
        missing: [],
        issues: [{ id: "SAP-404", found: false, resolved: false, sprint: null, due: null }],
      },
    });
    openDraft(DRAFT.replace("type: Feature", "type: Feature\nrelates_to: [SAP-404]"));

    fireEvent.click(await ready("Опубликовать в YouTrack"));

    await waitFor(() => expect(findings()[0]).toContain("Задачи SAP-404 нет в YouTrack"));
    expect(sent).toHaveLength(0);

    const relates = screen.getByLabelText("Связана с");

    fireEvent.change(relates, { target: { value: "" } });
    fireEvent.blur(relates);

    expect(findings().join()).not.toContain("SAP-404");
    await ready("Опубликовать в YouTrack");
  });

  it("кандидат в дубли не держит публикацию, «это не дубль» убирает его насовсем", async () => {
    fakeYoutrack([], { similar: [{ id: "SAP-5", summary: "Вход по ссылке из письма" }] });
    const note = openDraft(DRAFT);

    fireEvent.click(await ready("Искать дубли"));

    await waitFor(() =>
      expect(findings().join()).toContain(
        "Похожая задача SAP-5 «Вход по ссылке из письма»: общие слова вход, ссылке.",
      ),
    );
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Опубликовать в YouTrack" }).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Это не дубль" }));

    expect(note.text).toContain("not_duplicates: [SAP-5]");
    expect(findings().join()).not.toContain("SAP-5");
  });
});
