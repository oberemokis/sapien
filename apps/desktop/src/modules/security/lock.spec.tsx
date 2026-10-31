import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppLock, DataKeyNotice, SecuritySettings, restoreLock } from "@/modules/security";
import { parseLockSettings } from "./model/lock";
import type { SecurityStatus } from "./model/security";

type Answer = "verified" | "unlock_canceled" | "unlock_failed" | "unlock_unavailable";

// Rust: состояние безопасности и ответ системы на проверку. Ответы идут
// по очереди, последний повторяется.
function fakeRust(answers: Answer[], status: SecurityStatus = { data: "sealed", system: "macos", disk: true }) {
  const rust = { checks: 0 };

  mockIPC((command) => {
    switch (command) {
      case "security_status":
        return status;
      case "app_unlock": {
        const answer = answers[Math.min(rust.checks, answers.length - 1)];

        rust.checks += 1;

        if (answer !== "verified") {
          throw { kind: answer === "unlock_unavailable" ? "unavailable" : "invalid", code: answer };
        }

        return null;
      }
      default:
        throw new Error(`нет команды ${command}`);
    }
  });

  return rust;
}

// Действие по расписанию: тикает, пока смонтировано.
function ScheduledProbe() {
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTicks((value) => value + 1), 1_000);

    return () => clearInterval(timer);
  }, []);

  return <p>тиков: {ticks}</p>;
}

// Окно как в __root.tsx: страница, окно о ключе и блокировка последней.
// Настройки и страница рядом, чтобы включать блокировку и видеть, что
// под заглушкой всё работает.
function launch() {
  restoreLock();

  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ScheduledProbe />
      <SecuritySettings />
      <DataKeyNotice />
      <AppLock />
    </QueryClientProvider>,
  );
}

function storeLock(enabled: boolean, minutes = 1) {
  localStorage.setItem("sapien.lock", JSON.stringify({ enabled, minutes }));
}

function lockScreen() {
  return screen.queryByRole("dialog", { name: "sapien заблокирован" });
}

function idle(ms: number) {
  act(() => vi.advanceTimersByTime(ms));
}

beforeEach(() => {
  localStorage.clear();
  // Время и интервалы подменены, setTimeout настоящий: на нём ждёт waitFor.
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
});

afterEach(() => {
  vi.useRealTimers();
  clearMocks();
});

