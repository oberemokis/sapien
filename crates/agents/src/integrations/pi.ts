// sapien: расширение Pi сообщает приложению, какой разговор идёт в панели,
// чтобы после перезапуска sapien продолжил его командой `pi --session`.
// Вне sapien ничего не делает. Ставит и снимает его sapien в настройках.
import net from "node:net";

// oxlint-disable-next-line import/no-default-export -- Pi берёт расширение из экспорта по умолчанию
export default function sapien(pi) {
  const pane = process.env.SAPIEN_PANE;
  const socket = process.env.SAPIEN_SOCKET;

  if (!pane || !socket) {
    return;
  }

  pi.on("session_start", (event, ctx) => {
    // Без окна (печать, RPC) разговор идёт не в панели.
    if (ctx?.mode !== "tui") {
      return;
    }

    const manager = ctx.sessionManager;
    const file = manager?.getSessionFile?.();
    const id = file || manager?.getSessionId?.();

    if (typeof id !== "string" || id === "") {
      return;
    }

    // Файл разговора: пока его нет, продолжать после перезапуска нечего.
    const transcript = file || undefined;
    const connection = net.createConnection(socket);

    connection.on("error", () => connection.destroy());
    connection.end(
      JSON.stringify({ pane, agent: "pi", id, cwd: process.cwd(), transcript, source: event?.reason ?? "" }),
    );
  });
}
