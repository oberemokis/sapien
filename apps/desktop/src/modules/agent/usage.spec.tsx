import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeUsage } from "@/modules/agent";
import type { Usage } from "./model/usage";

// Часы теста стоят: «сброс через» считается от этого времени.
const NOW = Date.parse("2026-11-02T12:00:00Z");

const USAGE: Usage = {
  available: true,
  fiveHour: { used: 15.4, resets: "2026-11-02T16:08:00Z" },
  sevenDay: { used: 83, resets: "2026-11-08T13:00:00Z" },
};

// Claude Code за командой Rust отдаёт ответы по очереди, последний
// повторяется. Строка это код отказа.
function fakeRust(...replies: (Usage | string)[]) {
  const rust = { asked: 0 };

  mockIPC((command) => {
    if (command !== "agent_usage") {
      throw new Error(`нет команды ${command}`);
    }

    const reply = replies[Math.min(rust.asked, replies.length - 1)];

    rust.asked += 1;

    if (typeof reply === "string") {
      throw { kind: "unavailable", code: reply };
    }

    return reply;
  });

  return rust;
}

function open() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ClaudeUsage />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Claude" }));
}

function card() {
  return within(screen.getByRole("region", { name: "Лимиты Claude" }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  clearMocks();
  vi.useRealTimers();
});

describe("лимиты Claude в нижней полосе", () => {
  it("«Claude» показывает, сколько израсходовано и когда сброс, за пять часов и за неделю", async () => {
    fakeRust(USAGE);
    open();

    expect(await card().findByText("15% израсходовано")).toBeDefined();
    expect(card().getByText("Обновлено только что")).toBeDefined();
    expect(card().getByText("85% осталось")).toBeDefined();
    expect(card().getByText("Сброс через 4 ч 8 мин")).toBeDefined();
    expect(card().getByText("83% израсходовано")).toBeDefined();
    expect(card().getByText("17% осталось")).toBeDefined();
    expect(card().getByText("Сброс через 6 д 1 ч")).toBeDefined();
  });

  it("Escape и нажатие мимо закрывают карточку, открытая снова в течение минуты не спрашивает Claude Code заново", async () => {
    const rust = fakeRust(USAGE);
    open();
    await card().findByText("15% израсходовано");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Лимиты Claude" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Claude" }));
    expect(card().getByText("15% израсходовано")).toBeDefined();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("region", { name: "Лимиты Claude" })).toBeNull();
    expect(rust.asked).toBe(1);

    // Через минуту лимиты устарели: открытая снова карточка спрашивает их.
    vi.setSystemTime(NOW + 61_000);
    fireEvent.click(screen.getByRole("button", { name: "Claude" }));
    await waitFor(() => expect(rust.asked).toBe(2));
  });

  it("Escape, закрывший карточку, дальше не идёт: настройки, которые слушают window, остаются открытыми", async () => {
    fakeRust(USAGE);
    open();
    await card().findByText("15% израсходовано");

    // Как useCloseOnEscape в настройках: закрывает их Escape, который никто не забрал.
    let settingsClosed = false;
    const closeSettings = (event: KeyboardEvent) => {
      settingsClosed ||= event.key === "Escape" && !event.defaultPrevented;
    };

    window.addEventListener("keydown", closeSettings);
    fireEvent.keyDown(document, { key: "Escape" });
    window.removeEventListener("keydown", closeSettings);

    expect(screen.queryByRole("region", { name: "Лимиты Claude" })).toBeNull();
    expect(settingsClosed).toBe(false);
  });

  it("вход не по подписке: лимитов нет, карточка так и говорит", async () => {
    fakeRust({ available: false, fiveHour: null, sevenDay: null });
    open();

    expect(await card().findByText("Лимиты есть только у входа по подписке Claude.")).toBeDefined();
    expect(card().queryByRole("progressbar")).toBeNull();
  });

  it("Claude Code не отдал лимиты: «Повторить» спрашивает снова", async () => {
    const rust = fakeRust("claude_failed", USAGE);
    open();

    fireEvent.click(await card().findByRole("button", { name: "Повторить" }));

    expect(await card().findByText("15% израсходовано")).toBeDefined();
    expect(card().queryByText("Claude Code не отдал лимиты.")).toBeNull();
    expect(rust.asked).toBe(2);
  });
});
