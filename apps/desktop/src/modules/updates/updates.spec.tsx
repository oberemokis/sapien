import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Channel } from "@tauri-apps/api/core";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AboutSettings, UpdateOffer } from "@/modules/updates";
import type { Update, UpdateProgress } from "./model/update";

const HOUR = 3_600_000;

const NOTES = `## What's Changed
* feat(updates): обновление из релизов GitHub by @oberemokis in https://github.com/oberemokis/sapien/pull/77
* fix(editor): курсор не прыгает после сохранения by @oberemokis in https://github.com/oberemokis/sapien/pull/78

**Full Changelog**: https://github.com/oberemokis/sapien/compare/v0.1.0...v0.2.0`;

const UPDATE: Update = { version: "0.2.0", notes: NOTES };

type Release = { latest: Update | null; failure?: string };

// Сообщение в канал так, как его шлёт Rust. Каналы mockIPC держит здесь.
function toChannel(channel: Channel<UpdateProgress>, index: number, message: UpdateProgress) {
  const internals = (window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void } })
    .__TAURI_INTERNALS__;

  internals.runCallback(channel.id, { index, message });
}

// Rust за командами обновления: последний релиз лежит в release, установка
// шлёт ход загрузки и падает с кодом из install, а без него висит, как
// настоящая, которая кончается перезапуском.
function fakeRust(release: Release) {
  const rust = { checks: 0, installs: 0, opened: [] as string[], install: null as string | null };

  mockIPC((command, args) => {
    switch (command) {
      case "app_version":
        return "0.1.0";
      case "app_update_check":
        rust.checks += 1;

        if (release.failure !== undefined) {
          throw { kind: "unavailable", code: release.failure };
        }

        return release.latest;
      case "app_update_install": {
        rust.installs += 1;
        const { onEvent } = args as { onEvent: Channel<UpdateProgress> };

        toChannel(onEvent, 0, { kind: "chunk", received: 512, total: 1024 });

        if (rust.install === null) {
          return new Promise(() => {});
        }

        throw { kind: "invalid", code: rust.install };
      }
      case "open_link":
        rust.opened.push((args as { url: string }).url);

        return null;
      default:
        throw new Error(`нет команды ${command}`);
    }
  });

  return rust;
}

// Окно: настройки «О приложении» и карточка обновления поверх, как
// в __root.tsx.
function launch() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AboutSettings />
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
  it("без сети проверки нет и на экране ничего, кроме пометки в настройках, а с сетью она проходит", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const rust = fakeRust({ latest: UPDATE });

    launch();

    expect(await screen.findByText("Нет сети: проверка пройдёт, когда сеть вернётся.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Проверить обновления" })).toHaveProperty("disabled", true);
    expect(rust.checks).toBe(0);
    expect(screen.queryByRole("region", { name: "Обновление приложения" })).toBeNull();

    online.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(await offer()).toBeTruthy();
    expect(rust.checks).toBe(1);
  });

  it("новой версии нет: окно молчит, настройки говорят, что версия последняя", async () => {
    fakeRust({ latest: null });

    launch();

    expect(await screen.findByText("Установлена последняя версия.")).toBeTruthy();
    expect(screen.getByText("0.1.0")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Обновление приложения" })).toBeNull();
  });

  it("сбой проверки по расписанию не показывается поверх окна, а виден в настройках", async () => {
    fakeRust({ latest: null, failure: "update_unreachable" });

    launch();

    expect(await screen.findByText("Нет связи с GitHub. Установленная версия работает как прежде.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Обновление приложения" })).toBeNull();
  });

  it("новая версия: что изменилось без служебного текста GitHub и страница релиза", async () => {
    const rust = fakeRust({ latest: UPDATE });

    launch();

    const card = await offer();

    expect(within(card).getByText("Доступна версия 0.2.0")).toBeTruthy();
    expect(await within(card).findByText("Сейчас установлена 0.1.0.")).toBeTruthy();
    expect(within(card).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Обновление из релизов GitHub",
      "Курсор не прыгает после сохранения",
    ]);
    expect(screen.getByText("Доступна версия 0.2.0.")).toBeTruthy();

    fireEvent.click(within(card).getByRole("button", { name: "Страница релиза" }));
    fireEvent.click(screen.getByRole("button", { name: "Что нового" }));

    await waitFor(() =>
      expect(rust.opened).toEqual([
        "https://github.com/oberemokis/sapien/releases/tag/v0.2.0",
        "https://github.com/oberemokis/sapien/releases/tag/v0.1.0",
      ]),
    );
  });

  it("«Позже» молчит до следующей проверки", async () => {
    const rust = fakeRust({ latest: UPDATE });

    launch();

    fireEvent.click(within(await offer()).getByRole("button", { name: "Позже" }));

    expect(screen.queryByRole("region", { name: "Обновление приложения" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Проверить обновления" }));

    expect(await offer()).toBeTruthy();
    expect(rust.checks).toBe(2);
  });

  it("проверка повторяется раз в шесть часов", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const rust = fakeRust({ latest: null });

    launch();

    await screen.findByText("Установлена последняя версия.");
    expect(rust.checks).toBe(1);

    await act(() => vi.advanceTimersByTimeAsync(5 * HOUR));
    expect(rust.checks).toBe(1);

    await act(() => vi.advanceTimersByTimeAsync(HOUR));
    await waitFor(() => expect(rust.checks).toBe(2));
  });

  it("обновление ставится только по согласию и показывает загрузку", async () => {
    const rust = fakeRust({ latest: UPDATE });

    launch();

    const card = await offer();

    expect(rust.installs).toBe(0);

    fireEvent.click(within(card).getByRole("button", { name: "Обновить и перезапустить" }));

    expect(await within(card).findByText("Загружено 50%")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Позже" })).toHaveProperty("disabled", true);
    expect(rust.installs).toBe(1);
  });

  it("оборванная загрузка оставляет версию работать, повтор начинает заново", async () => {
    const rust = fakeRust({ latest: UPDATE });
    rust.install = "update_unreachable";

    launch();

    const card = await offer();

    fireEvent.click(within(card).getByRole("button", { name: "Обновить и перезапустить" }));

    expect(await within(card).findByRole("alert")).toHaveProperty(
      "textContent",
      "Нет связи с GitHub. Установленная версия работает как прежде.",
    );

    rust.install = null;
    fireEvent.click(within(card).getByRole("button", { name: "Обновить и перезапустить" }));

    expect(await within(card).findByText("Загружено 50%")).toBeTruthy();
    expect(within(card).queryByRole("alert")).toBeNull();
    expect(rust.installs).toBe(2);
  });

  it("чужая подпись: обновление не ставится, причина на экране", async () => {
    const rust = fakeRust({ latest: UPDATE });
    rust.install = "update_signature";

    launch();

    fireEvent.click(within(await offer()).getByRole("button", { name: "Обновить и перезапустить" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Подпись обновления не сошлась с ключом приложения, поэтому оно не поставлено. Установленная версия работает как прежде.",
    );
  });
});
