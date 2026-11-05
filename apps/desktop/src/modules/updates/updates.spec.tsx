import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeRust } from "@sapien/ipc/fake";
import { clearMocks } from "@tauri-apps/api/mocks";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateOffer } from "@/modules/updates";
import type { Available } from "@sapien/ipc";

const HOUR = 3_600_000;

const NOTES = `## What's Changed
* feat(updates): обновление из релизов GitHub by @oberemokis in https://github.com/oberemokis/sapien/pull/77
* fix(editor): курсор не прыгает после сохранения by @oberemokis in https://github.com/oberemokis/sapien/pull/78

**Full Changelog**: https://github.com/oberemokis/sapien/compare/v0.1.0...v0.2.0`;

const UPDATE: Available = { version: "0.2.0", notes: NOTES };


// Окно: карточка обновления поверх, как в __root.tsx.
function launch() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <UpdateOffer />
    </QueryClientProvider>,
  );
}

function offer() {
  return screen.findByRole("region", { name: "Обновление приложения" });
}

afterEach(() => {
  cleanup();
  clearMocks();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("обновление приложения", () => {
  it("без сети проверки нет и на экране ничего, а с сетью она проходит", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const rust = fakeRust({ state: { update: UPDATE } });

    launch();

    await act(() => Promise.resolve());
    expect(rust.calls.appUpdateCheck.length).toBe(0);
    expect(screen.queryByRole("region", { name: "Обновление приложения" })).toBeNull();

    online.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(await offer()).toBeTruthy();
    expect(rust.calls.appUpdateCheck.length).toBe(1);
  });

  it("новой версии нет: окно молчит", async () => {
    const rust = fakeRust();

    launch();

    await waitFor(() => expect(rust.calls.appUpdateCheck.length).toBe(1));
    expect(screen.queryByRole("region", { name: "Обновление приложения" })).toBeNull();
  });

  it("сбой проверки по расписанию не показывается поверх окна", async () => {
    const rust = fakeRust();
    rust.refuse("appUpdateCheck", { kind: "unavailable", code: "update_unreachable" });

    launch();

    await waitFor(() => expect(rust.calls.appUpdateCheck.length).toBe(1));
    expect(screen.queryByRole("region", { name: "Обновление приложения" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("новая версия: что изменилось без служебного текста GitHub и страница релиза", async () => {
    const rust = fakeRust({ state: { update: UPDATE } });

    launch();

    const card = await offer();

    expect(within(card).getByText("Доступна версия 0.2.0")).toBeTruthy();
    expect(await within(card).findByText("Сейчас установлена 0.1.0.")).toBeTruthy();
    expect(within(card).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Обновление из релизов GitHub",
      "Курсор не прыгает после сохранения",
    ]);
    fireEvent.click(within(card).getByRole("button", { name: "Страница релиза" }));

    await waitFor(() => expect(rust.calls.openLink).toEqual([["https://github.com/oberemokis/sapien/releases/tag/v0.2.0"]]));
  });

  it("«Позже» молчит до следующей проверки", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const rust = fakeRust({ state: { update: UPDATE } });

    launch();

    fireEvent.click(within(await offer()).getByRole("button", { name: "Позже" }));

    expect(screen.queryByRole("region", { name: "Обновление приложения" })).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(6 * HOUR));

    expect(await offer()).toBeTruthy();
    expect(rust.calls.appUpdateCheck.length).toBe(2);
  });

  it("проверка повторяется раз в шесть часов", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const rust = fakeRust();

    launch();

    await waitFor(() => expect(rust.calls.appUpdateCheck.length).toBe(1));

    await act(() => vi.advanceTimersByTimeAsync(5 * HOUR));
    expect(rust.calls.appUpdateCheck.length).toBe(1);

    await act(() => vi.advanceTimersByTimeAsync(HOUR));
    await waitFor(() => expect(rust.calls.appUpdateCheck.length).toBe(2));
  });

  it("обновление ставится только по согласию и показывает загрузку", async () => {
    const rust = fakeRust({ state: { update: UPDATE } });

    launch();

    const card = await offer();

    expect(rust.calls.appUpdateInstall.length).toBe(0);

    fireEvent.click(within(card).getByRole("button", { name: "Обновить и перезапустить" }));

    expect(await within(card).findByText("Загружено 50%")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Позже" })).toHaveProperty("disabled", true);
    expect(rust.calls.appUpdateInstall.length).toBe(1);
  });

  it("оборванная загрузка оставляет версию работать, повтор начинает заново", async () => {
    const rust = fakeRust({ state: { update: UPDATE } });
    rust.refuse("appUpdateInstall", { kind: "unavailable", code: "update_unreachable" }, 1);

    launch();

    const card = await offer();

    fireEvent.click(within(card).getByRole("button", { name: "Обновить и перезапустить" }));

    expect(await within(card).findByRole("alert")).toHaveProperty(
      "textContent",
      "Нет связи с GitHub. Установленная версия работает как прежде.",
    );

    fireEvent.click(within(card).getByRole("button", { name: "Обновить и перезапустить" }));

    expect(await within(card).findByText("Загружено 50%")).toBeTruthy();
    expect(within(card).queryByRole("alert")).toBeNull();
    expect(rust.calls.appUpdateInstall.length).toBe(2);
  });

  it("чужая подпись: обновление не ставится, причина на экране", async () => {
    const rust = fakeRust({ state: { update: UPDATE } });
    rust.refuse("appUpdateInstall", { kind: "invalid", code: "update_signature" }, 1);

    launch();

    fireEvent.click(within(await offer()).getByRole("button", { name: "Обновить и перезапустить" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Подпись обновления не сошлась с ключом приложения, поэтому оно не поставлено. Установленная версия работает как прежде.",
    );
  });
});
