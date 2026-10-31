import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { YoutrackSettings } from "@/modules/youtrack";

const TOKEN = "perm:очень-секретно";

// Команды Rust с YouTrack, который знает один токен. Адрес и токен
// сохраняются, только если сервер принял токен, как в use_case.rs.
function fakeRust() {
  const saved: { host: string | null; token: string | null; server: "up" | "down" } = {
    host: null,
    token: null,
    server: "up",
  };

  mockIPC((command, args) => {
    const { host, token } = args as { host?: string; token?: string };

    switch (command) {
      case "youtrack_status":
        if (saved.host === null) {
          return { kind: "none" };
        }

        if (saved.server === "down") {
          return { kind: "broken", host: saved.host, code: "youtrack_unreachable" };
        }

        return { kind: "connected", host: saved.host, name: "Илья" };
      case "youtrack_connect":
        if (token !== TOKEN) {
          throw { kind: "invalid", code: "youtrack_token_rejected" };
        }

        saved.host = `https://${host}`;
        saved.token = token;
        return { kind: "connected", host: saved.host, name: "Илья" };
      case "youtrack_disconnect":
        saved.host = null;
        saved.token = null;
        return null;
      default:
        throw new Error(`нет команды ${command}`);
    }
  });

  return saved;
}

function open() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <YoutrackSettings />
    </QueryClientProvider>,
  );
}

async function connect(token: string) {
  fireEvent.change(await screen.findByLabelText("Адрес"), { target: { value: "acme.youtrack.cloud" } });
  fireEvent.change(screen.getByLabelText("Токен"), { target: { value: token } });
  fireEvent.click(screen.getByRole("button", { name: "Подключить" }));
}

afterEach(() => {
  cleanup();
  clearMocks();
});

describe("подключение YouTrack", () => {
  it("принятый токен уходит в Rust, окно показывает только владельца", async () => {
    const saved = fakeRust();
    open();

    await connect(TOKEN);

    expect(await screen.findByText("Подключено как Илья, https://acme.youtrack.cloud")).toBeDefined();
    expect(saved.token).toBe(TOKEN);
    expect(document.body.innerHTML).not.toContain("очень-секретно");
  });

  it("отказ сервера виден причиной, адрес остаётся, токен нет", async () => {
    const saved = fakeRust();
    open();

    await connect("perm:чужой");

    expect(await screen.findByText(/YouTrack не принял токен/)).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>("Адрес").value).toBe("acme.youtrack.cloud");
    expect(screen.getByLabelText<HTMLInputElement>("Токен").value).toBe("");
    expect(saved.host).toBeNull();
  });

  it("сломанное подключение говорит почему, «Отключить» его забывает", async () => {
    const saved = fakeRust();
    saved.host = "https://acme.youtrack.cloud";
    saved.server = "down";
    open();

    expect(await screen.findByText(/Сервер не отвечает/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Отключить" }));

    expect(await screen.findByLabelText("Адрес")).toBeDefined();
    expect(saved.host).toBeNull();
  });
});
