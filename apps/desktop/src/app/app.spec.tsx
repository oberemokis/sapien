import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { restoreTheme, useThemeSync } from "@/modules/appearance";
import { restoreLayout } from "@/modules/layout";
import { routeTree } from "@/route-tree.gen";

// happy-dom представляется Linux, но тест не должен от этого зависеть.
const mod = /Mac/.test(navigator.userAgent) ? { metaKey: true } : { ctrlKey: true };

function ThemeSync() {
  useThemeSync();

  return null;
}

// Окно с настоящим деревом маршрутов: адрес живёт в памяти, а не в браузере.
function launch(path: string) {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });

  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ThemeSync />
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

// Перезапуск окна: тема и раскладка читаются заново из хранилища.
function relaunch(path: string) {
  document.documentElement.className = "";
  restoreTheme();
  restoreLayout();

  return launch(path);
}

function isLight() {
  return document.documentElement.classList.contains("theme-light");
}

function sections() {
  return within(screen.getByRole("navigation", { name: "Разделы настроек" }))
    .queryAllByRole("link")
    .map((link) => link.textContent);
}

describe("настройки", () => {
  beforeEach(() => {
    // Проектов и сессий нет: эти тесты не про них.
    mockIPC(() => [], { shouldMockEvents: true });
    localStorage.clear();
    relaunch("/").unmount();
  });

  // Сначала окно отписывается от событий, потом подмена Rust уходит.
  // Отписка асинхронная, поэтому между ними пауза.
  afterEach(async () => {
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
    clearMocks();
  });

  it("⌘, открывает настройки, Escape возвращает к раскладке, какой она была", async () => {
    launch("/");
    fireEvent.click(await screen.findByRole("button", { name: "Скрыть боковую панель" }));

    fireEvent.keyDown(window, { key: "б", code: "Comma", ...mod });
    expect(await screen.findByRole("heading", { name: "Агент" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Показать боковую панель" })).toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(await screen.findByRole("button", { name: "Показать боковую панель" })).toBeDefined();
  });

  it("тема меняется сразу, без сохранения, и переживает перезапуск", async () => {
    const { unmount } = launch("/");
    fireEvent.click(await screen.findByRole("button", { name: "Настройки" }));
    fireEvent.click(await screen.findByRole("link", { name: "Внешний вид" }));

    fireEvent.click(await screen.findByRole("radio", { name: "Светлая" }));
    expect(isLight()).toBe(true);

    unmount();
    relaunch("/settings/appearance");
    expect(isLight()).toBe(true);
    expect((await screen.findByRole<HTMLInputElement>("radio", { name: "Светлая" })).checked).toBe(true);
  });

  it("«Назад» из окна, открытого сразу на настройках, ведёт на главный экран", async () => {
    launch("/settings");

    fireEvent.click(await screen.findByRole("button", { name: "Назад" }));

    expect(await screen.findByRole("button", { name: "Настройки" })).toBeDefined();
  });

  it("поиск оставляет разделы со словом, Escape сначала стирает запрос и оставляет настройки", async () => {
    launch("/settings");
    const search = await screen.findByRole<HTMLInputElement>("searchbox", { name: "Поиск" });

    fireEvent.change(search, { target: { value: "тема" } });
    expect(sections()).toEqual(["Внешний вид"]);

    fireEvent.change(search, { target: { value: "погода" } });
    expect(sections()).toEqual([]);
    expect(screen.getByText("Ничего не нашлось")).toBeDefined();

    fireEvent.keyDown(search, { key: "Escape" });
    // Переход роутера асинхронный: без паузы ушедший экран ещё на месте.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(search.value).toBe("");
    expect(sections()).toEqual(["Агент", "Интеграции", "Внешний вид", "Безопасность"]);
    expect(screen.getByRole("heading", { name: "Агент" })).toBeDefined();
  });
});
