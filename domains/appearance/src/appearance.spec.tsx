import { fakeRust } from "@sapien/ipc/fake";
import { clearMocks, mockWindows } from "@tauri-apps/api/mocks";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { changeLanguage } from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppearanceSettings,
  restoreLanguage,
  restoreTheme,
  restoreUiScale,
  setThemePreference,
  useThemePreference,
  useThemeSync,
} from "./index";

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

// Окно Tauri: масштаб webview уходит командой, она и есть граница.
function fakeWebview() {
  Object.assign(globalThis, { isTauri: true });
  mockWindows("main");

  const rust = fakeRust();

  return {
    get zooms() {
      return rust.plugins
        .filter(({ command }) => command === "plugin:webview|set_webview_zoom")
        .map(({ args }) => (args as { value: number }).value);
    },
  };
}

function scale() {
  return screen.getByRole<HTMLSelectElement>("combobox", { name: "Масштаб" });
}

describe("масштаб", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    clearMocks();
    Reflect.deleteProperty(globalThis, "isTauri");
  });

  it("без сохранённого выбора интерфейс в натуральную величину, 100%", async () => {
    const webview = fakeWebview();

    restoreUiScale();
    render(<AppearanceSettings />);

    expect(scale().value).toBe("100");
    await vi.waitFor(() => expect(webview.zooms).toEqual([1]));
  });

  it("выбор сразу меняет масштаб окна и переживает перезапуск", async () => {
    const webview = fakeWebview();

    restoreUiScale();
    const view = render(<AppearanceSettings />);
    fireEvent.change(scale(), { target: { value: "110" } });

    await vi.waitFor(() => expect(webview.zooms.at(-1)).toBe(1.1));
    view.unmount();

    restoreUiScale();
    render(<AppearanceSettings />);
    expect(scale().value).toBe("110");
    await vi.waitFor(() => expect(webview.zooms.at(-1)).toBe(1.1));
  });

  it("битое сохранённое значение даёт 100%, а не падение", () => {
    fakeWebview();
    localStorage.setItem("sapien.scale", "137");

    restoreUiScale();
    render(<AppearanceSettings />);

    expect(scale().value).toBe("100");
  });
});

// Меню macOS строит Rust: язык уходит ему командой.
function fakeMenu() {
  Object.assign(globalThis, { isTauri: true });

  return fakeRust();
}

describe("язык", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(async () => {
    clearMocks();
    Reflect.deleteProperty(globalThis, "isTauri");
    await changeLanguage("ru");
  });

  it("без выбора окно и меню на английском", async () => {
    const rust = fakeMenu();

    restoreLanguage();
    render(<AppearanceSettings />);

    expect(screen.getByRole("heading", { name: "Appearance" })).toBeDefined();
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Language" }).value).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    await vi.waitFor(() => expect(rust.calls.appearanceSetLanguage).toEqual([["en"]]));
  });

  it("русский выбирается в настройках, сразу меняет окно и меню и переживает перезапуск", async () => {
    const rust = fakeMenu();

    restoreLanguage();
    render(<AppearanceSettings />);
    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "ru" } });

    expect(await screen.findByRole("heading", { name: "Внешний вид" })).toBeDefined();
    await vi.waitFor(() => expect(rust.calls.appearanceSetLanguage).toEqual([["en"], ["ru"]]));

    await act(() => changeLanguage("en"));
    restoreLanguage();

    expect(await screen.findByRole("heading", { name: "Внешний вид" })).toBeDefined();
    expect(document.documentElement.lang).toBe("ru");
  });

  it("битое сохранённое значение даёт английский, а не падение", () => {
    fakeMenu();
    localStorage.setItem("sapien.language", "de");

    restoreLanguage();
    render(<AppearanceSettings />);

    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Language" }).value).toBe("en");
  });
});