describe("блокировка окна", () => {
  it("по умолчанию выключена: окно не закрывается и после часа без движения", async () => {
    fakeRust(["verified"]);

    launch();
    await screen.findByText("Блокировать окно");
    idle(60 * 60_000);

    expect(lockScreen()).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Блокировать окно" })).toHaveProperty("checked", false);
  });

  it("включается только после проверки системы и переживает перезапуск", async () => {
    const rust = fakeRust(["unlock_canceled", "verified"]);

    launch();
    const toggle = await screen.findByRole("checkbox", { name: "Блокировать окно" });

    fireEvent.click(toggle);
    await waitFor(() => expect(rust.checks).toBe(1));
    expect(toggle).toHaveProperty("checked", false);
    expect(screen.getByText(/открывается по Touch ID или паролю Mac/)).toBeTruthy();

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveProperty("checked", true));
    expect(parseLockSettings(localStorage.getItem("sapien.lock")).enabled).toBe(true);
  });

  it("проверка не прошла или системе нечем спросить: блокировка не включается, и видно почему", async () => {
    fakeRust(["unlock_failed", "unlock_unavailable"], { data: "sealed", system: "linux", disk: true });

    launch();
    const toggle = await screen.findByRole("checkbox", { name: "Блокировать окно" });

    fireEvent.click(toggle);
    expect(await screen.findByText("Проверка не прошла, блокировка не включена.")).toBeTruthy();

    fireEvent.click(toggle);
    expect(await screen.findByText(/в AppImage её нет/)).toBeTruthy();
    expect(toggle).toHaveProperty("checked", false);
    expect(localStorage.getItem("sapien.lock")).toBeNull();
  });

  it("закрывается после бездействия, а движение мыши откладывает", async () => {
    fakeRust(["verified"]);
    storeLock(false, 5);
    launch();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Блокировать окно" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Блокировать окно" })).toHaveProperty("checked", true));

    idle(4 * 60_000);
    fireEvent.pointerMove(window);
    idle(4 * 60_000);
    expect(lockScreen()).toBeNull();

    idle(60_000 + 5_000);
    expect(lockScreen()).not.toBeNull();
  });

  it("таймеры свёрнутого окна стояли: первый щелчок после перерыва закрывает окно и до страницы не доходит", async () => {
    fakeRust(["verified"]);
    launch();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Блокировать окно" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Блокировать окно" })).toHaveProperty("checked", true));
    const page = vi.fn();
    document.body.addEventListener("pointerdown", page);

    // Время ушло, а проверка по интервалу ни разу не сработала.
    vi.setSystemTime(Date.now() + 10 * 60_000);
    fireEvent.pointerDown(document.body);

    expect(page).not.toHaveBeenCalled();
    expect(lockScreen()).not.toBeNull();
    document.body.removeEventListener("pointerdown", page);
  });

  it("включённая закрывает окно с запуска, под заглушкой всё работает", async () => {
    fakeRust(["verified"]);
    storeLock(true);

    launch();

    const dialog = lockScreen();

    expect(dialog).not.toBeNull();
    idle(3_000);
    expect(screen.getByText("тиков: 3")).toBeTruthy();
  });

  it("сочетания клавиш не доходят до страницы, пока окно закрыто", () => {
    fakeRust(["verified"]);
    storeLock(true);
    const shortcut = vi.fn();
    window.addEventListener("keydown", shortcut);

    launch();
    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    fireEvent(lockScreen() as HTMLElement, new Event("cancel", { cancelable: true }));

    expect(shortcut).not.toHaveBeenCalled();
    expect(lockScreen()).not.toBeNull();
    window.removeEventListener("keydown", shortcut);
  });

  it("отмена и неудача оставляют окно закрытым, удача открывает", async () => {
    const rust = fakeRust(["unlock_canceled", "unlock_failed", "verified"]);
    storeLock(true);

    launch();
    const dialog = lockScreen() as HTMLElement;
    const unlock = within(dialog).getByRole("button", { name: "Разблокировать" });

    fireEvent.click(unlock);
    await waitFor(() => expect(rust.checks).toBe(1));
    expect(within(dialog).queryByRole("alert")).toBeNull();

    fireEvent.click(unlock);
    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    expect(lockScreen()).not.toBeNull();

    fireEvent.click(unlock);
    await waitFor(() => expect(lockScreen()).toBeNull());
  });

  it("системе стало нечем спросить: окно открывается, а не остаётся закрытым насовсем", async () => {
    fakeRust(["unlock_unavailable"]);
    storeLock(true);

    launch();
    fireEvent.click(within(lockScreen() as HTMLElement).getByRole("button", { name: "Разблокировать" }));

    await waitFor(() => expect(lockScreen()).toBeNull());
  });

  it("окно о пропавшем ключе ждёт разблокировки, чтобы не встать поверх заглушки", async () => {
    fakeRust(["verified"], { data: "lost", system: "macos", disk: true });
    storeLock(true);

    launch();
    await screen.findByText("Блокировать окно");
    expect(screen.queryByRole("dialog", { name: "Данные приложения не читаются" })).toBeNull();

    fireEvent.click(within(lockScreen() as HTMLElement).getByRole("button", { name: "Разблокировать" }));

    expect(await screen.findByRole("dialog", { name: "Данные приложения не читаются" })).toBeTruthy();
  });

  it("испорченная настройка даёт выключенную блокировку", () => {
    expect(parseLockSettings("{")).toEqual({ enabled: false, minutes: 5 });
    expect(parseLockSettings(JSON.stringify({ enabled: "yes", minutes: 7 }))).toEqual({ enabled: false, minutes: 5 });
    expect(parseLockSettings(JSON.stringify({ enabled: true, minutes: 15 }))).toEqual({ enabled: true, minutes: 15 });
  });
});
