import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appStorage, loadAppStorage } from "./app-storage";

type Changes = Record<string, string | null>;

// Rust за командами хранилища: что лежит в файле и какие пачки пришли.
function fakeRust(stored: Record<string, string> | "locked") {
  const written: Changes[] = [];

  mockIPC((command, args) => {
    switch (command) {
      case "window_store_read":
        if (stored === "locked") {
          throw { kind: "unavailable", code: "window_store_unreadable" };
        }

        return stored;
      case "window_store_write":
        written.push((args as { changes: Changes }).changes);

        return null;
      default:
        throw new Error(`нет команды ${command}`);
    }
  });

  return written;
}

afterEach(() => {
  clearMocks();
  localStorage.clear();
  vi.useRealTimers();
});

describe("хранилище приложения", () => {
  it("читает файл Rust до работы и пишет изменения одной пачкой", async () => {
    vi.useFakeTimers();
    const written = fakeRust({ "sapien.youtrack.known": "задачи" });

    await loadAppStorage();

    expect(appStorage.getItem("sapien.youtrack.known")).toBe("задачи");

    appStorage.setItem("sapien.youtrack.graphs", "графы");
    appStorage.setItem("sapien.youtrack.graphs", "графы 2");
    appStorage.removeItem("sapien.youtrack.known");

    expect(written).toEqual([]);

    await vi.advanceTimersByTimeAsync(500);

    expect(written).toEqual([{ "sapien.youtrack.graphs": "графы 2", "sapien.youtrack.known": null }]);
    expect(appStorage.getItem("sapien.youtrack.known")).toBeNull();
  });

  it("кеши прежних версий уходят из localStorage в Rust", async () => {
    vi.useFakeTimers();
    const written = fakeRust({});
    localStorage.setItem("sapien.youtrack.inbox", "лента");
    localStorage.setItem("sapien.theme", "dark");

    await loadAppStorage();
    await vi.advanceTimersByTimeAsync(500);

    expect(appStorage.getItem("sapien.youtrack.inbox")).toBe("лента");
    expect(localStorage.getItem("sapien.youtrack.inbox")).toBeNull();
    expect(localStorage.getItem("sapien.theme")).toBe("dark");
    expect(written).toEqual([{ "sapien.youtrack.inbox": "лента" }]);
  });

  it("без ключа данных кеш пуст, а окно открывается", async () => {
    fakeRust("locked");

    await expect(loadAppStorage()).resolves.toBeUndefined();
    expect(appStorage.getItem("sapien.youtrack.known")).toBeNull();
  });
});
