// sapien: плагин OpenCode сообщает приложению, какой разговор идёт в панели,
// чтобы после перезапуска sapien продолжил его командой `opencode --session`.
// Вне sapien ничего не делает. Ставит и снимает его sapien в настройках.
import net from "node:net";

const EVENTS = new Set(["session.created", "session.updated", "session.status"]);

export const SapienPlugin = async () => {
  const pane = process.env.SAPIEN_PANE;
  const socket = process.env.SAPIEN_SOCKET;

  if (!pane || !socket) {
    return {};
  }

  // Разговоры субагентов: у них есть родитель, панель их не продолжает.
  const children = new Set();
  let reported = "";

  return {
    event: async ({ event }) => {
      const properties = event?.properties ?? {};
      const info = properties.info;

      if (info?.id && info.parentID) {
        children.add(info.id);
      }

      const id = properties.sessionID ?? info?.id;

      if (!EVENTS.has(event?.type) || typeof id !== "string" || id === "" || id === reported || children.has(id)) {
        return;
      }

      reported = id;
      const connection = net.createConnection(socket);

      connection.on("error", () => connection.destroy());
      connection.end(JSON.stringify({ pane, agent: "opencode", id, cwd: process.cwd(), source: event.type }));
    },
  };
};

// Новые версии OpenCode берут плагин из экспорта по умолчанию, старые
// из именованного.
// oxlint-disable-next-line import/no-default-export -- так плагин находит OpenCode
export default { id: "sapien.opencode", server: SapienPlugin };
