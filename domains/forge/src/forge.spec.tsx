import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeRust } from "@sapien/ipc/fake";
import { clearMocks } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ForgeSettings } from "./index";

const GITHUB_TOKEN = "ghp_очень-секретный-токен";

function open() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ForgeSettings />
    </QueryClientProvider>,
  );
}

// Группа сервиса: GitHub и GitLab на одном экране с одинаковыми кнопками.
async function group(name: string) {
  const section = (await screen.findByRole("heading", { name })).closest("section");

  if (section === null) {
    throw new Error(`нет группы ${name}`);
  }

  return within(section);
}

afterEach(() => {
  cleanup();
  clearMocks();
});

describe("интеграции", () => {
  it("GitHub подключается токеном: поле пустеет сразу, виден логин", async () => {
    const rust = fakeRust();
    open();
    const github = await group("GitHub");
    const token = github.getByLabelText<HTMLInputElement>("Токен GitHub");
    expect(await github.findByText(/Не подключено/)).toBeDefined();

    fireEvent.change(token, { target: { value: ` ${GITHUB_TOKEN} ` } });
    fireEvent.keyDown(token, { key: "Enter" });

    expect(token.value).toBe("");
    expect(await github.findByText("Подключено как octocat на github.com.")).toBeDefined();
    expect(rust.calls.forgeConnect).toEqual([["github", null, GITHUB_TOKEN]]);
    expect(github.getByRole("button", { name: "Отключить" })).toBeDefined();
    expect(document.body.innerHTML).not.toContain("секретный");
  });

  it("GitLab подключается на своём сервере по адресу", async () => {
    const rust = fakeRust();
    open();
    const gitlab = await group("GitLab");

    fireEvent.change(gitlab.getByLabelText("Адрес сервера GitLab"), { target: { value: " https://git.example.com " } });
    fireEvent.change(gitlab.getByLabelText("Токен GitLab"), { target: { value: "glpat-123" } });
    fireEvent.click(gitlab.getByRole("button", { name: "Подключить" }));

    expect(await gitlab.findByText("Подключено как octocat на https://git.example.com.")).toBeDefined();
    expect(rust.calls.forgeConnect).toEqual([["gitlab", "https://git.example.com", "glpat-123"]]);
    // GitHub остался неподключённым.
    expect((await group("GitHub")).getByRole("button", { name: "Подключить" })).toBeDefined();
  });

  it("пустой токен не отправляется", async () => {
    const rust = fakeRust();
    open();
    const github = await group("GitHub");

    fireEvent.change(github.getByLabelText("Токен GitHub"), { target: { value: "   " } });
    fireEvent.keyDown(github.getByLabelText("Токен GitHub"), { key: "Enter" });

    expect(github.getByRole<HTMLButtonElement>("button", { name: "Подключить" }).disabled).toBe(true);
    expect(rust.calls.forgeConnect).toEqual([]);
  });

  it.each([
    ["forge_token_rejected", "Сервер не принял токен: он неверный, отозван или без нужных прав."],
    ["forge_host_insecure", "Адрес должен быть по https."],
    ["forge_host_invalid", "По этому адресу не нашлось API GitLab: проверьте адрес сервера."],
    ["что-то новое", "Не получилось, попробуйте ещё раз."],
  ])("отказ %s виден причиной, токен можно ввести снова", async (code, reason) => {
    fakeRust().refuse("forgeConnect", { kind: "invalid", code });
    open();
    const gitlab = await group("GitLab");
    const token = gitlab.getByLabelText<HTMLInputElement>("Токен GitLab");

    fireEvent.change(token, { target: { value: "glpat-неверный" } });
    fireEvent.click(gitlab.getByRole("button", { name: "Подключить" }));

    expect(await gitlab.findByText(reason)).toBeDefined();
    expect(token.value).toBe("");
    expect(gitlab.getByRole("button", { name: "Подключить" })).toBeDefined();
  });

  it("«Отключить» снимает подключение и снова просит токен", async () => {
    const rust = fakeRust({
      state: { forge: { github: { kind: "connected", host: "github.com", login: "octocat" }, gitlab: { kind: "none" } } },
    });
    open();
    const github = await group("GitHub");

    fireEvent.click(await github.findByRole("button", { name: "Отключить" }));

    expect(await github.findByLabelText("Токен GitHub")).toBeDefined();
    expect(github.getByText(/Не подключено/)).toBeDefined();
    expect(rust.calls.forgeDisconnect).toEqual([["github"]]);
  });
});
