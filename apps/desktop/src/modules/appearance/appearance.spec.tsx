import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  restoreTheme,
  setThemePreference,
  useThemePreference,
  useThemeSync,
} from "@/modules/appearance";

// Тема системы это граница процесса: подменяется matchMedia, а не модуль.
function fakeSystemTheme(prefersDark: boolean) {
  const listeners = new Set<() => void>();
  const state = { dark: prefersDark };
  const query = {
    get matches() {
      return state.dark;
    },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };

  vi.spyOn(window, "matchMedia").mockReturnValue(query as unknown as MediaQueryList);

  return {
    change(dark: boolean) {
      state.dark = dark;
      act(() => listeners.forEach((listener) => listener()));
    },
  };
}

function Probe() {
  useThemeSync();

  return <output>{useThemePreference()}</output>;
}

function isLight() {
  return document.documentElement.classList.contains("theme-light");
}

// Перезапуск окна: класс снят, выбор читается заново из хранилища.
function relaunch() {
  document.documentElement.className = "";
  restoreTheme();
}

describe("тема", () => {
  beforeEach(() => {
    localStorage.clear();
    fakeSystemTheme(false);
    relaunch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("без сохранённого выбора тёмная, даже если система светлая", () => {
    render(<Probe />);

    expect(screen.getByRole("status").textContent).toBe("dark");
    expect(isLight()).toBe(false);
  });

  it("выбор применяется сразу и переживает перезапуск", () => {
    render(<Probe />);

    act(() => setThemePreference("light"));
    expect(isLight()).toBe(true);

    relaunch();
    expect(isLight()).toBe(true);
  });

  it("битое сохранённое значение даёт тёмную тему, а не падение", () => {
    localStorage.setItem("sapien.theme", "purple");
    relaunch();

    render(<Probe />);

    expect(screen.getByRole("status").textContent).toBe("dark");
    expect(isLight()).toBe(false);
  });

  it("«как в системе» следует за системой без перезапуска", () => {
    const system = fakeSystemTheme(true);
    render(<Probe />);

    act(() => setThemePreference("system"));
    expect(isLight()).toBe(false);

    system.change(false);
    expect(isLight()).toBe(true);
  });
});
