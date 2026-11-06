import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeRust } from "@sapien/ipc/fake";
import { clearMocks } from "@tauri-apps/api/mocks";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppLock, LockSettings, restoreLock } from "./index";
import { parseLockSettings } from "./model/lock";

type Answer = "verified" | "unlock_canceled" | "unlock_failed" | "unlock_unavailable";

// Rust: ответ системы на проверку. Ответы идут по очереди, последний
// повторяется.
function unlockAnswers(answers: Answer[]) {
  const rust = fakeRust();

  answers.forEach((answer, index) => {
    if (answer !== "verified") {
      const kind = answer === "unlock_unavailable" ? "unavailable" : "invalid";

      rust.refuse("securityUnlock", { kind, code: answer }, index === answers.length - 1 ? Infinity : 1);
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

// Окно как в __root.tsx: страница и блокировка последней. Настройки
// и страница рядом, чтобы включать блокировку и видеть, что под заглушкой
// всё работает.
function launch() {
  restoreLock();

  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ScheduledProbe />
      <LockSettings />
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
  vi.restoreAllMocks();
  clearMocks();
});

describe("блокировка окна", () => {
  it("по умолчанию выключена: окно не закрывается и после часа без движения", async () => {
    unlockAnswers(["verified"]);

    launch();
    await screen.findByText("Блокировать окно");
    idle(60 * 60_000);

    expect(lockScreen()).toBeNull();
    expect(screen.getByRole("switch", { name: "Блокировать окно" })).toHaveProperty("checked", false);
  });

  it("включается только после проверки системы и переживает перезапуск", async () => {
    const rust = unlockAnswers(["unlock_canceled", "verified"]);

    launch();
    const toggle = await screen.findByRole("switch", { name: "Блокировать окно" });

    fireEvent.click(toggle);
    await waitFor(() => expect(rust.calls.securityUnlock.length).toBe(1));
    expect(toggle).toHaveProperty("checked", false);
    expect(screen.getByText(/открывается по Touch ID или паролю Mac/)).toBeTruthy();

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveProperty("checked", true));
    expect(JSON.parse(localStorage.getItem("sapien.lock") ?? "null")).toMatchObject({ enabled: true });
  });

  it("проверка не прошла или системе нечем спросить: блокировка не включается, и видно почему", async () => {
    unlockAnswers(["unlock_failed", "unlock_unavailable"]);

    launch();
    const toggle = await screen.findByRole("switch", { name: "Блокировать окно" });

    fireEvent.click(toggle);
    expect(await screen.findByText("Проверка не прошла, блокировка не включена.")).toBeTruthy();

    fireEvent.click(toggle);
    expect(await screen.findByText(/у учётной записи Mac нет пароля/)).toBeTruthy();
    expect(toggle).toHaveProperty("checked", false);
    expect(localStorage.getItem("sapien.lock")).toBeNull();
  });

  it("закрывается после бездействия, а движение мыши откладывает", async () => {
    unlockAnswers(["verified"]);
    storeLock(false, 5);
    launch();
    fireEvent.click(await screen.findByRole("switch", { name: "Блокировать окно" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Блокировать окно" })).toHaveProperty("checked", true));

    idle(4 * 60_000);
    fireEvent.pointerMove(window);
    idle(4 * 60_000);
    expect(lockScreen()).toBeNull();

    idle(60_000 + 5_000);
    expect(lockScreen()).not.toBeNull();
  });

  it("таймеры свёрнутого окна стояли: первый щелчок после перерыва закрывает окно и до страницы не доходит", async () => {
    unlockAnswers(["verified"]);
    launch();
    fireEvent.click(await screen.findByRole("switch", { name: "Блокировать окно" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Блокировать окно" })).toHaveProperty("checked", true));
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
    unlockAnswers(["verified"]);
    storeLock(true);

    launch();

    const dialog = lockScreen();

    expect(dialog).not.toBeNull();
    idle(3_000);
    expect(screen.getByText("тиков: 3")).toBeTruthy();
  });

  it("сочетания клавиш не доходят до страницы, пока окно закрыто", () => {
    unlockAnswers(["verified"]);
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
    const rust = unlockAnswers(["unlock_canceled", "unlock_failed", "verified"]);
    storeLock(true);

    launch();
    const dialog = lockScreen() as HTMLElement;
    const unlock = within(dialog).getByRole("button", { name: "Разблокировать" });

    fireEvent.click(unlock);
    // Отмена страницу не меняет, а waitFor перепроверяет по setInterval,
    // который здесь подменён. vi.waitFor ходит на настоящих таймерах.
    await vi.waitFor(() => expect(rust.calls.securityUnlock.length).toBe(1));
    expect(within(dialog).queryByRole("alert")).toBeNull();

    fireEvent.click(unlock);
    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    expect(lockScreen()).not.toBeNull();

    fireEvent.click(unlock);
    await waitFor(() => expect(lockScreen()).toBeNull());
  });

  it("системе стало нечем спросить: окно открывается, а не остаётся закрытым насовсем", async () => {
    unlockAnswers(["unlock_unavailable"]);
    storeLock(true);

    launch();
    fireEvent.click(within(lockScreen() as HTMLElement).getByRole("button", { name: "Разблокировать" }));

    await waitFor(() => expect(lockScreen()).toBeNull());
  });

  it("испорченная настройка даёт выключенную блокировку", () => {
    expect(parseLockSettings("{")).toEqual({ enabled: false, minutes: 5 });
    expect(parseLockSettings({ enabled: "yes", minutes: 7 })).toEqual({ enabled: false, minutes: 5 });
    expect(parseLockSettings({ enabled: true, minutes: 15 })).toEqual({ enabled: true, minutes: 15 });
  });

  it("побитая запись в хранилище не закрывает окно", () => {
    localStorage.setItem("sapien.lock", "{");

    launch();

    expect(lockScreen()).toBeNull();
  });
});
