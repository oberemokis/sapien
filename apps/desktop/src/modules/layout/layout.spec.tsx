import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Workspace, restoreLayout } from "@/modules/layout";

// Окно happy-dom шириной 1024: три панели в него помещаются.
function renderWorkspace() {
  return render(<Workspace files={<p>дерево</p>} main={<p>редактор</p>} chat={<p>чат</p>} />);
}

// Скрытое дерево лежит в плавающей панели, закрытая панель инертна.
function filesShown() {
  return screen.getByText("дерево").closest("[inert]") === null;
}

function chatShown() {
  return screen.queryByText("чат") !== null;
}

// Перезапуск окна: раскладка читается заново из хранилища.
function relaunch() {
  restoreLayout();
  return renderWorkspace();
}

// happy-dom представляется Linux, но тест не должен от этого зависеть.
const mod = /Mac/.test(navigator.userAgent) ? { metaKey: true } : { ctrlKey: true };

describe("раскладка окна", () => {
  beforeEach(() => {
    localStorage.clear();
    restoreLayout();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("кнопка прячет дерево, и выбор переживает перезапуск", () => {
    const { unmount } = renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Скрыть боковую панель" }));
    expect(filesShown()).toBe(false);

    unmount();
    relaunch();
    expect(filesShown()).toBe(false);
    expect(screen.getByRole("button", { name: "Показать боковую панель" })).toBeDefined();
  });

  it("горячая клавиша прячет дерево, с Shift чат, в любой раскладке", () => {
    renderWorkspace();

    fireEvent.keyDown(window, { key: "и", code: "KeyB", ...mod });
    expect(filesShown()).toBe(false);

    fireEvent.keyDown(window, { key: "И", code: "KeyB", shiftKey: true, ...mod });
    expect(chatShown()).toBe(false);
  });

  it("клавишу, которую уже забрал редактор, раскладка не трогает", () => {
    renderWorkspace();
    const event = new KeyboardEvent("keydown", { code: "KeyB", cancelable: true, ...mod });

    event.preventDefault();
    fireEvent(window, event);

    expect(filesShown()).toBe(true);
  });

  it("ширина меняется с клавиатуры и переживает перезапуск", () => {
    const { unmount } = renderWorkspace();
    const handle = screen.getByRole("separator", { name: "Ширина боковой панели" });
    const before = Number(handle.getAttribute("aria-valuenow"));

    fireEvent.keyDown(handle, { key: "ArrowRight" });

    unmount();
    relaunch();
    expect(
      Number(screen.getByRole("separator", { name: "Ширина боковой панели" }).getAttribute("aria-valuenow")),
    ).toBeGreaterThan(before);
  });

  describe("плавающее дерево", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      renderWorkspace();
      fireEvent.click(screen.getByRole("button", { name: "Скрыть боковую панель" }));
    });

    it("появляется у левого края и прячется через 180 мс после ухода", () => {
      fireEvent.pointerMove(document.body, { clientX: 2, clientY: 300 });
      expect(filesShown()).toBe(true);

      fireEvent.pointerMove(screen.getByText("редактор"), { clientX: 600, clientY: 300 });
      act(() => vi.advanceTimersByTime(179));
      expect(filesShown()).toBe(true);

      act(() => vi.advanceTimersByTime(1));
      expect(filesShown()).toBe(false);
    });

    it("указатель вернулся на панель до срока, и она остаётся", () => {
      fireEvent.pointerMove(document.body, { clientX: 2, clientY: 300 });
      fireEvent.pointerMove(screen.getByText("редактор"), { clientX: 600, clientY: 300 });
      fireEvent.pointerMove(screen.getByText("дерево"), { clientX: 100, clientY: 300 });

      act(() => vi.advanceTimersByTime(1000));
      expect(filesShown()).toBe(true);
    });

    it("появляется при наведении на кнопку скрытия", () => {
      fireEvent.pointerMove(screen.getByRole("button", { name: "Показать боковую панель" }));

      expect(filesShown()).toBe(true);
    });

    it("прячется по Escape", () => {
      fireEvent.pointerMove(document.body, { clientX: 2, clientY: 300 });
      fireEvent.keyDown(document.body, { key: "Escape" });

      expect(filesShown()).toBe(false);
    });

    it("не прячется, пока открыто меню", () => {
      fireEvent.pointerMove(document.body, { clientX: 2, clientY: 300 });
      const menu = document.body.appendChild(document.createElement("div"));
      menu.setAttribute("role", "menu");

      fireEvent.pointerMove(screen.getByText("редактор"), { clientX: 600, clientY: 300 });
      act(() => vi.advanceTimersByTime(1000));

      expect(filesShown()).toBe(true);
      menu.remove();
    });
  });
});
