import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { restoreTheme, useThemeSync } from "@/modules/appearance";
import { restoreLayout } from "@/modules/layout";
import { routeTree } from "@/route-tree.gen";

const mod = { metaKey: true };

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
    expect(await screen.findByRole("heading", { name: "Внешний вид" })).toBeDefined();
    expect(screen.getByText("Настройки").closest("[data-title-bar]")).not.toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(await screen.findByRole("button", { name: "Показать боковую панель" })).toBeDefined();
  });

  it("«Настройки…» в меню macOS открывает настройки, кнопки в окне для них нет", async () => {
    launch("/");
    await screen.findByRole("button", { name: /^Поиск/ });
    expect(screen.queryByRole("button", { name: "Настройки" })).toBeNull();

    await act(() => emit("menu-settings"));

    expect(await screen.findByRole("heading", { name: "Внешний вид" })).toBeDefined();
  });

  it("тема меняется сразу, без сохранения, и переживает перезапуск", async () => {
    const { unmount } = launch("/");
    await screen.findByRole("button", { name: /^Поиск/ });
    fireEvent.keyDown(window, { key: "б", code: "Comma", ...mod });

    fireEvent.click(await screen.findByRole("radio", { name: "Светлая" }));
    expect(isLight()).toBe(true);

    unmount();
    relaunch("/settings");
    expect(isLight()).toBe(true);
    expect((await screen.findByRole<HTMLInputElement>("radio", { name: "Светлая" })).checked).toBe(true);
  });

  it("«Назад» из окна, открытого сразу на настройках, ведёт на главный экран", async () => {
    launch("/settings");

    fireEvent.click(await screen.findByRole("button", { name: "Назад" }));

    expect(await screen.findByRole("button", { name: /^Поиск/ })).toBeDefined();
  });

  it("Escape при выехавшем списке разделов прячет список и оставляет настройки", async () => {
    launch("/settings");
    fireEvent.click(await screen.findByRole("button", { name: "Скрыть боковую панель" }));
    fireEvent.pointerMove(document.body, { clientX: 2, clientY: 300 });
    expect(screen.getByRole("link", { name: "Внешний вид" }).closest("[inert]")).toBeNull();

    fireEvent.keyDown(document.body, { key: "Escape" });
    // Переход роутера асинхронный: без паузы ушедший экран ещё на месте.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(screen.getByRole("link", { name: "Внешний вид" }).closest("[inert]")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Внешний вид" })).toBeDefined();
  });
});
